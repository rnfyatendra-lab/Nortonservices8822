// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// 🔐 LOGIN (ID & PASSWORD SAME)
const HARD_USERNAME = "mailinbox@#";
const HARD_PASSWORD = "mailinbox@#";

// ================= STATE =================
let mailLimits = {}; // { gmail: { count, start } }
const sessionStore = new session.MemoryStore();

// ================= MIDDLEWARE =================
app.use(bodyParser.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'mailer-secret',
  resave: false,
  saveUninitialized: true,
  store: sessionStore,
  cookie: { maxAge: 60 * 60 * 1000 } // 1 hour
}));

// ================= AUTH =================
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/');
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
  return res.json({ success: false, message: "Invalid login" });
});

app.get('/launcher', requireAuth, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'))
);

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ================= HELPERS =================
const delay = ms => new Promise(r => setTimeout(r, ms));

// ⚡ SPEED SAME: batch 5 + 300ms
async function sendBatch(transporter, mails) {
  for (let i = 0; i < mails.length; i += 5) {
    await Promise.allSettled(
      mails.slice(i, i + 5).map(m => transporter.sendMail(m))
    );
    await delay(300);
  }
}

// ===== SUBJECT (NO WORD CHANGE) =====
function safeSubject(subject) {
  return (subject || "Hello")
    .replace(/\r?\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ===== BODY (CONTEXT-AWARE SAFE WORDS) =====
function safeBody(message) {
  let text = (message || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .trim();

  /**
   * ONLY HIGH-RISK WORDS
   * Replaced ONLY when they appear:
   *  - at line start
   *  - standalone
   *  - or in pushy phrases
   */
  const RULES = [
    { re: /^\s*free\b/gi, to: "available at no additional cost" },
    { re: /\bfree\b/gi, to: "no additional cost" },

    { re: /^\s*urgent\b/gi, to: "time-sensitive" },
    { re: /\burgent\b/gi, to: "time-sensitive" },

    { re: /^\s*offer\b/gi, to: "an option" },
    { re: /\boffer\b/gi, to: "an option" },

    { re: /\bdiscount\b/gi, to: "adjusted pricing" },
    { re: /\bdeal\b/gi, to: "arrangement" },

    { re: /\bguarantee\b/gi, to: "aim to" },

    // Visuals (safe neutral)
    { re: /\bimage\b/gi, to: "reference image" },
    { re: /\bscreenshot\b/gi, to: "reference image" },

    // Tech issues
    { re: /\berror\b/gi, to: "an issue noticed" },
    { re: /\bproblem\b/gi, to: "a concern identified" },

    // Greetings (normalize only)
    { re: /^\s*(hey|hi|hello|helllo)\b[!,.]*/gim, to: "Hello" }
  ];

  RULES.forEach(r => {
    if (r.re.test(text)) {
      text = text.replace(r.re, r.to);
    }
  });

  return text;
}

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// ================= SEND =================
app.post('/send', requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } = req.body;
    if (!email || !password || !recipients) {
      return res.json({ success: false, message: "Missing fields" });
    }

    // ⏱ Hourly reset
    const now = Date.now();
    if (!mailLimits[email] || now - mailLimits[email].start > 3600000) {
      mailLimits[email] = { count: 0, start: now };
    }

    const list = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(isValidEmail);

    if (mailLimits[email].count + list.length > 27) {
      return res.json({
        success: false,
        message: `Limit Full ❌ | Used ${mailLimits[email].count} / 27`
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    // Verify App Password
    try {
      await transporter.verify();
    } catch {
      return res.json({ success: false, message: "App Password Wrong ❌" });
    }

    const mails = list.map(r => ({
      from: `"${senderName || 'User'}" <${email}>`,
      to: r,
      subject: safeSubject(subject),
      text: safeBody(message),
      replyTo: email
    }));

    await sendBatch(transporter, mails);
    mailLimits[email].count += list.length;

    return res.json({
      success: true,
      message: `Mail sent ✅\nUsed ${mailLimits[email].count} / 27`
    });

  } catch (e) {
    return res.json({ success: false, message: e.message });
  }
});

// ================= START =================
app.listen(PORT, () =>
  console.log("🚀 Mail server running (max inbox-safe mode)")
);
