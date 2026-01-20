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

/* LIMITS & SPEED (SAME CLASS) */
const HOURLY_LIMIT = 28;
const PARALLEL = 5;   // same speed class as before
const DELAY_MS = 70;

let stats = {};
setInterval(() => { stats = {}; }, 60 * 60 * 1000);

/* SUBJECT: minimal cleanup (natural look) */
function safeSubject(s) {
  return s.replace(/\r?\n/g, " ").replace(/\s{2,}/g, " ").trim();
}

/* BODY: soften spam-sensitive words (NOT removed) */
function safeBody(message) {
  let t = message
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();

  // Softening map: keep meaning, reduce spam signals
  const soften = [
    [/seo/gi, "search optimization"],
    [/rank/gi, "position"],
    [/screenshot/gi, "reference image"],
    [/error/gi, "issue"],
    [/proposal/gi, "project outline"],
    [/report/gi, "summary"],
    [/website/gi, "site"],
    [/showing/gi, "demonstrating"],
    [/google/gi, "search engine"]
  ];

  soften.forEach(([re, rep]) => {
    t = t.replace(re, rep);
  });

  // Footer with exact 3-line gap
  return `${t}\n\n\nScanned safe & secured`;
}

/* Email sanity */
function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/* SEND ENGINE */
async function sendSafely(transporter, mails) {
  let sent = 0;
  for (let i = 0; i < mails.length; i += PARALLEL) {
    const batch = mails.slice(i, i + PARALLEL);
    const res = await Promise.allSettled(
      batch.map(m => transporter.sendMail(m))
    );
    res.forEach(r => r.status === "fulfilled" && sent++);
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

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    pool: true,
    maxConnections: PARALLEL,
    maxMessages: 50,
    auth: { user: gmail, pass: apppass }
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
    text: safeBody(message),
    replyTo: gmail
  }));

  const sent = await sendSafely(transporter, mails);
  stats[gmail].count += sent;

  res.json({ success: true, msg: "Mail sent ✅", sent, count: stats[gmail].count });
});

/* START */
app.listen(3000, () => console.log("Server running — SAFE inbox mode"));
