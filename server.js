import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ===== ROOT ===== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ===== SPEED & LIMITS (UNCHANGED) ===== */
const HOURLY_LIMIT = 28;   // per Gmail / hour
const PARALLEL = 3;       // SAME SPEED
const DELAY_MS = 120;     // SAME SPEED

/* Gmail-wise counters */
let stats = {};
setInterval(() => { stats = {}; }, 60 * 60 * 1000);

/* ===== SAFE HELPERS ===== */

/* Subject: keep natural, remove spammy patterns */
function safeSubject(subject) {
  return subject
    .replace(/\r?\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/([!?])\1+/g, "$1")
    .replace(/\b(free|urgent|act now|guarantee|win|offer)\b/gi, "")
    .trim();
}

/* Body: plain text only + footer after 3 blank lines */
function safeBody(message) {
  const clean = message
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  return `${clean}\n\n\nScanned & secured`;
}

/* Email sanity (light) */
function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/* ===== SEND ENGINE (HUMAN-LIKE) ===== */
async function sendSafely(transporter, mails) {
  let sent = 0;

  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);

    const results = await Promise.allSettled(
      batch.map(m => transporter.sendMail(m))
    );

    results.forEach(r => r.status === "fulfilled" && sent++);
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  return sent;
}

/* ===== SEND API ===== */
app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!senderName || !gmail || !apppass || !to || !subject || !message) {
    return res.json({ success: false, msg: "Missing fields", count: 0 });
  }

  if (!stats[gmail]) stats[gmail] = { count: 0 };
  if (stats[gmail].count >= HOURLY_LIMIT) {
    return res.json({ success: false, msg: "Limit Full ❌", count: stats[gmail].count });
  }

  const recipients = to
    .split(/,|\r?\n/)
    .map(r => r.trim())
    .filter(isValidEmail);

  const remaining = HOURLY_LIMIT - stats[gmail].count;
  if (recipients.length === 0 || recipients.length > remaining) {
    return res.json({ success: false, msg: "Limit Full ❌", count: stats[gmail].count });
  }

  /* Gmail-safe transporter */
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    pool: true,              // reuse connections (stable)
    maxConnections: 3,       // SAME speed profile
    maxMessages: 30,
    auth: { user: gmail, pass: apppass },
    tls: { rejectUnauthorized: true }
  });

  try {
    await transporter.verify();
  } catch {
    return res.json({ success: false, msg: "Wrong Password ❌", count: stats[gmail].count });
  }

  const mails = recipients.map(r => ({
    from: `"${senderName}" <${gmail}>`,
    to: r,
    subject: safeSubject(subject),
    text: safeBody(message),     // TEXT ONLY = best inbox odds
    replyTo: `"${senderName}" <${gmail}>`,
    headers: {
      "X-Mailer": "CleanMailer",
      "X-Priority": "3"
    }
  }));

  const sent = await sendSafely(transporter, mails);
  stats[gmail].count += sent;

  return res.json({
    success: true,
    msg: "Mail sent ✅",
    sent,
    count: stats[gmail].count
  });
});

/* ===== START ===== */
app.listen(3000, () => {
  console.log("Server running — ultra-safe inbox mode");
});
