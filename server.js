// server.js (fixed & safe)
const express = require("express");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const session = require("express-session");
const path = require("path");

const app = express();

app.use(bodyParser.json());
app.use(
  session({
    secret: "change_this_secret",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 },
  })
);

// Serve static files
app.use(express.static(path.join(__dirname, "/")));

const VALID_ID = "YatendraSingh@#";
const VALID_PW = "YatendraSingh@";

app.post("/login", (req, res) => {
  const { id, pw } = req.body;
  if (id === VALID_ID && pw === VALID_PW) {
    req.session.logged = true;
    req.session.user = id;
    return res.json({ ok: true });
  }
  res.json({ ok: false });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {});
  res.json({ ok: true });
});

app.post("/send", async (req, res) => {
  try {
    if (!req.session.logged) return res.json({ ok: false, error: "Not authenticated" });

    const { name, senderEmail, appPassword, subject, template, recipients } = req.body;

    if (!senderEmail || !appPassword || !subject || !Array.isArray(recipients) || recipients.length === 0) {
      return res.json({ ok: false, error: "Missing fields" });
    }

    // create transporter
    let transporter;
    try {
      transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: senderEmail, pass: appPassword },
      });
      await transporter.verify();
    } catch (smtpErr) {
      console.error("SMTP Connection failed:", smtpErr && smtpErr.message ? smtpErr.message : smtpErr);
      return res.json({ ok: false, error: "Wrong app password or SMTP issue" });
    }

    console.log(`Starting bulk send (${recipients.length} recipients)...`);

    let successCount = 0;
    let failCount = 0;

    // sequential send (small delay to reduce rate-limit risk)
    for (const to of recipients) {
      // basic email validation
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        console.log("Skipping invalid email:", to);
        failCount++;
        continue;
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
        console.log("Sent to:", to);
        successCount++;
      } catch (mailErr) {
        console.error("Send failed for:", to, mailErr && mailErr.message ? mailErr.message : mailErr);
        failCount++;
      }

      // tiny delay — adjust if you want faster or slower
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log(`Bulk send complete. Success: ${successCount}, Failed: ${failCount}`);

    if (successCount > 0) {
      return res.json({ ok: true, message: "Mail sent successfully", success: successCount, failed: failCount });
    } else {
      return res.json({ ok: false, error: "All send attempts failed. Check credentials or SMTP." });
    }
  } catch (err) {
    console.error("Send bulk error (caught):", err && err.message ? err.message : err);
    return res.json({ ok: false, error: "Unexpected error in sending process." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
