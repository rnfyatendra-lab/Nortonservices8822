const $=id=>document.getElementById(id);
$('logoutBtn')?.addEventListener('click',()=>fetch('/logout',{method:'POST'}).then(()=>location.href='/'));

$('sendBtn')?.addEventListener('click', async ()=>{
  const payload={
    senderName: $('senderName').value.trim()||'Sender',
    smtpUser: ($('email').value||'').trim(),
    smtpPass: ($('pass').value||'').trim(),
    fromEmail: ($('email').value||'').trim(),
    subject: $('subject').value.trim()||'Quick question',
    text: $('message').value,
    recipients: $('recipients').value.trim(),
    gapMs: 45000   // ~45s between emails (safer). Change if needed.
  };
  if(!payload.smtpUser||!payload.smtpPass||!payload.recipients){ alert('Enter email, app password & recipients'); return; }
  const btn=$('sendBtn'), t=btn.innerText; btn.disabled=true; btn.innerText='Sending... (safe)';
  try{
    const r=await fetch('/sendBulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json();
    if(j.auth===false) alert('✘ App password incorrect');
    else if(j.success) alert('✅ Mail sent');
    else alert(`✘ Some mails failed (${j.failCount||'?'})`);
  }catch{ alert('✘ Network/Server error'); }
  finally{ btn.disabled=false; btn.innerText=t; }
});
