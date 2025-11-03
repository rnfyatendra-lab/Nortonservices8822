// server.js
'use strict';

/*
  Bulk Mail Server (Node.js only)
  - Provider-agnostic SMTP via nodemailer (use SES/Mailgun/SendGrid SMTP)
  - Config via ENV variables
  - Simple auth via ADMIN_USER / ADMIN_PASS (ENV)
  - POST /send accepts JSON:
    {
      "smtp": { "host","port","secure","user","pass" },
      "fromEmail": "from@domain.com",
      "fromName": "Sender",
      "subject": "Subject",
      "text": "Plain text body",
      "recipients": ["a@x.com","b@y.com", ...],
      "batchSize": 25,           // optional
      "batchIntervalMs": 216000, // optional (216000ms ~= 3.6min -> 10k/day @25 per batch)
      "retries": 3               // optional
    }
  - Returns JSON summary with success/fail counts and failures list
  - PLEASE use a verified sending domain and provider. Do not use Gmail free for high volume.
*/

const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const validator = require('validator');

const APP_PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'adminpass';

const app = express();
app.use(bodyParser.json({ limit: '5mb' }));

// small helper validators
const isEmail = (s) => validator.isEmail(String(s || '').trim());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt, base = 500) => base * Math.pow(2, Math.max(0, attempt - 1)) + Math.floor(Math.random() * base);

// Simple middleware: basic auth via JSON body (or header)
function requireAuth(req, res, next) {
  // prefer header X-ADMIN-KEY or basic JSON credentials
  const headerKey = (req.get('x-admin-key') || '').trim();
  if (headerKey) {
    // You can set X-ADMIN-KEY = process.env.ADMIN_KEY to use API key instead
    if (process.env.ADMIN_KEY && headerKey === process.env.ADMIN_KEY) return next();
    return res.status(401).json({ success: false, message: 'Invalid admin key' });
  }
  const { user, pass } = req.body || {};
  if (user === ADMIN_USER && pass === ADMIN_PASS) return next();
  return res.status(401).json({ success: false, message: 'Unauthorized' });
}

// POST /send
// Expects JSON as described above.
app.post('/send', requireAuth, async (req, res) => {
  try {
    const payload = req.body || {};

    // SMTP settings: prefer full smtp object or fallback to env for reuse
    const smtp = payload.smtp || {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
      secure: process.env.SMTP_SECURE === 'true' || undefined,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    };

    if (!smtp || !smtp.host || !smtp.user || !smtp.pass || !smtp.port) {
      return res.status(400).json({ success: false, message: 'Incomplete SMTP configuration' });
    }

    const fromEmail = String(payload.fromEmail || smtp.user || '').trim();
    if (!isEmail(fromEmail)) return res.status(400).json({ success: false, message: 'Invalid fromEmail' });

    const fromName = String(payload.fromName || 'Sender').replace(/"/g, '');
    const subject = String(payload.subject || '(no subject)');
    const text = String(payload.text || '');

    // recipients: array or newline/comma string
    let recipients = payload.recipients || [];
    if (typeof recipients === 'string') {
      recipients = recipients.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, message: 'Recipients required' });
    }
    // dedupe + validate
    recipients = Array.from(new Set(recipients))
      .filter(r => isEmail(r));

    if (recipients.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid recipient emails' });
    }

    const batchSize = Math.max(1, Math.min(1000, Number(payload.batchSize) || 25)); // keep reasonable limit
    const batchIntervalMs = Math.max(100, Number(payload.batchIntervalMs) || 216000); // default ~3.6 min
    const retries = Math.max(0, Math.min(10, Number(payload.retries) || 3));

    // create transporter
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: !!smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      pool: true,
      maxConnections: Math.min(50, batchSize),
      maxMessages: Infinity
    });

    // Verify transport (catch auth errors early)
    try {
      await transporter.verify();
    } catch (err) {
      return res.status(400).json({ success: false, auth: false, message: 'SMTP verify failed', error: err && err.message });
    }

    const results = [];
    // helper to send one with retries
    async function sendWithRetries(to) {
      for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
          await transporter.sendMail({
            envelope: { from: fromEmail, to },
            from: `"${fromName}" <${fromEmail}>`,
            to,
            subject,
            text,
            headers: {
              'Reply-To': fromEmail,
              'Message-ID': `<${Date.now()}-${Math.random().toString(36).slice(2)}@${fromEmail.split('@').pop()}>`
            }
          });
          return { to, ok: true };
        } catch (err) {
          const code = err && (err.responseCode || err.code) || null;
          const errText = err && (err.message || err.response) ? String(err.message || err.response) : 'send error';
          // Permanent failures - don't retry
          if (code && [550, 551, 553, 554].includes(Number(code))) {
            return { to, ok: false, error: errText, permanent: true };
          }
          if (attempt <= retries) {
            await sleep(backoffMs(attempt, 500));
            continue;
          } else {
            return { to, ok: false, error: errText };
          }
        }
      }
      return { to, ok: false, error: 'unknown' };
    }

    // send in batches
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      // send batch in parallel
      const promises = batch.map(to => sendWithRetries(to));
      const settled = await Promise.all(promises);
      results.push(...settled);

      // if there are more batches, wait batchIntervalMs
      if (i + batchSize < recipients.length) {
        await sleep(batchIntervalMs);
      }
    }

    // close transporter
    try { transporter.close(); } catch (e) { /* ignore */ }

    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;
    const failures = results.filter(r => !r.ok).slice(0, 200);

    return res.json({ success: failCount === 0, total: results.length, successCount, failCount, failures });
  } catch (err) {
    console.error('Fatal send error:', err);
    return res.status(500).json({ success: false, message: 'Server error', error: err && err.message });
  }
});

app.listen(APP_PORT, () => {
  console.log(`Bulk mail server listening on port ${APP_PORT}`);
});
