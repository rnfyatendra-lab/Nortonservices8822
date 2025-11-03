// small spam-safer bulk mailer (Gmail SMTP + App Password)
'use strict';
const express = require('express');
const session = require('express-session');
const body = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');

const APP_USER = 'nortonservices8822'; // login user
const APP_PASS = 'services8822';       // login pass

const app = express();
const PORT = process.env.PORT || 8080;

app.use(body.json());
app.use(body.urlencoded({ extended: true }));
app.use(session({ secret: 'fast-mailer-small', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// util
const okEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const backoff = n => 200 * Math.pow(2, n-1) + Math.floor(Math.random()*150);

// auth
function needAuth(req, res, next){
  if (req.session && req.session.user) return next();
  if ((req.headers.accept||'').includes('application/json')) return res.status(401).json({ success:false });
  return res.redirect('/');
}

app.get('/', (req,res) => res.sendFile(path.join(__dirname,'public','login.html')));
app.post('/login', (req,res) => {
  const { username, password } = req.body || {};
  if (username === APP_USER && password === APP_PASS){ req.session.user = username; return res.json({ success:true }); }
  return res.status(401).json({ success:false, message:'Invalid credentials' });
});
app.get('/launcher', needAuth, (req,res) => res.sendFile(path.join(__dirname,'public','launcher.html')));
app.post('/logout', needAuth, (req,res) => req.session.destroy(()=>res.json({ success:true })));

// small, safe sender:
// - low global concurrency (2)
// - per-domain serial sending
// - envelope.from aligned to fromEmail (helps SPF)
// - Reply-To, List-Unsubscribe, Message-ID headers
app.post('/sendBulk', needAuth, async (req,res) => {
  try{
    const body = req.body || {};
    const smtpUser = String(body.smtpUser||'').trim();
    const smtpPass = String(body.smtpPass||'').trim();
    const fromEmail = String(body.fromEmail||smtpUser||'').trim();
    const senderName = String(body.senderName||'').replace(/"/g,'').trim() || 'Sender';
    const subject = String(body.subject||'(no subject)');
    const text = String(body.text||'');
    if (!smtpUser || !smtpPass) return res.status(400).json({ success:false, auth:false, message:'SMTP required' });

    const raw = String(body.recipients||'');
    let list = raw.split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean);
    list = Array.from(new Set(list)).filter(okEmail);
    if (!fromEmail || !list.length) return res.status(400).json({ success:false, message:'From/recipients required' });

    // group by domain (serial per domain)
    const buckets = {};
    for (const to of list){
      const d = to.split('@').pop().toLowerCase();
      buckets[d] = buckets[d] || [];
      buckets[d].push(to);
    }
    const domains = Object.keys(buckets);

    // create transporter
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass }
    });

    try { await transporter.verify(); } catch(e){
      return res.status(400).json({ success:false, auth:false, message: 'SMTP auth failed' });
    }

    const results = [];
    // small global concurrency: process domains in batches of 2
    const concurrency = 2;
    let idx = 0;
    async function worker(){
      while(true){
        const i = idx++;
        if (i >= domains.length) return;
        const dom = domains[i];
        for (const to of buckets[dom]){
          // try up to 3 attempts for transient errors
          let ok=false, lastErr=null;
          for (let a=1; a<=3 && !ok; a++){
            try{
              await transporter.sendMail({
                envelope: { from: fromEmail, to },
                from: `"${senderName}" <${fromEmail}>`,
                to,
                subject,
                text,
                html: text ? text.replace(/\n/g,'<br>') : undefined,
                headers: {
                  'Reply-To': fromEmail,
                  'List-Unsubscribe': `<mailto:unsubscribe@${fromEmail.split('@').pop()}>`,
                  'Message-ID': `<${Date.now()}-${Math.random().toString(36).slice(2)}@${fromEmail.split('@').pop()}>`
                }
              });
              ok = true;
              results.push({ to, ok:true });
            } catch(err){
              lastErr = err;
              const msg = String((err&&err.response)||err&&err.message||'');
              // permanent errors: don't retry
              if (/user unknown|invalid recipient|550|553|554|block|policy|spam/i.test(msg)) { break; }
              await sleep(backoff(a));
            }
          }
          if (!ok) results.push({ to, ok:false, error: lastErr ? String(lastErr.message||lastErr) : 'failed' });
          await sleep(300 + Math.floor(Math.random()*200)); // pacing per recipient
        }
      }
    }

    await Promise.all(Array.from({length: Math.min(concurrency, domains.length)}, worker));
    try{ transporter.close(); }catch(_){}

    const okCount = results.filter(r=>r.ok).length;
    const failCount = results.length - okCount;
    return res.json({ success: failCount===0, total: results.length, successCount: okCount, failCount, failures: results.filter(r=>!r.ok) });
  }catch(e){
    console.error('sendBulk err', e);
    return res.status(500).json({ success:false, message:'Server error' });
  }
});

app.listen(PORT, ()=>console.log(`Server running: http://localhost:${PORT}`));
