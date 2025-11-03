// FAST-MODE Bulk Mailer (25 parallel, ~0.2s batch)
'use strict';
const express=require('express'),session=require('express-session');
const body=require('body-parser'),path=require('path'),nodemailer=require('nodemailer');

const app=express(),PORT=process.env.PORT||8080;
const APP_USER='nortonservices8822',APP_PASS='services8822';

app.use(body.json());app.use(body.urlencoded({extended:true}));
app.use(session({secret:'fast-mailer',resave:false,saveUninitialized:false}));
app.use(express.static(path.join(__dirname,'public')));

const okEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function needAuth(req,res,next){if(req.session?.u)return next();res.redirect('/');}
app.get('/',(_,res)=>res.sendFile(path.join(__dirname,'public','login.html')));
app.post('/login',(req,res)=>{
  const {username,password}=req.body||{};
  if(username===APP_USER&&password===APP_PASS){req.session.u=username;return res.json({success:true});}
  res.status(401).json({success:false,message:'Invalid credentials'});
});
app.get('/launcher',needAuth,(_,res)=>res.sendFile(path.join(__dirname,'public','launcher.html')));
app.post('/logout',needAuth,(req,res)=>req.session.destroy(()=>res.json({success:true})));

// --- FAST Bulk Sender ---
app.post('/sendBulk',needAuth,async(req,res)=>{
  try{
    const b=req.body||{};
    const smtpUser=String(b.smtpUser||'').trim(),smtpPass=String(b.smtpPass||'').trim();
    const fromEmail=String(b.fromEmail||smtpUser||'').trim();
    const senderName=(String(b.senderName||'Sender').replace(/"/g,'')).trim();
    const subject=String(b.subject||'(no subject)'),text=String(b.text||'');
    if(!smtpUser||!smtpPass)return res.json({success:false,message:'SMTP required'});
    const list=[...new Set(String(b.recipients||'').split(/[\n,;]+/).map(s=>s.trim()).filter(okEmail))];
    if(!list.length)return res.json({success:false,message:'No valid recipients'});

    const tx=nodemailer.createTransport({
      host:'smtp.gmail.com',port:465,secure:true,
      auth:{user:smtpUser,pass:smtpPass}
    });
    try{await tx.verify();}catch(e){return res.json({success:false,auth:false,message:'SMTP auth failed'});}

    const results=[];const batchSize=25; // parallel 25 mails
    for(let i=0;i<list.length;i+=batchSize){
      const batch=list.slice(i,i+batchSize);
      const promises=batch.map(to=>tx.sendMail({
        from:`"${senderName}" <${fromEmail}>`,
        to,subject,text,html:text.replace(/\n/g,'<br>')
      }).then(()=>({to,ok:true})).catch(e=>({to,ok:false,error:e.message})));
      const settled=await Promise.allSettled(promises);
      settled.forEach(x=>results.push(x.value||{ok:false}));
      await sleep(200); // 0.2 sec delay between batches
    }
    const ok=results.filter(r=>r.ok).length,bad=results.length-ok;
    res.json({success:bad===0,total:results.length,successCount:ok,failCount:bad});
  }catch(e){console.error(e);res.status(500).json({success:false,message:'Server error'});}
});

app.listen(PORT,()=>console.log('Fast server on http://localhost:'+PORT));
