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

/* ===== SPEED & LIMITS ===== */
const HOURLY_LIMIT = 28;
const PARALLEL = 3;      // FAST & SAFE
const DELAY_MS = 120;    // FAST & SAFE

let stats = {};
setInterval(() => { stats = {}; }, 60 * 60 * 1000);

/* ===== SAFE SUBJECT ===== */
function safeSubject(subject) {
  return subject
    .replace(/\r?\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/free|urgent|act now|guarantee/gi, "")
    .trim();
}

/* ===== SAFE BODY + FOOTER ===== */
function safeBody(message) {
  const clean = message
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  return `${clean}\n\n\nScanned & secured`;
}

/* ===== SEND ENGINE ===== */
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
    return res.json({ success: false, msg: "Hourly limit reached", count: stats[gmail].count });
  }

  const recipients = to
    .split(/,|\r?\n/)
    .map(r => r.trim())
    .filter(r => r.includes("@"))
    .slice(0, HOURLY_LIMIT - stats[gmail].count);

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 3,
    auth: { user: gmail, pass: apppass }
  });

  try {
    await transporter.verify();
  } catch {
    return res.json({ success: false, msg: "Invalid App Password", count: stats[gmail].count });
  }

  const mails = recipients.map(r => ({
    from: `"${senderName}" <${gmail}>`,
    to: r,
    subject: safeSubject(subject),
    text: safeBody(message),
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails);
  stats[gmail].count += sent;

  res.json({ success: true, sent, count: stats[gmail].count });
});

/* ===== START ===== */
app.listen(3000, () => {
  console.log("✅ Safe Mail Server running");
});
