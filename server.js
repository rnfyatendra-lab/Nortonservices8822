/**
 * server.js
 * Advanced bulk mailer with SendGrid primary, SMTP fallback,
 * batching, concurrency, retry with exponential backoff + jitter,
 * dedupe, validation, headers for deliverability, and careful logging.
 *
 * Notes:
 * - Provide SENDGRID_API_KEY in your environment to use SendGrid.
 * - If not present, SMTP_USER and SMTP_PASS may be used for SMTP transport.
 * - ADMIN_USER and ADMIN_PASS control the app login. Defaults are provided.
 *
 * Security note: do NOT commit credentials to source control.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const sgMail = require('@sendgrid/mail');
const nodemailer = require('nodemailer');
const os = require('os');

// ---------- Config / environment (use real env vars in your host) ----------
const PORT = process.env.PORT || 8080;
const ADMIN_USER = process.env.ADMIN_USER || 'Yatendra';
const ADMIN_PASS = process.env.ADMIN_PASS || '@#Yatendra';

// SendGrid / SMTP credentials will be read from environment
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || null;
const SMTP_USER = process.env.SMTP_USER || null;
const SMTP_PASS = process.env.SMTP_PASS || null;

// SendGrid init if available
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

// ---------- App init ----------
const app = express();
app.use(helmet());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'session-secret-change',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false }
}));

// Rate limiter for all endpoints (protect from abuse)
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Utility helpers ----------
function log(...args) { console.log(new Date().toISOString(), ...args); }

function isValidEmail(e) { return validator.isEmail(String(e || '').trim()); }

function dedupeList(arr) {
  const seen = new Set();
  return arr.map(s => String(s || '').trim()).filter(Boolean).filter(x => {
    if (seen.has(x.toLowerCase())) return false;
    seen.add(x.toLowerCase());
    return true;
  });
}

// Exponential backoff with jitter
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function backoffDelay(attempt, base = 500) {
  // attempt: 1,2,3...
  const expo = Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * base);
  return base * expo + jitter;
}

// create SMTP transporter (fallback)
function createSmtpTransport() {
  if (!SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

// Send using SendGrid (recommended) with personalizations
async function sendWithSendGrid({ fromEmail, fromName, to, subject, text, html, listUnsubscribe }) {
  // using personalizations to send one-by-one for best tracking and deliverability
  const msg = {
    personalizations: [{
      to: [{ email: to }],
      subject
    }],
    from: { email: fromEmail, name: fromName || undefined },
    content: [
      { type: 'text/plain', value: text || '' },
      { type: 'text/html', value: html || (text ? `<pre>${text}</pre>` : '') }
    ],
    headers: {}
  };
  if (listUnsubscribe) {
    // Recommended header for unsubscribe; can be mailto or URL. Placeholder if not provided.
    msg.headers['List-Unsubscribe'] = `<${listUnsubscribe}>`;
  }

  // send
  return sgMail.send(msg);
}

// Send using SMTP (nodemailer) per recipient
async function sendWithSmtp(transporter, { fromEmail, fromName, to, subject, text, html, listUnsubscribe }) {
  const mail = {
    from: `${fromName || 'Anonymous'} <${fromEmail}>`,
    to,
    subject,
    text,
    html,
    headers: {}
  };
  if (listUnsubscribe) mail.headers['List-Unsubscribe'] = `<${listUnsubscribe}>`;
  return transporter.sendMail(mail);
}

// ---------- Auth middleware ----------
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.headers['accept'] && req.headers['accept'].includes('application/json')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return res.redirect('/');
}

// ---------- Routes: login / launcher / logout ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/login', (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();
    if (!username || !password) return res.status(400).json({ success: false, message: 'Missing' });
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      req.session.user = username;
      log('User logged in:', username, 'from', req.ip);
      return res.json({ success: true });
    }
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  } catch (err) {
    log('Login error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/launcher', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'launcher.html')));

app.post('/logout', (req, res) => {
  const u = req.session && req.session.user;
  req.session.destroy(() => {
    res.clearCookie('connect.sid', { path: '/' });
    log('User logged out:', u);
    res.json({ success: true });
  });
});

// ---------- Core: bulk sending endpoint ----------
/**
 * POST /sendBulk
 * Body:
 * {
 *   senderName, fromEmail, useSendGrid (boolean), smtpFallback (boolean),
 *   subject, text, html, recipients (comma/newline/; separated string),
 *   concurrency (optional int), retries (optional int), listUnsubscribe (optional url)
 * }
 *
 * Response: immediate JSON with job summary when finished
 */
