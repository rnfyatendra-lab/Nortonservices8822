// Small, inbox-safer sender (Gmail SMTP + App Password). Plain-text only.
'use strict';
const express=require('express'), session=require('express-session');
const body=require('body-parser'), path=require('path'), nodemailer=require('nodemailer');

const app=express(), PORT=process.env.PORT||8080;
const APP_USER='nortonservices8822', APP_PASS='services8822'; // login

app.use(body.json()); app.use(body.urlencoded({extended:true}));
app.use(session({secret:'safe-mailer',resave:false,saveUninitialized:false}));
app.use(express.static(path.join(__dirname,'public')));

const okEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const backoff=a=>400*Math.pow(2,a-1)+Math.floor(Math.random()*200);
const needAuth=(req,res,n)=>req.session?.u?n():((req.headers.accept||'').includes('application/json')?res.status(401).json({success:false}):res.redirect('/'));

app.get('/',(_,res)=>res.sendFile(path.join(__dirname,'public','login.html')));
app.post('/login',(req,res)=>{const {username,password}=req.body||{};
  if(username===APP_USER&&password===APP_PASS){req.session.u=username;return res.json({success:true});}
  res.status(401).json({success:false,message:'Invalid credentials'});});
app.get('/launcher',needAuth,(_,res)=>res.sendFile(path.join(__dirname,'public','launcher.html')));
app.post('/logout',needAuth,(req,res)=>req.session.destroy(()=>res.json({success:true})));

/* /sendBulk — ultra conservative:
   - concurrency = 1 (serial)
   - gap between emails default 45s (override with gapMs in request)
   - retries on transient errors (3)
   - no HTML, no unsubscribe header (first touch outreach)
*/
app.post('/sendBulk', needAuth, async (req,res)=>{
  try{
    const b=req.body||{}, smtpUser=String(b.smtpUser||'').trim(), smtpPass=String(b.smtpPass||'').trim();
    const fromEmail=String(b.fromEmail||smtpUser||'').trim(), name=(String(b.senderName||'Sender').replace(/"/g,'')).trim();
    const subject=String(b.subject||'Quick question'), text=String(b.text||'').trim();
    const gapMs=Math.max(10000, Math.min(180000, Number(b.gapMs)||45000)); // 10s..180s
    if(!smtpUser||!smtpPass) return res.status(400).json({success:false,auth:false,message:'SMTP required'});
    let list=String(b.recipients||'').split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean);
    list=[...new Set(list)].filter(okEmail);
    if(!fromEmail||!list.length) return res.status(400).json({success:false,message:'From/Recipients required'});

    const tx=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:smtpUser,pass:smtpPass}});
    try{await tx.verify();}catch{ return res.status(400).json({success:false,auth:false,message:'SMTP auth failed'}); }

    const results=[];
    const sendOne=async(to)=>{
      for(let a=1;a<=3;a++){
        try{
          await tx.sendMail({
            envelope:{from:fromEmail,to},
            from:`"${name}" <${fromEmail}>`,
            to, subject,
            text, // plain only
            headers:{
              'Reply-To': fromEmail,
              'Message-ID': `<${Date.now()}-${Math.random().toString(36).slice(2)}@${fromEmail.split('@').pop()}>`
            }
          });
          return {to,ok:true};
        }catch(err){
          const code=err?.responseCode||0, msg=String(err?.response||err?.message||'');
          if([550,551,553,554].includes(code) || /user unknown|invalid|policy|blocked|spam/i.test(msg)) return {to,ok:false,error:msg};
          await sleep(backoff(a));
        }
      } return {to,ok:false,error:'retry_failed'};
    };

    for(const to of list){ const r=await sendOne(to); results.push(r); await sleep(gapMs); }
    try{tx.close();}catch{}
    const ok=results.filter(r=>r.ok).length, bad=results.length-ok;
    res.json({success:bad===0,total:results.length,successCount:ok,failCount:bad,failures:results.filter(r=>!r.ok).slice(0,100)});
  }catch(e){ console.error('sendBulk',e); res.status(500).json({success:false,message:'Server error'}); }
});

app.listen(PORT,()=>console.log(`Server running on http://0.0.0.0:${PORT}`));
