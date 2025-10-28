const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

const ADMIN_USER = "Yatendra";
const ADMIN_PASS = "@#Yatendra";

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: "s", resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "login.html"))
);

app.post("/login", (req, res) => {
  const u = (req.body.username || "").trim();
  const p = (req.body.password || "").trim();
  if (u === ADMIN_USER && p === ADMIN_PASS) {
    req.session.user = u;
    return res.json({ success: true });
  }
  res.json({ success: false, message: "Invalid" });
});

function auth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).redirect("/");
}

app.get("/launcher", auth, (req, res) =>
  res.sendFile(path.join(__dirname, "public", "launcher.html"))
);

app.post("/logout", (req, res) =>
  req.session.destroy(() => res.json({ success: true }))
);

// fast single-send endpoint (client will call concurrently)
app.post("/sendOne", auth, async (req, res) => {
  try {
    const { email, password, senderName, to, subject, message } = req.body;
    if (!email || !password || !to)
      return res.json({ success: false, to, message: "missing" });
    const tx = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: email, pass: password },
    });
    await tx.sendMail({
      from: `"${senderName || "Anon"}" <${email}>`,
      to,
      subject: subject || "",
      text: message || "",
    });
    res.json({ success: true, to });
  } catch (e) {
    res.json({ success: false, to: req.body?.to, message: e.message || "err" });
  }
});

app.listen(PORT, () => console.log("Server on http://localhost:" + PORT));
