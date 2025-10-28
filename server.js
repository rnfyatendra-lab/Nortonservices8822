// server.js (short, fixed)
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

const ADMIN_USER = process.env.ADMIN_USERNAME || 'Yatendra';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || '@#Yatendra';

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'short-secret', resave:false, saveUninitialized:false }));

// serve static files from public
app.use(express.static(path.join(__dirname,'public')));

// root -> login page
app.get('/', (req,res) => res.sendFile(path.join(__dirname,'public','login.html')));

// login
app.post('/login', (req,res) => {
  const u = (req.body.username||'').trim();
  const p = (req.body.password||'').trim();
  if(!u || !p) return res.json({success:false,message:'Missing'});
  if(u === ADMIN_USER && p === ADMIN_PASS){ req.session.user = u; return res.json({success:true}); }
  return res.json({success:false,message:'Invalid'});
});

// auth middleware
function auth(req,res,next){ if(req.session && req.session.user) return next(); return res.status(401).json({success:false,message:'Unauthorized'}); }

// launcher
app.get('/launcher', auth, (req,res) => res.sendFile(path.join(__dirname,'public','launcher.html')));

// logout
app.post('/logout', (req,res) => req.session.destroy(()=> res.json({success:true})));

// simple send (sequential)
app.post('/send', auth, async (req,res) => {
  try{
    const { email, password, senderName, recipients, subject, message } = req.body;
    if(!email || !password || !recipients) return res.json({success:false,message:'missing'});
    const list = String(recipients).split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
    if(!list.length) return res.json({success:false,message:'no recipients'});
    const transporter = nodemailer.createTransport({ host:'smtp.gmail.com', port:465, secure:true, auth:{user:email,pass:password} });
    await transporter.verify();
    const results = [];
    for(const to of list){
      try{ await transporter.sendMail({ from:`"${senderName||'Anon'}" <${email}>`, to, subject, text:message }); results.push({to,status:'ok'}); }
      catch(e){ results.push({to,status:'err',error:e.message}); }
    }
    res.json({ success: results.every(r=>r.status==='ok'), results });
  }catch(e){ res.json({success:false,message:e.message}); }
});

app.listen(PORT, ()=> console.log('Server running on', PORT));