app.post('/sendBulk', requireAuth, async (req, res) => {
  // Validate and normalize input
  try {
    const body = req.body || {};
    const senderName = String(body.senderName || '').trim();
    const fromEmail = String(body.fromEmail || '').trim(); // SMTP/SendGrid authenticated user
    const subj = String(body.subject || '').trim();
    const text = String(body.text || '').trim();
    const html = body.html ? String(body.html) : null;
    const recipientsRaw = String(body.recipients || '');
    const listUnsubscribe = body.listUnsubscribe ? String(body.listUnsubscribe) : null;

    // concurrency and retries with sanity caps
    let concurrency = Number.isInteger(body.concurrency) ? Math.max(1, Math.min(100, body.concurrency)) : 30;
    let retries = Number.isInteger(body.retries) ? Math.max(0, Math.min(5, body.retries)) : 3;

    if (!fromEmail) return res.status(400).json({ success: false, message: 'fromEmail required' });
    if (!recipientsRaw) return res.status(400).json({ success: false, message: 'recipients required' });

    // parse and dedupe recipients
    const rawList = recipientsRaw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    let recipients = dedupeList(rawList).filter(isValidEmail);
    if (recipients.length === 0) return res.status(400).json({ success: false, message: 'No valid recipients' });

    // small safety: cap total recipients per request to avoid abuse
    const MAX_RECIPIENTS = 2000;
    if (recipients.length > MAX_RECIPIENTS) recipients = recipients.slice(0, MAX_RECIPIENTS);

    log('sendBulk request', { fromEmail, count: recipients.length, concurrency, retries, useSendGrid: !!SENDGRID_API_KEY });

    // transporter for SMTP fallback (created once)
    const smtpTransporter = createSmtpTransport();

    // job state
    const results = []; // {to, ok:true|false, error?}
    let idx = 0;

    // worker function
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
            // primary: SendGrid if api key present
            if (SENDGRID_API_KEY) {
              await sendWithSendGrid({
                fromEmail,
                fromName: senderName,
                to,
                subject: subj,
                text,
                html,
                listUnsubscribe
              });
            } else if (smtpTransporter) {
              // fallback to smtp
              await sendWithSmtp(smtpTransporter, {
                fromEmail,
                fromName: senderName,
                to,
                subject: subj,
                text,
                html,
                listUnsubscribe
              });
            } else {
              throw new Error('No send method available (missing SendGrid key and SMTP credentials)');
            }
            sent = true;
            results.push({ to, ok: true, attempts: attempt });
            // small spacing to avoid bursts (jitter)
            await sleep(Math.floor(Math.random() * 50));
          } catch (err) {
            lastError = err;
            const d = backoffDelay(attempt, 200); // base 200ms
            log(`Send failed to ${to} attempt ${attempt}, delaying ${d}ms error:`, err && err.message ? err.message : err);
            await sleep(d);
          }
        } // end attempts

        if (!sent) {
          results.push({ to, ok: false, attempts: attempt - 1, error: lastError ? String(lastError.message || lastError) : 'Unknown' });
        }
      } // end while
    } // end worker

    // start worker pool
    const pool = [];
    const workerCount = Math.min(concurrency, recipients.length);
    for (let w = 0; w < workerCount; w++) pool.push(worker());
    await Promise.all(pool);

    // summary
    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;
    log(`Bulk send finished. total=${results.length} success=${successCount} fail=${failCount}`);

    // Return detailed summary but client will show only single popup as requested
    return res.json({
      success: failCount === 0,
      total: results.length,
      successCount,
      failCount,
      failures: results.filter(r => !r.ok).slice(0, 50) // limit details
    });

  } catch (err) {
    log('sendBulk error', err);
    return res.status(500).json({ success: false, message: err && err.message ? err.message : 'Server error' });
  }
});

// ---------- small helper endpoint to check service status ----------
app.get('/status', (req, res) => {
  res.json({
    ok: true,
    sendgrid: !!SENDGRID_API_KEY,
    smtp: !!(SMTP_USER && SMTP_PASS),
    host: os.hostname()
  });
});

// ---------- Start server ----------
app.listen(PORT, () => {
  log('Server started on port', PORT);
});
