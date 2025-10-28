// server.js (improved)
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

// Admin login credentials from env (avoid hardcoding)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Yatendra Rajput';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Yattu@882';

app.use(helmet());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Basic request rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // max requests per IP per window
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Session config
app.use(session({
  secret: process.env.SESSION_SECRET || 'replace-this-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // set true when using HTTPS in production
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 4 // 4 hours
  }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/');
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.json({ success: false, message: 'Missing credentials' });
  }
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.user = username;
    return res.json({ success: true });
  }
  return res.json({ success: false, message: '❌ Invalid credentials' });
});

app.get('/launcher', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  });
});

// helpers
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function isLikelyEmail(s) {
  return validator.isEmail(String(s || '').trim());
}

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

    if (i + batchSize < mailObjects.length) {
      await delay(batchDelayMs);
    }
  }
  return results;
}

// send endpoint
app.post('/send', requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message, batchSize, batchDelayMs } = req.body || {};

    if (!email || !password || !recipients) {
      return res.json({ success: false, message: 'Email, password and recipients required' });
    }

    // parse recipients (comma, semicolon, newline)
    const recipientList = String(recipients)
      .split(/[\n,;]+/)
      .map(r => r.trim())
      .filter(Boolean);

    if (recipientList.length === 0) {
      return res.json({ success: false, message: 'No valid recipients found' });
    }

    // validate recipient emails
    const invalids = recipientList.filter(r => !isLikelyEmail(r));
    if (invalids.length > 0) {
      return res.json({ success: false, message: `Invalid email(s): ${invalids.join(', ')}` });
    }

    // create transporter
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: email,
        pass: password
      }
    });

    // verify transporter auth
    try {
      await transporter.verify();
    } catch (verifyErr) {
      return res.json({ success: false, message: 'SMTP auth/verify failed: ' + (verifyErr && verifyErr.message ? verifyErr.message : verifyErr) });
    }

    // prepare mail objects
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
    return res.json({ success: false, message: err && err.message ? err.message : String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
