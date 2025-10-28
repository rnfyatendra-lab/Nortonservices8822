/**
 * server.js
 * SMTP-only bulk mailer (Gmail app password or other SMTP credentials sent from client).
 * - Concurrency worker pool (default 30)
 * - Retries with exponential backoff + jitter
 * - Dedupe & validation
 * - List-Unsubscribe header support
 * - Does NOT persist SMTP passwords
 *
 * Usage: place this file at project root. Install dependencies listed below.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const nodemailer = require('nodemailer');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 8080;

// Admin (login) defaults (you said earlier to keep these)
const ADMIN_USER = 'Yatendra';
const ADMIN_PASS = '@#Yatendra';

// Middlewares
app.use(helmet());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'session-secret-short', resave: false, saveUninitialized: false }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 200 }));
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
function log(...args){ console.log(new Date().toISOString(), ...args); }
function isValidEmail(e){ return validator.isEmail(String(e||'').trim()); }
function dedupe(arr){
  const s = new Set();
  return arr.map(x => String(x||'').trim()).filter(Boolean).filter(x => {
    const L = x.toLowerCase();
    if(s.has(L)) return false;
    s.add(L); return true;
  });
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function backoffDelay(attempt, base=300){
  // attempt 1 -> base*1 + jitter; attempt 2 -> base*2 + jitter etc
  const expo = Math.pow(2, Math.max(0, attempt-1));
  const jitter = Math.floor(Math.random() * base);
  return base * expo + jitter;
}

// Auth middleware
function requireAuth(req,res,next){
  if(req.session && req.session.user) return next();
  if(req.headers.accept && req.headers.accept.includes('application/json')) return res.status(401).json({ success:false, message:'Unauthorized' });
  return res.redirect('/');
}

// Routes: login/launcher/logout
app.get('/', (req,res) => res.sendFile(path.join(__dirname,'public','login.html')));
app.post('/login', (req,res) => {
  const u = String(req.body.username||'').trim();
  const p = String(req.body.password||'').trim();
  if(!u||!p) return res.status(400).json({ success:false, message:'Missing' });
  if(u === ADMIN_USER && p === ADMIN_PASS){ req.session.user = u; log('Login ok:', u); return res.json({ success:true }); }
  return res.status(401).json({ success:false, message:'Invalid' });
});
app.get('/launcher', requireAuth, (req,res) => res.sendFile(path.join(__dirname,'public','launcher.html')));
app.post('/logout', (req,res) => { const user=req.session.user; req.session.destroy(()=>{ res.clearCookie('connect.sid'); log('Logout', user); res.json({ success:true }); }); });

// Core: /sendBulk - SMTP-only implementation
/**
 * POST /sendBulk
 * Body:
 *  {
 *    senderName, smtpUser, smtpPass, fromEmail, subject, text, html(optional), recipients,
 *    concurrency (optional), retries (optional), listUnsubscribe (optional)
 *  }
 *
 * Response: { success: boolean, total, successCount, failCount, failures[] }
 *
 * IMPORTANT: smtpUser/smtpPass are accepted from client but NOT stored.
 */
app.post('/sendBulk', requireAuth, async (req,res) => {
  try{
    const body = req.body || {};
    const senderName = String(body.senderName||'').trim();
    // Accept SMTP credentials from client (Gmail app password recommended)
    const smtpUser = String(body.smtpUser||'').trim();
    const smtpPass = String(body.smtpPass||'').trim();
    // fromEmail: prefer explicit, otherwise use smtpUser
    const fromEmail = String(body.fromEmail || smtpUser || '').trim();
    const subject = String(body.subject||'').trim();
    const text = String(body.text||'').trim();
    const html = body.html ? String(body.html) : null;
    const listUnsubscribe = body.listUnsubscribe ? String(body.listUnsubscribe) : null;

    if(!smtpUser || !smtpPass) return res.status(400).json({ success:false, message:'SMTP credentials required' });
    if(!fromEmail) return res.status(400).json({ success:false, message:'From email required' });

    // recipients parsing + dedupe + validation
    const rawRecipients = String(body.recipients || '');
    if(!rawRecipients) return res.status(400).json({ success:false, message:'Recipients required' });
    const parsed = rawRecipients.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    let recipients = dedupe(parsed).filter(isValidEmail);
    if(recipients.length === 0) return res.status(400).json({ success:false, message:'No valid recipients' });

    // Safety caps
    const MAX_RECIPIENTS = 2000;
    if(recipients.length > MAX_RECIPIENTS) recipients = recipients.slice(0, MAX_RECIPIENTS);

    // concurrency & retries
    const concurrency = Number.isInteger(body.concurrency) ? Math.max(1, Math.min(100, body.concurrency)) : 30;
    const retries = Number.isInteger(body.retries) ? Math.max(0, Math.min(5, body.retries)) : 3;

    log('sendBulk start', { fromEmail, count: recipients.length, concurrency, retries, host: os.hostname() });

    // create a single SMTP transporter (re-used) with nodemailer
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
      // pool: true // intentionally not using nodemailer's pool, we implement our own concurrency
    });

    // verify transport before heavy work
    try { await transporter.verify(); log('SMTP verify OK'); }
    catch(verifyErr){ log('SMTP verify failed', verifyErr && verifyErr.message); return res.status(400).json({ success:false, message:'SMTP auth/verify failed: '+ (verifyErr && verifyErr.message) }); }

    // worker pool
    const results = []; // { to, ok, attempts, error? }
    let idx = 0;

    async function worker(){
      while(true){
        const i = idx++;
        if(i >= recipients.length) return;
        const to = recipients[i];

        let attempt = 0;
        let sent = false;
        let lastErr = null;

        while(attempt <= retries && !sent){
          attempt++;
          try{
            // build message
            const mail = {
              from: `"${senderName || 'Anonymous'}" <${fromEmail}>`,
              to,
              subject,
              text,
              headers: {}
            };
            if(html) mail.html = html;
            if(listUnsubscribe) mail.headers['List-Unsubscribe'] = `<${listUnsubscribe}>`;

            await transporter.sendMail(mail);
            sent = true;
            results.push({ to, ok:true, attempts: attempt });
            // tiny random pause to reduce bursts
            await sleep(Math.floor(Math.random() * 30));
          }catch(err){
            lastErr = err;
            const delayMs = backoffDelay(attempt, 200);
            log(`Send attempt ${attempt} failed for ${to}, delaying ${delayMs}ms:`, err && err.message ? err.message : err);
            await sleep(delayMs);
          }
        } // attempts

        if(!sent){
          results.push({ to, ok:false, attempts: attempt-1, error: lastErr ? String(lastErr.message || lastErr) : 'Unknown' });
        }
      }
    }

    // start workers
    const workerCount = Math.min(concurrency, recipients.length);
    const pool = [];
    for(let w=0; w<workerCount; w++) pool.push(worker());
    await Promise.all(pool);

    // close transporter
    try{ transporter.close(); }catch(e){ /* ignore */ }

    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;
    log('sendBulk finished', { total: results.length, successCount, failCount });

    // limit failures details
    const failures = results.filter(r => !r.ok).map(r => ({ to: r.to, error: r.error })).slice(0, 200);

    return res.json({ success: failCount === 0, total: results.length, successCount, failCount, failures });

  }catch(err){
    log('sendBulk error', err && err.message ? err.message : err);
    return res.status(500).json({ success:false, message: err && err.message ? err.message : 'Server error' });
  }
});

// optional status endpoint
app.get('/status', (req,res) => res.json({ ok:true, host: os.hostname() }));

app.listen(PORT, () => log('Server listening on port', PORT));
