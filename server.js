// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Yatendra';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '@#Yatendra';

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'short-secret', resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req,res,next){
  if(req.session && req.session.user) return next();
  return res.status(401).redirect('/');
}

app.post('/login',(req,res)=>{
  const u = String(req.body.username||'').trim();
  const p = String(req.body.password||'').trim();
  if(!u||!p) return res.json({success:false,message:'Missing'});
  if(u===ADMIN_USERNAME && p===ADMIN_PASSWORD){
    req.session.user=u; return res.json({success:true});
  }
  return res.json({success:false,message:'Invalid'});
});

app.get('/launcher', requireAuth, (req,res)=> res.sendFile(path.join(__dirname,'public','launcher.html')));

app.post('/logout',(req,res)=> {
  req.session.destroy(()=> { res.clearCookie('connect.sid'); res.json({success:true}); });
});

// simple send (keeps small)
app.post('/send', requireAuth, async (req,res)=>{
  try{
    const { email, password, senderName, recipients, subject, message } = req.body;
    if(!email||!password||!recipients) return res.json({success:false,message:'missing'});
    const list = String(recipients).split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean);
    if(!list.length) return res.json({success:false,message:'no recipients'});
    const transporter = nodemailer.createTransport({ host:'smtp.gmail.com', port:465, secure:true, auth:{user:email,pass:password} });
    await transporter.verify();
    // send sequentially (simple & safe)
    const results = [];
    for(const to of list){
      try{
        await transporter.sendMail({ from:`"${senderName||'Anon'}" <${email}>`, to, subject:subject||'', text:message||'' });
        results.push({to,status:'ok'});
      }catch(e){ results.push({to,status:'err',error:e.message}); }
    }
    return res.json({ success: results.every(r=>r.status==='ok'), results, message:`sent ${results.filter(r=>r.status==='ok').length}` });
  }catch(err){
    return res.json({success:false,message:err.message||'err'});
  }
});

app.listen(PORT, ()=> console.log('Server',PORT));
