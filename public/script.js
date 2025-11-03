const $=id=>document.getElementById(id);
$('logoutBtn')?.addEventListener('click',()=>fetch('/logout',{method:'POST'}).then(()=>location.href='/'));
$('sendBtn')?.addEventListener('click',async()=>{
  const payload={
    senderName: $('senderName').value.trim(),
    smtpUser: ($('email').value||'').trim(),
    smtpPass: ($('pass').value||'').trim(),
    fromEmail: ($('email').value||'').trim(),
    subject: $('subject').value.trim(),
    text: $('message').value,
    recipients: $('recipients').value.trim()
  };
  if(!payload.smtpUser||!payload.smtpPass||!payload.recipients){ alert('Enter email, app password & recipients'); return; }
  const btn=$('sendBtn'), orig=btn.innerText; btn.disabled=true; btn.innerText='Sending...';
  try{
    const r=await fetch('/sendBulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json();
    if(j.auth===false) alert('✘ App password incorrect');
    else if(j.success) alert('✅ Mail sent');
    else alert(`✘ Some mails failed (${j.failCount||'?'})`);
  }catch(e){ alert('✘ Network/Server error'); }
  finally{ btn.disabled=false; btn.innerText=orig; }
});
