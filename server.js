import express from "express";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ROOT */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

/* ===== LIMITS & SPEED ===== */
const HOURLY_LIMIT = 28;
const PARALLEL = 4;     // a bit faster (still safe)
const DELAY_MS = 90;    // a bit faster (still safe)

/* Hourly reset */
let stats = {};
setInterval(() => { stats = {}; }, 60 * 60 * 1000);

/* SUBJECT: PASS-THROUGH (no word change) */
function safeSubject(subject) {
  return subject.trim();
}

/* BODY: PASS-THROUGH (NO FOOTER) */
function safeBody(message) {
  return message.replace(/\r\n/g, "\n");
}

/* SEND ENGINE: individual mails */
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

/* SEND API */
app.post("/send", async (req, res) => {
  const { senderName, gmail, apppass, to, subject, message } = req.body;

  if (!senderName || !gmail || !apppass || !to || !subject || !message) {
    return res.json({ success: false, msg: "Missing fields", count: 0 });
  }

  if (subject.length > 200 || message.length > 5000) {
    return res.json({ success: false, msg: "Content too long", count: 0 });
  }

  const recipients = to
    .split(/,|\r?\n/)
    .map(r => r.trim())
    .filter(Boolean);

  if (recipients.length === 0 || recipients.length > 30) {
    return res.json({ success: false, msg: "Invalid recipient count", count: 0 });
  }

  if (!stats[gmail]) stats[gmail] = { count: 0 };
  if (stats[gmail].count >= HOURLY_LIMIT) {
    return res.json({ success: false, msg: "Hourly limit reached", count: stats[gmail].count });
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: gmail, pass: apppass }
  });

  try { await transporter.verify(); }
  catch {
    return res.json({ success: false, msg: "Invalid Gmail/App Password", count: stats[gmail].count });
  }

  const mails = recipients.map(r => ({
    from: `"${senderName}" <${gmail}>`,
    to: r,
    subject: safeSubject(subject), // exact words
    text: safeBody(message),       // exact words, no footer
    replyTo: `"${senderName}" <${gmail}>`
  }));

  const sent = await sendSafely(transporter, mails);
  stats[gmail].count += sent;
  return res.json({ success: true, sent, count: stats[gmail].count });
});

app.listen(3000, () => console.log("Server running (clean & fast safe mode)"));
