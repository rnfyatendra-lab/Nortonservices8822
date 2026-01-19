import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ===== BASIC SECURITY ===== */
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ===== RATE LIMIT (ANTI-ABUSE) ===== */
app.use("/send", rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
}));

/* ROOT */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ===== SEND LIMITS ===== */
const HOURLY_LIMIT = 28;
const PARALLEL = 4;
const DELAY_MS = 90;

/* Memory-safe stats */
const stats = new Map();

/* Hourly reset */
setInterval(() => stats.clear(), 60 * 60 * 1000);

/* ===== HELPERS ===== */
function safeSubject(subject) {
  return subject.replace(/\r?\n/g, " ").trim();
}

function safeBody(message) {
  return message.replace(/\r\n/g, "\n");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ===== SEND ENGINE ===== */
async function sendSafely(transporter, mails) {
  let sent = 0;

  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);

    const results = await Promise.allSettled(
      batch.map(m => transporter.sendMail(m))
    );

    results.forEach(r => {
      if (r.status === "fulfilled") sent++;
    });

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  return sent;
}

/* ===== SEND API ===== */
app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (![senderName, gmail, apppass, to, subject, message].every(Boolean)) {
    return res.json({ success: false, msg: "Missing fields", count: 0 });
  }

  if (
    senderName.length > 60 ||
    subject.length > 200 ||
    message.length > 5000
  ) {
    return res.json({ success: false, msg: "Content too long", count: 0 });
  }

  const recipients = to
    .split(/,|\r?\n/)
    .map(r => r.trim())
    .filter(isValidEmail);

  if (recipients.length === 0 || recipients.length > 30) {
    return res.json({ success: false, msg: "Invalid recipient list", count: 0 });
  }

  const key = crypto.createHash("sha256").update(gmail).digest("hex");
  const record = stats.get(key) || { count: 0 };

  if (record.count >= HOURLY_LIMIT) {
    return res.json({
      success: false,
      msg: "Hourly limit reached",
      count: record.count
    });
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 4,
    maxMessages: 30,
    auth: {
      user: gmail,
      pass: apppass
    },
    tls: {
      rejectUnauthorized: true
    }
  });

  try {
    await transporter.verify();
  } catch {
    return res.json({
      success: false,
      msg: "Invalid Gmail or App Password",
      count: record.count
    });
  }

  const mails = recipients.map(r => ({
    from: `"${senderName}" <${gmail}>`,
    to: r,
    subject: safeSubject(subject),
    text: safeBody(message),
    replyTo: `"${senderName}" <${gmail}>`,
    headers: {
      "X-Mailer": "CleanMailer",
      "X-Priority": "3"
    }
  }));

  const sent = await sendSafely(transporter, mails);

  record.count += sent;
  stats.set(key, record);

  return res.json({
    success: true,
    sent,
    count: record.count
  });
});

/* ===== START ===== */
app.listen(3000, () =>
  console.log("Server running — ultra safe Gmail mode 🚀")
);
