// server.js
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const validator = require('validator');

const app = express();
const PORT = process.env.PORT || 8080;

// Admin login (as you requested)
const ADMIN_USER = 'Yatendra';
const ADMIN_PASS = '@#Yatendra';

// Middlewares
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'short-secret-key', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
const isEmail = e => validator.isEmail(String(e || '').trim());
const sleep = ms => new Promise(r => setTimeout(r, ms));
function chunkArray(arr, size){ const out=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }

// Auth middleware
function requireAuth(req, res, next){
  if(req.session && req.session.user) return next();
  if(req.headers.accept && req.headers.accept.includes('application/json')) return res.status(401).json({ success:false, message:'Unauthorized' });
  return res.redirect('/');
}

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/login', (req, res) => {
  const u = String(req.body.username || '').trim();
  const p = String(req.body.password || '').trim();
  if(!u || !p) return res.status(400).json({ success:false, message:'Missing' });
  if(u === ADMIN_USER && p === ADMIN_PASS){ req.session.user = u; return res.json({ success:true }); }
  return res.status(401).json({ success:false, message:'Invalid' });
});

app.get('/launcher', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'launcher.html')));

app.post('/logout', (req, res) => {
  req.session.destroy(()=>{ res.clearCookie('connect.sid'); res.json({ success:true }); });
});

// Core: sendBulk using SMTP (Gmail app password)
app.post('/sendBulk', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const smtpUser = String(body.smtpUser || '').trim();   // gmail id
    const smtpPass = String(body.smtpPass || '').trim();   // app password
    const fromEmail = String(body.fromEmail || smtpUser || '').trim();
    const senderName = String(body.senderName || 'Anonymous').trim();
    const subject = String(body.subject || '').trim();
    const text = String(body.text || '').trim();
    const rawRecipients = String(body.recipients || '').trim();

    if(!smtpUser || !smtpPass) return res.status(400).json({ success:false, auth:false, message:'SMTP credentials required' });
    if(!fromEmail) return res.status(400).json({ success:false, message:'From email required' });
    if(!rawRecipients) return res.status(400).json({ success:false, message:'Recipients required' });

    // parse, dedupe, validate
    const parsed = rawRecipients.split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean);
    const seen = new Set();
    const recipients = [];
    for(const r of parsed){
      const L = r.toLowerCase();
      if(!r) continue;
      if(seen.has(L)) continue;
      if(!isEmail(r)) continue;
      seen.add(L);
      recipients.push(r);
    }
    if(recipients.length === 0) return res.status(400).json({ success:false, message:'No valid recipients' });

    // safety cap
    const MAX_RECIPIENTS = 2000;
    if(recipients.length > MAX_RECIPIENTS) recipients.splice(MAX_RECIPIENTS);

    // concurrency & batch size (server-controlled defaults)
    const concurrency = Number.isInteger(body.concurrency) ? Math.max(1, Math.min(50, body.concurrency)) : 5;
    const attempts = Number.isInteger(body.retries) ? Math.max(0, Math.min(6, body.retries)) : 3;

    // create transporter (single reus
