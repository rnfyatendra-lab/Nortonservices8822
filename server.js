// small, spam-safer bulk sender (Gmail SMTP + App Password)
'use strict';
const express = require('express'), session = require('express-session');
const body = require('body-parser'), path = require('path'), nodemailer = require('nodemailer');

const app = express(), PORT = process.env.PORT||8080;
const USER='nortonservices8822', PASS='services8822'; // login

app.use(body.json()); app.use(body.urlencoded({extended:true}));
app.use(session({secret:'fast-mailer',resave:false,saveUninitialized:false}));
app.use(express.static(path.join(__dirname,'public')));

const okEmail = e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim());
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const backoff = a=>200*Math.pow(2,a-1)+Math.floor(Math.random()*150);

const needAuth=(req,res,next)=> req.session?.u ? next()
  : (req.headers.accept||'').includes('application/json') ? res.status(401).json({success:false})
  : res.redirect('/');

app.get('/',(_,res)=>res.sendFile(path.join(__dirname,'public','login.html')));
app.post('/login',(req,res)=>{
  const {username,password}=req.body||{};
  if(username===USER && password===PASS){ req.session.u=username; return res.json({success:true}); }
  res.status(401).json({success:false,message:'Invalid credentials'});
});
app.get('/launcher',needAuth,(_,res)=>res.sendFile(path.join(__dirname,'public','launcher.html')));
app.post('/logout',needAuth,(req,res)=>req.session.destroy(()=>res.json({success:true})));

// Bulk sender: low concurrency (3), light retry (3), tiny pauses, good headers
app.post('/sendBulk', needAuth, async (req,res)=>{
  try{
    const b=req.body||{}, from=String(b.fromEmail||b.smtpUser||'').trim();
    const smtpUser=String(b.smtpUser||'').trim(), smtpPass=String(b.smtpPass||'').trim();
    const subject=String(b.subject||'(no subject)'), text=String(b.text||''), name=String(b.senderName||'Anonymous');
    if(!smtpUser||!smtpPass) return res.status(400).json({success:false,auth:false,message:'SMTP credentials required'});
    const list=String(b.recipients||'').split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean)
      .filter((v,i,a)=>a.indexOf(v)===i).filter(okEmail);
    if(!from||!list.length) return res.status(400).json({success:false,message:'From/Recipients required'});

    const tx=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:smtpUser,pass:smtpPass}});
    try{ await tx.verify(); }catch(e){ return res.status(400).json({success:false,auth:false,message:'SMTP auth failed'}); }

    let i=0, results=[];
    const C=Math.min(3, list.length), R=3; // small & safe
    const sendOne=async(to)=>{
      for(let a=1;a<=R;a++){
        try{
          await tx.sendMail({
            from:`"${name.replace(/"/g,'')}" <${from}>`,
            to, subject,
            text,
            html:text?text.replace(/\n/g,'<br>'):undefined,
            headers:{
              'Reply-To': from,
              'List-Unsubscribe': `<mailto:unsubscribe@${from.split('@').pop()}>`,
              'Message-ID': `<${Date.now()}-${Math.random().toString(36).slice(2)}@${from.split('@').pop()}>`
            }
          });
          return {to,ok:true};
        }catch(err){
          const rc = err && (err.responseCode||0);
          const msg = String((err&&err.response)||err&&err.message||'');
          if([550,551,553,554].includes(rc) || /user unknown|invalid|policy|blocked|spam/i.test(msg)) return {to,ok:false,error:msg};
          await sleep(backoff(a));
        }
      }
      return {to,ok:false,error:'retry_failed'};
    };

    const worker=async()=>{ while(true){ const k=i++; if(k>=list.length) return;
      const r=await sendOne(list[k]); results.push(r); await sleep(250+Math.floor(Math.random()*150)); } };

    await Promise.all(Array.from({length:C},worker)); try{tx.close();}catch(_){}
    const ok=results.filter(r=>r.ok).length, bad=results.length-ok;
    res.json({success:bad===0,total:results.length,successCount:ok,failCount:bad,failures:results.filter(r=>!r.ok).slice(0,100)});
  }catch(e){ console.error('sendBulk error',e); res.status(500).json({success:false,message:'Server error'}); }
});

app.listen(PORT, ()=>console.log('Server http://localhost:'+PORT));
