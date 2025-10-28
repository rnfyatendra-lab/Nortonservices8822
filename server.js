// server.js
'use strict';

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const validator = require('validator');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// Admin creds (as you requested)
const ADMIN_USER = 'Yatendra';
const ADMIN_PASS = '@#Yatendra';

// Middlewares
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'short-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true }
}));

// Serve static files (public)
app.use(express.static(path.join(__dirname, 'public')));

// He
