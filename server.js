require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Public folder path (Render safe)
const PUBLIC_DIR = path.join(process.cwd(), "public");

// ✅ Login Credentials
const HARD_USERNAME = "Yatendra-Lodhi";
const HARD_PASSWORD = "bulk-mailing";

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(PUBLIC_DIR));

app.use(session({
  secret: process.env.SESSION_SECRET || 'bulk-mailer-secret',
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/');
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/login', (req, res) => {
  const username = req.body.username?.trim();
  const password = req.body.password?.trim();

  if (username === HARD_USERNAME && password === HARD_PASSWORD) {
    req.session.user = username;
    return res.json({ success: true });
  }
  return res.json({ success: false, message: "❌ Invalid credentials" });
});

app.get('/launcher', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'launcher.html'));
});

// Optional: auth status (useful if ever needed)
app.get('/auth/check', (req, res) => {
  res.json({ authenticated: !!req.session?.user });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    return res.json({ success: true });
  });
});

// Delay helper
const delay = ms => new Promise(res => setTimeout(res, ms));

// Batch sender
async function sendBatch(transporter, mails, batchSize = 5) {
  for (let i = 0; i < mails.length; i += batchSize) {
    const batch = mails.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(m => transporter.sendMail(m)));
    await delay(200);
  }
}

// Bulk Email API
app.post('/send', requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } = req.body;

    if (!email || !password || !recipients)
      return res.json({ success: false, message: "Email, password and recipients required" });

    const list = recipients.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);
    if (!list.length)
      return res.json({ success: false, message: "No valid recipients" });

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    const mails = list.map(r => ({
      from: `"${senderName || 'Anonymous'}" <${email}>`,
      to: r,
      subject: subject || "No Subject",
      text: message || ""
    }));

    await sendBatch(transporter, mails, 5);
    return res.json({ success: true, message: `✅ Mail sent to ${list.length}` });

  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
});

// Fallback
app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
