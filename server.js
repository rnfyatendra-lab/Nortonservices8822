// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// 🔑 LOGIN (same)
const HARD_USERNAME = "mailinbox@#";
const HARD_PASSWORD = "mailinbox@#";

// ================= STATE =================
let mailLimits = {};
const sessionStore = new session.MemoryStore();

// ================= MIDDLEWARE =================
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'mailer-secret',
  resave: false,
  saveUninitialized: true,
  store: sessionStore,
  cookie: { maxAge: 60 * 60 * 1000 }
}));

// ================= AUTH =================
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

// ================= ROUTES =================
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
);

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === HARD_USERNAME && password === HARD_PASSWORD) {
    req.session.user = username;
    return res.json({ success: true });
  }
  res.json({ success: false, message: "Invalid login" });
});

app.get('/launcher', requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'))
);

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ================= HELPERS =================
const delay = ms => new Promise(r => setTimeout(r, ms));

async function sendBatch(transporter, mails) {
  for (let i = 0; i < mails.length; i += 5) {
    await Promise.allSettled(mails.slice(i, i + 5).map(m => transporter.sendMail(m)));
    await delay(300); // SAME SPEED
  }
}

// ================= SEND =================
app.post('/send', requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } = req.body;
    if (!email || !password || !recipients)
      return res.json({ success: false, message: "Missing fields" });

    const now = Date.now();
    if (!mailLimits[email] || now - mailLimits[email].start > 3600000)
      mailLimits[email] = { count: 0, start: now };

    const list = recipients.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);

    if (mailLimits[email].count + list.length > 27) {
      return res.json({
        success: false,
        message: "Limit Full ❌",
        used: mailLimits[email].count,
        limit: 27
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    const mails = list.map(r => ({
      from: `"${senderName || 'User'}" <${email}>`,
      to: r,
      subject: subject || "No Subject",
      text: message || ""
    }));

    await sendBatch(transporter, mails);
    mailLimits[email].count += list.length;

    res.json({
      success: true,
      message: "Mail sent ✅",
      used: mailLimits[email].count,
      limit: 27
    });

  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.listen(PORT, () =>
  console.log("🚀 Mail system running on", PORT)
);
