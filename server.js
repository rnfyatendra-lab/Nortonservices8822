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

/* ===== SPEED & LIMITS (EXACT SAME) ===== */
const HOURLY_LIMIT = 28;
const PARALLEL = 3;     // SAME
const DELAY_MS = 120;   // SAME

/* In-memory hourly counters */
let stats = {};
setInterval(() => { stats = {}; }, 60 * 60 * 1000);

/* ===== SAFE HELPERS ===== */

/* Subject: minimal cleanup, no manipulation */
function safeSubject(subject) {
  return subject
    .replace(/\r?\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* Body: plain text + footer (3 blank lines) */
function safeBody(message) {
  const clean = message
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  return `${clean}\n\n\nScanned & secured`;
}

/* Light email validation */
function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/* ===== SEND ENGINE (HUMAN-LIKE, STABLE) ===== */
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

  /* Hourly limit per Gmail */
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

  /* Gmail-official SMTP (no hacks) */
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    pool: true,            // stable reuse
    maxConnections: 3,     // SAME speed
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
    from: `"${senderName}" <${gmail}>`, // real sender only
    to: r,
    subject: safeSubject(subject),
    text: safeBody(message),            // TEXT ONLY
    replyTo: gmail
    // ❌ no tracking, ❌ no custom spammy headers
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
  console.log("Server running — real-world safe mode");
});
