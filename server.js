// server.js
'use strict';

const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

function safeRequire(name){
  try { return require(name); } catch (e) {
    console.error(`Missing module "${name}". run: npm install ${name}`);
    process.exit(1);
  }
}
const express = safeRequire('express');
const session = safeRequire('express-session');
const bodyParser = safeRequire('body-parser');
const nodemailer = safeRequire('nodemailer');
const validator = safeRequire('validator');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// LOGIN as requested
const ADMIN_USER = 'nortonservices8822';
const ADMIN_PASS = 'services8822';

const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) {
  console.error('Missing public/ folder. Create public/login.html etc.');
  process.exit(1);
}

app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'fast-mailer-secret', resave: false, saveUninitialized: false }));
app.use(express.static(PUBLIC_DIR));

// safety
process.on('uncaughtException', e => console.error('UncaughtException', e && e.stack || e));
process.on('unhandledRejection', e => console.error('UnhandledRejection', e));

// helpers
const isEmail = e => validator.isEmail(String(e || '').trim());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (n=200) => Math.floor(Math.random()*n);
const backoffMs = (attempt, base=500) => base * Math.pow(2, Math.max(0, attempt-1)) + jitter(base);

// MX check: returns true if domain has MX or A record
async function domainAcceptsMail(domain){
  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.length) return true;
  } catch (e) {
    // no MX; try A record (some servers accept via A)
    try {
      const a = await dns.resolve(domain);
      if (a && a.length) return true;
    } catch (_){}
  }
  return false;
}

// parse recipients, dedupe, validate and MX-check
async function prepareRecipients(rawList){
  const parsed = String(rawList || '').split(/[\n,;]+/)
    .map(s => s.trim()).filter(Boolean);

  const seen = new Set();
  const good = [];
  const bad = [];

  for (const r of parsed) {
    const low = (r || '').toLowerCase();
    if (!r) continue;
    if (seen.has(low)) continue;
    seen.add(low);

    // quick basic validation
    if (!isEmail(r)) {
      bad.push({ to: r, reason: 'Invalid format' });
      continue;
    }

    // domain check
    const domain = r.split('@').pop();
    let accepts = false;
    try { accepts = await domainAcceptsMail(domain); }
    catch (e) { accepts = false; }
    if (!accepts) {
      bad.push({ to: r, reason: 'No MX/A records for domain' });
      continue;
    }

    good.push(r);
  }
  return { good, bad };
}

// Require auth
function requireAuth(req, res, next){
  if (req.session && req.session.user) return next();
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ success:false, message:'Unauthorized' });
  }
  return res.redirect('/');
}

// routes
app.get('/', (req,res) => res.sendFile(path.join(PUBLIC_DIR,'login.html')));

