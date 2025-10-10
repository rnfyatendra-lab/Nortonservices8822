// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// 🔑 Hardcoded login
const HARD_USERNAME = "Yatendra Rajput";
const HARD_PASSWORD = "Yattu@882";

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'bulk-mailer-secret',
  resave: false,
  saveUninitialized: true
}));

// 🔒 Auth middleware
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/');
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === HARD_USERNAME && password === HARD_PASSWORD) {
    req.session.user = username;
    return res.json({ success: true });
  }
  return res.json({ success: false, message: "❌ Invalid credentials" });
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

// Helper function for delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function for batch sending
async function sendBatch(transporter, mails, batchSize = 5) {
  const results = [];
  for (let i = 0; i < mails.length; i += batchSize) {
    const batch = mails.slice(i, i + batchSize);
    const promises = batch.map(mail => transporter.sendMail(mail));
    const settled = await Promise.allSettled(promises);
    results.push(...settled);

    // Small pause between batches to avoid Gmail rate-limit
    await delay(200); // 0.2 sec pause
  }
  return results;
}

// ✅ Bulk Mail Sender with fast batch sending
app.post('/send', requireAuth, async (req, res) => {
  try {
    const { senderName, email, password, recipients, subject, message } = req.body;
    if (!email || !password || !recipients) {
      return res.json({ success: false, message: "Email, password and recipients required" });
    }

    const recipientList = recipients
      .split(/[\n,]+/)
      .map(r => r.trim())
      .filter(r => r);

    if (recipientList.length === 0) {
      return res.json({ success: false, message: "No valid recipients" });
    }

    // ✅ Single transporter
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password }
    });

    // Prepare mails
    const mails = recipientList.map(r => ({
      from: `"${senderName || 'Anonymous'}" <${email}>`,
      to: r,
      subject: subject || "No Subject",
      text: message || ""
    }));

    // Send mails in batches (parallel within batch)
    await sendBatch(transporter, mails, 5); // 5 mails parallel

    return res.json({ success: true, message: `✅ Mail sent to ${recipientList.length}` });

  } catch (err) {
    console.error("Send error:", err);
    return res.json({ success: false, message: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
