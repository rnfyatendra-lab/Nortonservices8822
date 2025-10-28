'use strict';

/*
  Robust bulk-mail server (SMTP via client-provided app password).
  - Serves login and launcher UI from /public
  - Login creds (requested): nortonservices8822 / services8822
  - /sendBulk endpoint: client sends smtpUser (gmail), smtpPass (app password),
    fromEmail, subject, text, recipients (comma/newline), concurrency, retries
  - Server verifies SMTP before sending; returns JSON summary
  - Extensive console logs for troubleshooting
*/

const fs = require('fs');
const path = require('path');

function safeRequire(name) {
  try { return require(name); }
  catch (e) {
    console.error(`Missing module "${name}". Run "npm install" in project root.`);
    console.error('Require error:', e && e.message);
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

// admin login
const ADMIN_USER = 'nortonservices8822';
const ADMIN_PASS = 'services8822';

// public folder check
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) {
  console.error('Missing "public" folder. Create folder "public" with the UI files.');
  process.exit(1);
}

// middlewares
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'fast-mailer-secret-keep-it-safe',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true }
}));
app.use(express.static(PUBLIC_DIR));

// Generic safety handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && (err.stack || err.message) ? (err.stack || err.message) : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// helpers
const isEmail = e => validator.isEmail(String(e || '').trim());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = (attempt, base = 200) => base * Math.pow(2, Math.max(0, attempt - 1)) + Math.floor(Math.random() * base);

// health
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString(), pid: process.pid }));

// root -> login
app.get('/', (req, res) => {
  const f = path.join(PUBLIC_DIR, 'login.html');
  if (!fs.existsSync(f)) return res.status(500).send('login.html missing in public/');
  return res.sendFile(f);
});

// login
app.post('/login', (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();
    if (!username || !password) return res.status(400).json({ success: false, message: 'Missing' });
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      req.session.user = username;
      console.log(`Login OK: ${username} from ${req.ip}`);
      return res.json({ success: true });
    }
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  } catch (err) {
    console.error('Login error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.headers.accept && req.headers.accept.includes('application/json')) return res.status(401).json({ success: false, message: 'Unauthorized' });
  return res.redirect('/');
}

// launcher
app.get('/launcher', requireAuth, (req, res) => {
  const f = path.join(PUBLIC_DIR, 'launcher.html');
  if (!fs.existsSync(f)) return res.status(500).send('launcher.html missing in public/');
  return res.sendFile(f);
});

// logout
app.post('/logout', requireAuth, (req, res) => {
  const user = req.session && req.session.user;
  req.session.destroy(() => {
    res.clearCookie('connect.sid', { path: '/' });
    console.log('Logout:', user);
    return res.json({ success: true });
  });
});

// core send endpoint
app.post('/sendBulk', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const senderName = String(body.senderName || 'Anonymous').trim();
    const smtpUser = String(body.smtpUser || '').trim(); // Gmail user
    const smtpPass = String(body.smtpPass || '').trim(); // app password
    const fromEmail = String(body.fromEmail || smtpUser || '').trim();
    const subject = String(body.subject || '').trim();
    const text = String(body.text || '').trim();
    const raw = String(body.recipients || '').trim();

    if (!smtpUser || !smtpPass) return res.status(400).json({ success: false, auth: false, message: 'SMTP credentials required' });
    if (!fromEmail) return res.status(400).json({ success: false, message: 'From email required' });
    if (!raw) return res.status(400).json({ success: false, message: 'Recipients required' });

    // parse recipients, dedupe, validate
    const parsed = raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    const seen = new Set();
    const recipients = [];
    for (const r of parsed) {
      const lower = (r || '').toLowerCase();
      if (!r) continue;
      if (seen.has(lower)) continue;
      if (!isEmail(r)) continue;
      seen.add(lower);
      recipients.push(r);
    }
    if (recipients.length === 0) return res.status(400).json({ success: false, message: 'No valid recipients' });

    // safety cap
    const MAX = 2000;
    if (recipients.length > MAX) recipients.splice(MAX);

    const concurrency = Math.max(1, Math.min(50, Number(body.concurrency) || 10));
    const retries = Math.max(0, Math.min(5, Number(body.retries) || 3));

    console.log(`sendBulk start: from=${fromEmail} count=${recipients.length} concurrency=${concurrency} retries=${retries}`);

    // create transporter once
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 30 * 1000,
      greetingTimeout: 30 * 1000,
      socketTimeout: 30 * 1000
    });

    // verify auth early
    try {
      await transporter.verify();
    } catch (vErr) {
      console.error('SMTP verify failed:', vErr && vErr.message ? vErr.message : vErr);
      return res.status(400).json({ success: false, auth: false, message: 'SMTP auth failed: ' + (vErr && vErr.message ? vErr.message : 'auth') });
    }

    const results = [];
    let idx = 0;

    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= recipients.length) return;
        const to = recipients[i];
        let sent = false;
        let lastErr = null;
        for (let attempt = 1; attempt <= retries + 1 && !sent; attempt++) {
          try {
            const mail = {
              from: `"${senderName.replace(/"/g,'')}" <${fromEmail}>`,
              to,
              subject,
              text
            };
            await transporter.sendMail(mail);
            sent = true;
            results.push({ to, ok: true, attempts: attempt });
            // tiny jitter
            await sleep(Math.floor(Math.random() * 40));
          } catch (err) {
            lastErr = err;
            console.warn(`Attempt ${attempt} failed for ${to}:`, err && err.message ? err.message : err);
            if (attempt <= retries) await sleep(backoff(attempt, 200));
          }
        }
        if (!sent) results.push({ to, ok: false, attempts: Math.max(0, retries + 1), error: lastErr ? String(lastErr.message || lastErr) : 'Failed' });
      }
    }

    const poolSize = Math.min(concurrency, recipients.length);
    const pool = [];
    for (let w = 0; w < poolSize; w++) pool.push(worker());
    await Promise.all(pool);

    try { transporter.close(); } catch (e) { /* ignore */ }

    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;

    console.log(`sendBulk finished: total=${results.length} success=${successCount} fail=${failCount}`);

    return res.json({
      success: failCount === 0,
      total: results.length,
      successCount,
      failCount,
      failures: results.filter(r => !r.ok).slice(0, 200)
    });

  } catch (err) {
    console.error('sendBulk error:', err && (err.stack || err.message) ? (err.stack || err.message) : err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}`);
});
