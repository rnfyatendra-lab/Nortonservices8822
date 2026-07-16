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

// Global memory to track email timestamps per Gmail ID
const emailTimestamps = {}; 
const LIMIT_WINDOW = 12 * 60 * 60 * 1000; // 12 Hours in milliseconds
const MAX_EMAILS = 26; // Hard limit

// Global cache for transporters to reuse SMTP connections
const transporterCache = {};

function getTransporter(gmailId, appPassword) {
  const cacheKey = `${gmailId}:${appPassword}`;
  if (!transporterCache[cacheKey]) {
    transporterCache[cacheKey] = nodemailer.createTransport({
      service: 'gmail',
      pool: true,             
      maxConnections: 6,      
      maxMessages: 100,       
      rateLimit: 6,           
      auth: { user: gmailId, pass: appPassword }
    });
    console.log(`📡 New SMTP pool created for: ${gmailId}`);
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

  const now = Date.now();

  // Initialize tracker for this Gmail ID if it doesn't exist
  if (!emailTimestamps[gmailId]) {
    emailTimestamps[gmailId] = [];
  }

  // Filter out timestamps older than 12 hours
  emailTimestamps[gmailId] = emailTimestamps[gmailId].filter(
    (timestamp) => now - timestamp < LIMIT_WINDOW
  );

  // Check if limit exceeded
  if (emailTimestamps[gmailId].length >= MAX_EMAILS) {
    console.warn(`⚠️ Limit Exceeded for ${gmailId}: Tried to send more than ${MAX_EMAILS} emails in 12 hours.`);
    return res.status(429).json({ 
      success: false, 
      message: `Limit Exceeded: Max ${MAX_EMAILS} emails per 12 hours allowed for this ID.` 
    });
  }

  const transporter = getTransporter(gmailId, appPassword);

  try {
    await transporter.sendMail({
      from: senderName ? `"${senderName}" <${gmailId}>` : `"${gmailId}" <${gmailId}>`,
      to,
      subject,
      text: messageBody,
      headers: {
        'X-Mailer': 'Microsoft Outlook 16.0', 
        'X-Priority': '3', 
        'Priority': 'normal'
      }
    });

    // Record the successful send timestamp
    emailTimestamps[gmailId].push(Date.now());
    
    res.json({ success: true });
  } catch (err) {
    console.error(`❌ ${to}:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Safety-Locked Fast Mailer on port ${PORT}`));
