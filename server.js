// server.js
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const validator = require('validator');

const app = express();
const PORT = process.env.PORT || 8080;

// admin credentials (as requested)
const ADMIN_USER = 'Yatendra';
const ADMIN_PASS = '@#Yatendra';

// middleware
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'short-secret-key',
  resave: false,
  saveUninitialized
