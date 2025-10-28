// server.js - SMTP-only robust bulk sender
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const validator = require('validator');

const app = express();
const PORT = process.env.PORT || 8080;

// login creds
const ADMIN_USER = 'Yatendra';
const ADMIN_PASS = '@#Yatendra';

// middlewares
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'short-secret', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// helpers
const isEmail = e => validator.isEmail(String(e || '').trim());
const dedupe = arr => {
  const s = new Set();
  return arr.map(x => String(x||'').trim()).filter(Boolean).filter(x => {
    const L = x.toLowerCase();
    if (s.has(L)) return false;
    s.add(L); return true;
  });
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = (attempt, base = 300) => base * Math.pow(2, Math.max(0, attempt - 1)) + Math.floor(Math.random() * base);

// auth middleware
function requireAuth(req, res, next){
  if(req.session && req.session.user) return next();
  if(req.headers.accept && req.headers.accept.includes('application/json')) return res.status(401).json({ success: false, message: 'Unauthorized' });
  return res.redirect('/');
}

// routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.post('/login', (req, res) => {
  const u = String(req.body.username || '').trim();
  const p = String(req.body.password || '').trim();
  if(!u||!p) return res.status(400).json({ success:false, message:'Missing' });
  if(u === ADMIN_USER && p === ADMIN_PASS){ req.session.user = u; return res.json({ success:true }); }
  return res.status(401).json({ success:false, message:'Invalid' });
});
app.get('/launcher', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'launcher.html')));
app.post('/logout', (req, res) => req.session.destroy(() => res.json({ success:true })));

// Core endpoint: sendBulk
app.post('/sendBulk', requireAuth, async (req, res) => {
  try {
    const {
      senderName = 'Anonymous',
