// server.js (robust, safe startup)
'use strict';

const fs = require('fs');
const path = require('path');

function safeRequire(name) {
  try { return require(name); }
  catch (e) {
    console.error(`Missing module "${name}". Run "npm install" in project root.`);
    console.error('Require error:', e && e.message);
    process.exit(1);
  }
}

const express = safeRequire('express');
const session = safeRequire('express-session');
const bodyParser = safeRequire('body-parser');
const nodemailer = safeRequire('nodemailer');
const validator = safeRequire('validator');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// admin credentials (as you requested)
const ADMIN_USER = 'nortonservices8822';
const ADMIN_PASS = 'services8822';

// Middlewares
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'fast-mailer-secret-please-change',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true }
}));

// Serve static public
const PUBLIC_DIR = path.join(__dirname, 'public');
if (!fs.existsSync(PUBLIC_DIR)) {
  console.error('Missing public/ folder. Create a folder named "public" with login.html etc.');
  process.exit(1);
}
app.use(express.static(PUBLIC_DIR));

// Small helpers
const isEmail = (e) => validator.isEmail(String(e || '').trim());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const backoff = (attempt, base = 200) => base * Math.pow(2, Math.max(0, attempt - 1)) + Math.floor(Math.random() * base);

// Safety: catch top-level exceptions and log (do not crash silently)
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && (err.stack || err.message) ? (err.stack || err.message) : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Health
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOStr
