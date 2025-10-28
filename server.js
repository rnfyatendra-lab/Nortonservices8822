// server.js
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const validator = require('validator');

const app = express();
const PORT = process.env.PORT || 8080;

// Admin credentials (as requested)
const ADMIN_USER = 'Yatendra';
const ADMIN_PASS = '@#Yatendra';

// Middlewares
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'short-secret', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
const isEmail = e => validator.isEmail(String(e || '').trim());
const dedupe = arr => {
  const seen = new Set();
  return arr.map(s => String(s || '').trim())
            .filter(Boolean)
            .filter(x => { const L = x.toLowerCase(); if (seen.has(L)) return false; seen.add(L); return true; });
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = (attempt, base = 300) => base * Math.pow(2, Math.max(0, attempt - 1)) + Math.floor(Math.random() * base);

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return res.redirect('/');
}

// Routes - login & launcher
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.post('/login', (req, res) => {
  const u = String(req.body.username || '').trim();
  const p = String(req.body.password || '').trim();
  if (!u || !p) return res.status(400).json({ success: false, message: 'Missing' });
  if (u === ADMIN_USER && p === ADMIN_PASS) {
    req.session.user = u;
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: 'Invalid' });
});
app.get('/launcher', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'launcher.html')));
app.post('/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));

// Core: bulk send via SMTP (concurrent workers, retries)
app.post('/sendBulk', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const smtpUser = String(body.smtpUser || '').trim();   // gmail id
    const smtpPass = String(body.smtpPass || '').trim();   // app password
    const fromEmail = String(body.fromEmail || smtpUser || '').trim();
    const senderName = String(body.senderName || 'Anonymous').trim();
    const subject = String(body.subject || '').trim();
    const text = String(body.text || '').trim();
    const raw = String(body.recipients || '');
    if (!smtpUser || !smtpPass) return res.status(400).json({ success: false, message: 'SMTP credentials required' });
    if (!fromEmail) return res.status(400).json({ success: false, message: 'From email required' });
    if (!raw) return res.status(400).json({ success: false, message: 'Recipients required' });

    // parse, dedupe, validate
    const parsed = raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    let recipients = dedupe(parsed).filter(isEmail);
    if (recipients.length === 0) return res.status(400).json({ success: false, message: 'No valid recipients' });

    // safety cap
    const MAX = 2000;
    if (recipients.length > MAX) recipients = recipients.slice(0, MAX);

    const concurrency = Number.isInteger(body.concurrency) ? Math.max(1, Math.min(100, body.concurrency)) : 30;
    const retries = Number.isInteger(body.retries) ? Math.max(0, Math.min(5, body.retries)) : 3;

    // create transporter (re-used)
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass }
    });

    // verify once
    try { await transporter.verify(); }
    catch (e) { return res.status(400).json({ success: false, message: 'SMTP auth/verify failed: ' + (e.message || e) }); }

    // worker pool
    const results = []; // { to, ok, attempts, error? }
    let idx = 0;

    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= recipients.length) return;
        const to = recipients[i];
        let attempt = 0, sent = false, lastErr = null;
        while (attempt <= retries && !sent) {
          attempt++;
          try {
            const mail = {
              from: `"${senderName}" <${fromEmail}>`,
              to,
              subject,
              text,
              headers: {}
            };
            await transporter.sendMail(mail);
            sent = true;
            results.push({ to, ok: true, attempts: attempt });
            // small pause to avoid burst
            await sleep(Math.floor(Math.random() * 40));
          } catch (err) {
            lastErr = err;
            const d = backoff(attempt, 200);
            await sleep(d);
          }
        }
        if (!sent) results.push({ to, ok: false, attempts: Math.max(0, attempt - 1), error: lastErr ? String(lastErr.message || lastErr) : 'Unknown' });
      }
    }

    const workers = [];
    const poolSize = Math.min(concurrency, recipients.length);
    for (let w = 0; w < poolSize; w++) workers.push(worker());
    await Promise.all(workers);

    // close transporter if possible
    try { transporter.close(); } catch (e) {}

    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;
    // return full summary (client will show single popup)
    return res.json({ success: failCount === 0, total: results.length, successCount, failCount, failures: results.filter(r=>!r.ok).slice(0,100) });

  } catch (err) {
    return res.status(500).json({ success: false, message: err && err.message ? err.message : 'Server error' });
  }
});

// start
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
