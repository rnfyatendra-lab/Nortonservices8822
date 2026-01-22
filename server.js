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

// ⚡ SPEED SAME
async function sendBatch(transporter, mails) {
  for (let i = 0; i < mails.length; i += 5) {
    await Promise.allSettled(
      mails.slice(i, i + 5).map(m => transporter.sendMail(m))
    );
    await delay(300);
  }
}

/**
 * SUBJECT NORMALIZATION (LEGIT)
 * - If risky words present → auto set neutral subject
 * - Short, human, non-salesy
 */
function safeSubject(subject) {
  const base = (subject || "").toLowerCase();

  // Words that often correlate with promotional filters
  const risky = [
    "free","urgent","offer","discount","deal","sale","guarantee",
    "seo","rank","google","image","screenshot",
    "hey","hi","hello","helllo",
    "price","quote","proposal","report","error"
  ];

  const hasRisk = risky.some(w => base.includes(w));

  // Neutral, provider-friendly fallbacks
  const neutralPool = [
    "Quick update",
    "Following up",
    "Information shared",
    "Details below",
    "Next steps",
    "Update"
  ];

  let finalSubject = subject || "Hello";

  if (hasRisk) {
    // Pick a neutral subject (deterministic but simple)
    const pick = neutralPool[Math.abs(base.length) % neutralPool.length];
    finalSubject = pick;
  }

  return finalSubject
    .replace(/\r?\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/[!$%*]{2,}/g, "")
    .trim();
}

/**
 * BODY NORMALIZATION
 * - Plain text only
 * - Softens common words (meaning preserved)
 */
function safeBody(message) {
  let t = (message || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .trim();

  const softenMap = [
    // greetings
    [/^\s*(hey|hi|hello|helllo)\b[!,.]*/gim, "Hello"],
    [/\b(hey|hi|hello|helllo)\b/gi, "hello"],

    // visuals
    [/\bimage\b/gi, "reference image"],
    [/\bscreenshot\b/gi, "reference image"],

    // business terms → neutral phrasing
    [/\bseo\b/gi, "search visibility"],
    [/\brank\b/gi, "current positioning"],
    [/\breport\b/gi, "summary details"],
    [/\bproposal\b/gi, "suggested approach"],
    [/\berror\b/gi, "an issue noticed"],
    [/\bgoogle\b/gi, "the search platform"],
    [/\bwebsite\b/gi, "the site"]
  ];

  softenMap.forEach(([re, rep]) => {
    t = t.replace(re, rep);
  });

  return t;
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

    // Safe zone
    if (mailLimits[email].count + list.length > 27) {
      return res.json({
        success: false,
        message: `Limit Full ❌ | Used ${mailLimits[email].count} / 27`
      });
    }

    // Gmail official SMTP
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    // Verify app password first
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
  console.log("🚀 Mail server running (auto-safe subject, inbox-friendly)")
);
