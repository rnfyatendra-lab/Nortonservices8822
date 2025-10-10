// server.js — FAST BULK MAIL VERSION ⚡️
const express = require("express");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const session = require("express-session");
const path = require("path");

const app = express();

// Middleware setup
app.use(bodyParser.json());
app.use(
  session({
    secret: "change_this_secret",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 },
  })
);

// Serve static files from "public"
app.use(express.static(path.join(__dirname, "public")));

// Root fix → serve login.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Credentials
const VALID_ID = "YatendraSingh@#";
const VALID_PW = "YatendraSingh@";

// Login route
app.post("/login", (req, res) => {
  const { id, pw } = req.body;
  if (id === VALID_ID && pw === VALID_PW) {
    req.session.logged = true;
    req.session.user = id;
    return res.json({ ok: true });
  }
  res.json({ ok: false });
});

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});


// ✅ FAST BULK MAIL SEND ENDPOINT
app.post("/send", async (req, res) => {
  try {
    if (!req.session.logged)
      return res.json({ ok: false, error: "Not authenticated" });

    const { name, senderEmail, appPassword, subject, template, recipients } =
      req.body;

    if (
      !senderEmail ||
      !appPassword ||
      !subject ||
      !Array.isArray(recipients) ||
      recipients.length === 0
    ) {
      return res.json({ ok: false, error: "Missing fields" });
    }

    console.log(`⚡ Sending bulk mail to ${recipients.length} recipients...`);

    // Create transporter (Gmail + App Password)
    let transporter;
    try {
      transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: senderEmail, pass: appPassword },
      });
      await transporter.verify();
    } catch (smtpErr) {
      console.error("SMTP Connection failed:", smtpErr.message);
      return res.json({ ok: false, error: "Wrong app password or SMTP issue" });
    }

    // --- Fast sending logic ---
    const concurrency = 5; // how many mails send in parallel (tune this)
    let successCount = 0;
    let failCount = 0;

    // Split recipients into batches of N (parallel limit)
    const chunkArray = (arr, size) => {
      const res = [];
      for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
      return res;
    };

    const batches = chunkArray(recipients, concurrency);

    for (const batch of batches) {
      await Promise.all(
        batch.map(async (to) => {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
            console.log("Skipping invalid email:", to);
            failCount++;
            return;
          }
          const personalized = (template || "").replace(/\{\{name\}\}/g, name || "");
          const mailOptions = {
            from: senderEmail,
            to,
            subject,
            text: personalized || " ",
          };
          try {
            await transporter.sendMail(mailOptions);
            console.log("✅ Sent to:", to);
            successCount++;
          } catch (err) {
            console.error("❌ Failed for:", to, err.message);
            failCount++;
          }
        })
      );
      // Optional short delay between batches
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`✅ Done! Success: ${successCount}, Failed: ${failCount}`);
    if (successCount > 0)
      res.json({ ok: true, message: `Sent ${successCount} mails successfully` });
    else res.json({ ok: false, error: "All send attempts failed." });
  } catch (err) {
    console.error("Send bulk error:", err.message);
    res.json({ ok: false, error: "Unexpected server error" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
