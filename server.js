'use strict';

/*
  Spam-safer bulk mailer (Gmail SMTP + App Password)
  - Login: nortonservices8822 / services8822
  - MX lookup to skip bad domains
  - Per-domain throttling + low global concurrency (default 3)
  - Backoff retries on transient SMTP errors
  - Deliverability friendly headers (Reply-To, List-Unsubscribe, Message-ID)
  - Optional DKIM (fill selector/privateKey below to enable)
*/

const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const validator = require('validator');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// ---- AUTH (as requested) ----
const ADMIN_USER = 'nortonservices8822';
const ADMIN_PASS = 'services8822';

// ---- OPTIONAL: DKIM (fill to enable, else leave nulls) ----
const DKIM_SELECTOR = null;   // e.g. "mail"
const DKIM_PRIVATE_KEY = null; // paste PEM string here (or keep null to disable)

// ---- MIDDLEWARES ----
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'fast-mailer-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---- HELPERS ----
const isEmail = e => validator.isEmail(String(e || '').trim());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = n => Math.floor(Math.random() * n);
const backoff = (attempt, base=400) => base * Math.pow(2, Math.max(0, attempt - 1)) + jitter(base);

async function hasMxOrA(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.length) return true;
  } catch (_) {}
  try {
    const a = await dns.resolve(domain);
    if (a && a.length) return true;
  } catch (_) {}
  return false;
}

async function prepareRecipients(raw) {
  const parsed = String(raw || '')
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const seen =
