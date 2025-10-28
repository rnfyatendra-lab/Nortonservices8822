// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// original hardcoded credentials (from your first code)
const HARD_USERNAME = "Yatendra Rajput";
const HARD_PASSWORD = "Yattu@882";

// Middlewares
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'bulk-mailer-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Simple request logger (helps debugging)
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  // if ajax/fetch expecting json, return json 401
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return res.redirect('/');
}

// Routes
app.get('/', (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  t
