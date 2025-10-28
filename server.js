// server.js (fixed: verify auth first, transporter pool, retries+backoff, concurrency default 10)
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const validator = require('validator');

const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_USER = 'Yatendra';
const ADMIN_PASS = '@#Yatendra';

// middlewares
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'short-secret', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// helpers
const isEmail = e => validator.isEmail(String(e || '').trim());
const dedupe = arr => {
  const s = new Set();
  return arr.map(x => String(x||'').trim()).filter(Boolean).filter(x => {
    const L = x.toLowerCase(); if (s.has(L)) return false; s.add(L); return true;
  });
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = (attempt, base = 300) => base * Math.pow(2, Math.max(0, attempt - 1)) + Math.floor(Math.random() * base);

// auth
function requireAuth(req, res, next){
  if (req.session && req.session.user) return next();
  if (req.headers.accept && req.headers.accept.includes('application/json')) return res.status(401).json({ success: false });
  return res.redirect('/');
}

// simple login
app.post('/login', (req, res) => {
  const u = String(req.body.username || '').trim();
  const p = String(req.body.password || '').trim();
  if (!u || !p) return res.json({ success: false, message: 'Missing' });
  if (u === ADMIN_USER && p === ADMIN_PASS) { req.session.user = u; return res.json({ success: true }); }
  return res.json({ success: false, message: 'Invalid' });
});

app.get('/launcher', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'launcher.html')));
app.post('/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

// Core endpoint: sendBulk using SMTP credentials provided (not persisted)
app.post('/sendBulk', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const smtpUser = String(body.smtpUser || '').trim();
    const smtpPass = String(body.smtpPass || '').trim();
    const fromEmail = String(body.fromEmail || smtpUser || '').trim();
    const senderName = String(body.senderName || 'Anonymous').trim();
    const subject = String(body.subject || '').trim();
    const text = String(body.text || '').trim();
    const rawRecipients = String(body.recipients || '').trim();

    if (!smtpUser || !smtpPass) return res.status(400).json({ success: false, message: 'SMTP credentials required', authError: true });
    if (!fromEmail) return res.status(400).json({ success: false, message: 'From email required' });
    if (!rawRecipients) return res.status(400).json({ success: false, message: 'Recipients required' });

    // parse recipients
    const parsed = rawRecipients.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    let recipients = dedupe(parsed).filter(isEmail);
    if (recipients.length === 0) return res.status(400).json({ success: false, message: 'No valid recipients' });

    // safety cap
    const MAX = 5000;
    if (recipients.length > MAX) recipients = recipients.slice(0, MAX);

    // concurrency & retries (sane defaults)
    const concurrency = Number.isInteger(body.concurrency) ? Math.max(1, Math.min(50, body.concurrency)) : 10;
    const retries = Number.isInteger(body.retries) ? Math.max(0, Math.min(6, body.retries)) : 5;

    // create transporter with pooling to reduce connection churn
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
      pool: true,
      maxConnections: Math.min(5, concurrency), // limit connections
      rateLimit: true
    });

    // verify auth — if verify fails, return authError so client shows app-password error immediately
    try {
      await transporter.verify();
    } catch (verifyErr) {
      // close transporter
      try { transporter.close(); } catch(e){}
      return res.status(400).json({ success: false, message: 'SMTP auth failed', authError: true });
    }

    // worker pool sending with retries
    const results = [];
    let idx = 0;

    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= recipients.length) return;
        const to = recipients[i];
        let attempt = 0;
        let sent = false;
        let lastError = null;
        while (attempt <= retries && !sent) {
          attempt++;
          try {
            const mail = {
              from: `"${senderName}" <${fromEmail}>`,
              to,
              subject,
              text,
              headers: { 'List-Unsubscribe': `<mailto:unsubscribe@${fromEmail.split('@')[1]}>` } // helpful header
            };
            // send
            await transporter.sendMail(mail);
            sent = true;
            results.push({ to, ok: true, attempts: attempt });
            // small jitter
            await sleep(Math.floor(Math.random() * 40));
          } catch (err) {
            lastError = err;
            const d = backoff(attempt, 250);
            await sleep(d);
          }
        }
        if (!sent) results.push({ to, ok: false, attempts: attempt - 1, error: lastError ? String(lastError.message || lastError) : 'Unknown' });
      }
    }

    // launch workers
    const workers = [];
    const poolSize = Math.min(concurrency, recipients.length);
    for (let w = 0; w < poolSize; w++) workers.push(worker());
    await Promise.all(workers);

    // close transporter
    try { transporter.close(); } catch (e) {}

    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;

    // If failures exist, return them (but majority of transient issues should be handled by retries)
    return res.json({
      success: failCount === 0,
      total: results.length,
      successCount,
      failCount,
      failures: results.filter(r => !r.ok).slice(0, 200)
    });

  } catch (err) {
    return res.status(500).json({ success: false, message: err && err.message ? err.message : 'Server error' });
  }
});

app.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));
