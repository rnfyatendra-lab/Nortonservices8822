// server.js (robust startup + helpful errors)
'use strict';

const fs = require('fs');
const path = require('path');

function safeRequire(name){
  try {
    return require(name);
  } catch (e) {
    console.error(`Missing module: ${name}. Run "npm install ${name}" and try again.`);
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

// very small sanity checks
if (Number.isNaN(PORT) || PORT <= 0) {
  console.error('Invalid PORT:', process.env.PORT);
  process.exit(1);
}

// middlewares
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'short-secret-key', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// health route
app.get('/health', (req, res) => res.json({ ok: true, pid: process.pid, time: new Date().toISOString() }));

// simple root serve
app.get('/', (req, res) => {
  const f = path.join(__dirname, 'public', 'login.html');
  if (!fs.existsSync(f)) {
    return res.status(500).send('login.html not found in public/ — please ensure public/login.html exists.');
  }
  return res.sendFile(f);
});

// simple error handler for any sync startup issue
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', (err && err.stack) ? err.stack : err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// start server
app.listen(PORT, () => {
  console.log(`✅ Server started on http://localhost:${PORT}`);
});
