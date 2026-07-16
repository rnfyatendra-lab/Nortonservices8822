const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path       = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fast-mailer-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Global cache for transporters to reuse SMTP connections
const transporterCache = {};

function getTransporter(gmailId, appPassword) {
  const cacheKey = `${gmailId}:${appPassword}`;
  
  if (!transporterCache[cacheKey]) {
    // Creating a reusable pooled connection
    transporterCache[cacheKey] = nodemailer.createTransport({
      service: 'gmail',
      pool: true,             // Enable pooling! Keeps connection open
      maxConnections: 6,      // Matches your frontend parallel limit (6)
      maxMessages: 100,       // Max emails per connection before recycling
      rateLimit: 6,           // Max emails per second
      auth: { user: gmailId, pass: appPassword }
    });
    console.log(`📡 New pooled SMTP connection established for: ${gmailId}`);
  }
  return transporterCache[cacheKey];
}

function requireLogin(req, res, next) {
  if (req.session?.loggedIn) return next();
  res.redirect('/');
}

app.get('/', (req, res) => {
  if (req.session?.loggedIn) return res.redirect('/launcher');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/launcher', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || 'rrrr';
  const validPass = process.env.ADMIN_PASS || 'rrrr';
  if (username === validUser && password === validPass) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }
  res.json({ success: false, message: 'Invalid username or password' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.post('/api/send-email', requireLogin, async (req, res) => {
  const { senderName, gmailId, appPassword, subject, messageBody, to } = req.body;
  if (!gmailId || !appPassword || !to)
    return res.status(400).json({ success: false, message: 'Missing fields' });

  // Reusing the pooled connection instead of recreating it every time
  const transporter = getTransporter(gmailId, appPassword);

  try {
    await transporter.sendMail({
      from: senderName ? `"${senderName}" <${gmailId}>` : `"${gmailId}" <${gmailId}>`,
      to,
      subject,
      text: messageBody,
      // Essential headers for high deliverability (making it look like Outlook/Gmail manual mail)
      headers: {
        'X-Mailer': 'Microsoft Outlook 16.0', 
        'X-Priority': '3', // Normal Priority
        'Priority': 'normal'
      }
    });
    res.json({ success: true });
  } catch (err) {
    console.error(`❌ ${to}:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Optimized Fast Mailer on port ${PORT}`));
