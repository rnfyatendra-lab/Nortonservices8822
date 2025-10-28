// server.js (updated - adds /sendOne)
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
app.use(express.static(path.join(__dirname,'public')));

function auth(req,res,next){ if(req.session && req.session.user) return next(); return res.status(401).json({success:false}); }
app.post('/login',(req,res)=>{
  const u=(req.body.username||'').trim(), p=(req.body.password||'').trim();
  if(u===ADMIN_USER && p===ADMIN_PASS){ req.session.user=u; return res.json({success:true}); }
  return res.json({success:false,message:'Invalid'}); 
});
app.get('/launcher', auth, (req,res)=> res.sendFile(path.join(__dirname,'public','launcher.html')));
app.post('/logout',(req,res)=> req.session.destroy(()=>res.json({success:true})));

// New: send one mail (called concurrently by client)
app.post('/sendOne', auth, async (req,res)=>{
  try{
    const { email, password, senderName, to, subject, message } = req.body;
    if(!email||!password||!to) return res.json({success:false,message:'missing'});
    const transporter = nodemailer.createTransport({ host:'smtp.gmail.com', port:465, secure:true, auth:{ user: email, pass: password }});
    // send single
    await transporter.sendMail({ from:`"${senderName||'Anon'}" <${email}>`, to, subject: subject||'', text: message||'' });
    return res.json({ success:true, to });
  }catch(err){
    return res.json({ success:false, to: req.body && req.body.to, message: err && err.message ? err.message : String(err) });
  }
});

app.listen(PORT, ()=> console.log('Server running', PORT));