app.post('/login', (req,res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();
    if (!username || !password) return res.status(400).json({ success:false, message:'Missing' });
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      req.session.user = username;
      return res.json({ success:true });
    }
    return res.status(401).json({ success:false, message:'Invalid credentials' });
  } catch (err) {
    console.error('login err', err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.get('/launcher', requireAuth, (req,res) => res.sendFile(path.join(PUBLIC_DIR,'launcher.html')));
app.post('/logout', requireAuth, (req,res) => req.session.destroy(()=>res.json({ success:true })));

// sendBulk endpoint with MX check, careful retries and blocking handling
app.post('/sendBulk', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const senderName = String(body.senderName || 'Anonymous').trim();
    const smtpUser = String(body.smtpUser || '').trim();
    const smtpPass = String(body.smtpPass || '').trim();
    const fromEmail = String(body.fromEmail || smtpUser || '').trim();
    const subject = String(body.subject || '(no subject)').trim();
    const text = String(body.text || '').trim();
    const rawRecipients = String(body.recipients || '').trim();

    if (!smtpUser || !smtpPass) return res.status(400).json({ success:false, auth:false, message:'SMTP credentials required' });
    if (!fromEmail) return res.status(400).json({ success:false, message:'From email required' });
    if (!rawRecipients) return res.status(400).json({ success:false, message:'Recipients required' });

    // prepare recipients with MX check
    const { good, bad } = await prepareRecipients(rawRecipients);
    if (good.length === 0) {
      return res.status(400).json({ success:false, message:'No valid recipients', invalid: bad });
    }

    // safety caps
    const MAX = 2000;
    if (good.length > MAX) good.splice(MAX);

    // concurrency low for deliverability
    const concurrency = Math.max(1, Math.min(20, Number(body.concurrency) || 5));
    const retries = Math.max(0, Math.min(6, Number(body.retries) || 5));
    const batchPause = Number(body.batchPause) || 500; // ms between batches

    console.log(`Sending from ${fromEmail} to ${good.length} recipients (concurrency=${concurrency}, retries=${retries})`);

    // create transporter
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 30*1000,
      greetingTimeout: 30*1000,
      socketTimeout: 30*1000
    });

    // verify auth early (if wrong app password)
    try {
      await transporter.verify();
    } catch (vErr) {
      console.error('SMTP verify failed', vErr && vErr.message || vErr);
      return res.status(400).json({ success:false, auth:false, message:'SMTP auth failed: ' + (vErr && vErr.message ? vErr.message : 'auth') });
    }

    // worker pattern: send one-by-one but up to concurrency in parallel
    let idx = 0;
    const results = []; // { to, ok, blocked?, error? }

    async function sendSingle(to) {
      // prepare message (plain + basic html)
      const mail = {
        from: `"${senderName.replace(/"/g,'')}" <${fromEmail}>`,
        to,
        subject,
        text: text || '',
        html: text ? `<pre style="font-family:inherit">${escapeHtml(text)}</pre>` : undefined,
        headers: {
          'List-Unsubscribe': `<mailto:unsubscribe@${fromEmail.split('@').pop()}>, <https://example.com/unsubscribe>`,
          'Reply-To': fromEmail
        }
      };

      // Try sending with retries and examine SMTP errors
      let attempt = 0;
      let lastErr = null;
      while (attempt <= retries) {
        attempt++;
        try {
          const info = await transporter.sendMail(mail);
          // success
          return { to, ok: true, info };
        } catch (err) {
          lastErr = err;
          const code = err && err.code ? err.code : null;
          const response = err && err.response ? String(err.response) : '';
          console.warn(`Send err to ${to} attempt ${attempt}:`, code || err && err.message, response);
          // If permanent (550 etc) -> don't retry (address may be invalid/blocked)
          if (isPermanentFailure(err)) {
            return { to, ok:false, blocked: isBlockedError(err), error: extractErr(err) };
          }
          // else transient -> wait and retry
          const delay = backoffMs(attempt, 500);
          await sleep(delay);
        }
      }
      // after retries
      return { to, ok:false, blocked: isBlockedError(lastErr), error: extractErr(lastErr) };
    }

    // helper to spawn workers
    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= good.length) return;
        const to = good[i];
        const r = await sendSingle(to);
        results.push(r);
        // short pause to avoid burst
        await sleep(jitter(150));
      }
    }

    // start pool
    const poolSize = Math.min(concurrency, good.length);
    const pool = [];
    for (let w=0; w<poolSize; w++) pool.push(worker());
    await Promise.all(pool);

    try { transporter.close(); } catch(e){}

    // compile summary
    const successCount = results.filter(r => r.ok).length;
    const blockedCount = results.filter(r => r.blocked).length;
    const failCount = results.filter(r => !r.ok && !r.blocked).length;
    const failures = results.filter(r => !r.ok).map(r => ({ to: r.to, blocked: !!r.blocked, error: r.error }));

    // include invalid (MX failed) recipients to help user fix list
    return res.json({
      success: blockedCount === 0 && failCount === 0,
      totalAttempted: results.length,
      successCount,
      blockedCount,
      failCount,
      invalidDomains: bad,
      failures
    });

  } catch (err) {
    console.error('sendBulk outer err', err && err.stack || err);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

// small helpers for error code handling
function isPermanentFailure(err){
  // treat many SMTP codes as permanent: 550, 551, 553, 554 often permanent
  const code = err && err.responseCode ? Number(err.responseCode) : null;
  if (!isNaN(code)) {
    if ([550, 551, 553, 554].includes(code)) return true;
    // 421/450/451/452 are transient
  }
  // some providers set err.code strings
  const text = err && (err.response || err.message) ? String(err.response || err.message).toLowerCase() : '';
  if (text.includes('user unknown') || text.includes('authentication failed') || text.includes('invalid recipient')) return true;
  return false;
}
function isBlockedError(err){
  // common blocked indicators
  const text = err && (err.response || err.message) ? String(err.response || err.message).toLowerCase() : '';
  if (!text) return false;
  return text.includes('blocked') || text.includes('spam') || text.includes('policy') || text.includes('rate limit') || text.includes('greylist') || text.includes('temporarily deferred') || text.includes('policy rejection');
}
function extractErr(err){
  if (!err) return 'Unknown';
  return (err.response && String(err.response)) || err.message || String(err);
}
function escapeHtml(s){ return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }

// start
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
