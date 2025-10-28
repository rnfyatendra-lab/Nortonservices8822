// server.js - minimal, reliable, serves login at "/"
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const validator = require('validator');

const app = express();
const PORT = process.env.PORT || 8080;

// Admin credentials
const ADMIN_USER = 'Yatendra';
const ADMIN_PASS = '@#Yatendra';

// Middleware
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'short-secret-key', resave: false, saveUninitialized: false }));

// Serve static files from public
app.use(express.static(path.join(__dirname, 'public')));

// Safety health-check route
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Root -> always send login.html (covers cases where static didn't pick up)
app.get('/', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login route (JSON)
app.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '').trim();
  if (!username || !password) return res.status(400).json({ success: false, message: 'Missing' });
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.user = username;
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: 'Invalid' });
});

// Require auth
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/');
}

// Launcher (protected)
app.get('/launcher', requireAuth, (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid', { path: '/' });
    return res.json({ success: true });
  });
});

// Simple mail send endpoint (SMTP using client-provided app password)
// Sends in small concurrent batches with retries
app.post('/sendBulk', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const smtpUser = String(body.smtpUser || '').trim();
    const smtpPass = String(body.smtpPass || '').trim();
    const fromEmail = String(body.fromEmail || smtpUser || '').trim();
    const senderName = String(body.senderName || 'Anonymous').trim();
    const subject = String(body.subject || '').trim();
    const text = String(body.text || '').trim();
    const raw = String(body.recipients || '').trim();

    if (!smtpUser || !smtpPass) return res.status(400).json({ success: false, auth: false, message: 'SMTP credentials required' });
    if (!fromEmail) return res.status(400).json({ success: false, message: 'From email required' });
    if (!raw) return res.status(400).json({ success: false, message: 'Recipients required' });

    // parse recipients
    const parsed = raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    // dedupe + validate
    const seen = new Set();
    const recipients = [];
    for (const r of parsed) {
      const L = (r || '').toLowerCase();
      if (!r) continue;
      if (seen.has(L)) continue;
      if (!validator.isEmail(r)) continue;
      seen.add(L);
      recipients.push(r);
    }
    if (recipients.length === 0) return res.status(400).json({ success: false, message: 'No valid recipients' });

    // limits
    const MAX = 2000;
    if (recipients.length > MAX) recipients.splice(MAX);

    // concurrency and retries (safe defaults)
    const concurrency = Math.max(1, Math.min(50, Number(body.concurrency) || 10));
    const retries = Math.max(0, Math.min(5, Number(body.retries) || 3));

    // create transporter
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass }
    });

    // verify auth early
    try {
      await transporter.verify();
    } catch (err) {
      return res.status(400).json({ success: false, auth: false, message: 'SMTP auth failed: ' + (err && err.message ? err.message : 'auth') });
    }

    // worker pool
    let idx = 0;
    const results = [];

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const backoff = (attempt) => 200 * Math.pow(2, Math.max(0, attempt - 1)) + Math.floor(Math.random() * 200);

    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= recipients.length) return;
        const to = recipients[i];
        let sent = false;
        let lastErr = null;
        for (let attempt = 1; attempt <= retries + 1 && !sent; attempt++) {
          try {
            await transporter.sendMail({
              from: `"${senderName}" <${fromEmail}>`,
              to,
              subject,
              text
            });
            sent = true;
            results.push({ to, ok: true });
          } catch (err) {
            lastErr = err;
            if (attempt <= retries) {
              await sleep(backoff(attempt));
            }
          }
        }
        if (!sent) {
          results.push({ to, ok: false, error: lastErr ? String(lastErr.message || lastErr) : 'Failed' });
        }
      }
    }

    const workers = [];
    const pool = Math.min(concurrency, recipients.length);
    for (let w = 0; w < pool; w++) workers.push(worker());
    await Promise.all(workers);

    try { transporter.close(); } catch (e) { /* ignore */ }

    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;

    return res.json({ success: failCount === 0, total: results.length, successCount, failCount, failures: results.filter(r => !r.ok).slice(0, 200) });

  } catch (err) {
    console.error('sendBulk error:', err);
    return res.status(500).json({ succes
