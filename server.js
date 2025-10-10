// server.js - FINAL FIXED VERSION (No "Cannot GET /" issue)
const express = require("express");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const session = require("express-session");
const path = require("path");

const app = express();

// Middleware
app.use(bodyParser.json());
app.use(
  session({
    secret: "change_this_secret",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 },
  })
);

// ✅ Serve static files from "public" folder
app.use(express.static(path.join(__dirname, "public")));

// ✅ Fix: Root (/) par login.html open hoga
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Login credentials
const VALID_ID = "YatendraSingh@#";
const VALID_PW = "YatendraSingh@";

app.post("/login", (req, res) => {
  const { id, pw } = req.body;
