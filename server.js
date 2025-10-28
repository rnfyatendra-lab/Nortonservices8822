// server.js (fixed)
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validator = require('validator');

const app = express();
const PORT = process.env.PORT || 8080;

// admin credentials (use .env in real)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Yatendra Rajput';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Yattu@882';

// security headers
app.use(helmet());

// Accept JSON and form data
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Rate limiting (simple)
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

// Session: secure only in production (requires HTTPS)
app.use(session({
  secret: process.env.SESSION_SECRET || 'replace-this-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: (process.env.NODE_ENV === 'production'),
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 4
  }
}));

// Serve static files from public AFTER session so static assets unaffected
app.use(express.static(path.join(__dirname, 'public')));

// Simple logger for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} -> ${req.method} ${req.url}`);
  next();
});

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  // If XHR / fetch, return json; else redirect
  if (req.headers['accept'] && req.headers['accept'].includes('application/json')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return res.redirect('/');
}

// Root -> login page
app.get('/', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Accept login via JSON or form-urlencoded
app.post('/login', (req, res) => {
  try {
    // normalize incoming payload (works for both JSON and form)
    const username = (req.body && req.body.username) ? String(req.body.username).trim() : '';
    const password = (req.body && req.body.password) ? String(req.body.password).trim() : '';

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Missing username or password' });
    }

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      req.session.user = username;
      return res.json({ success: true });
    } else {
      return res.status(401).json({ success: false, message: '❌ Invalid credentials' });
    }
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/launcher', requireAuth, (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    res.clearCookie('connect.sid', { path: '/' });
    return res.json({ success: true });
  });
});

// helpers
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function isLikelyEmail(s) { return validator.isEmail(String(s || '').trim()); }

async function sendInBatches(transporter, mailObjects, options = {}) {
  const { batchSize = 5, batchDelayMs = 500 } = options;
  const results = [];
  for (let i = 0; i < mailObjects.length; i += batchSize) {
    const batch = mailObjects.slice(i, i + batchSize);
    const promises = batch.map(m =>
      transporter.sendMail(m)
        .then(info => ({ status: 'fulfilled', info, to: m.to }))
        .catch(err => ({ status: 'rejected', error: (err && err.message) || String(err), to: m.to }))
    );
    const settled = await Promise.all(promises);
    results.push(...settled);

    if (i + batchSize < mailObjects.length) await delay(batchDelayMs);
  }
  return results;
}

// send endpoint
app.post('/send', requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message, batchSize, batchDelayMs } = req.body || {};

    if (!email || !password || !recipients) {
      return res.status(400).json({ success: false, message: 'Email, password and recipients required' });
    }

    const recipientList = String(recipients)
      .split(/[\n,;]+/)
      .map(r => r.trim())
      .filter(Boolean);

    if (recipientList.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid recipients found' });
    }

    const invalids = recipientList.filter(r => !isLikelyEmail(r));
    if (invalids.length > 0) {
      return res.status(400).json({ success: false, message: `Invalid email(s): ${invalids.join(', ')}` });
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    try {
      await transporter.verify();
    } catch (verifyErr) {
      console.error('SMTP verify failed:', verifyErr);
      return res.status(400).json({ success: false, message: 'SMTP auth/verify failed: ' + (verifyErr && verifyErr.message ? verifyErr.message : verifyErr) });
    }

    const safeSender = `"${String(senderName || 'Anonymous').replace(/"/g, '')}" <${email}>`;
    const mails = recipientList.map(r => ({
      from: safeSender,
      to: r,
      subject: subject || 'No Subject',
      text: message || ''
    }));

    const bSize = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 5;
    const bDelay = Number.isInteger(batchDelayMs) && batchDelayMs >= 0 ? batchDelayMs : 500;

    const results = await sendInBatches(transporter, mails, { batchSize: bSize, batchDelayMs: bDelay });

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failList = results.filter(r => r.status === 'rejected').map(r => ({ to: r.to, error: r.error }));

    return res.json({
      success: failList.length === 0,
      message: `Sent: ${successCount}, Failed: ${failList.length}`,
      details: { total: mails.length, successCount, failures: failList }
    });

  } catch (err) {
    console.error('Send error:', err);
    return res.status(500).json({ success: false, message: err && err.message ? err.message : String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
