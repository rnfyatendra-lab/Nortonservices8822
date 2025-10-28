// public/script.js
const $ = id => document.getElementById(id);
$('logoutBtn')?.addEventListener('click', ()=> fetch('/logout',{method:'POST'}).then(()=>location.href='/'));
$('sendBtn')?.addEventListener('click', async ()=>{
  const senderName = $('senderName').value;
  const email = $('email').value.trim();
  const password = $('pass').value.trim();
  const subject = $('subject').value;
  const message = $('message').value;
  const recipients = $('recipients').value.trim();
  const st = $('statusMessage');
  if(!email||!password||!recipients){ st.innerText='Email, pass, recipients required'; return; }
  $('sendBtn').disabled = true; $('sendBtn').innerText='Sending...'; st.innerText='Connecting...';
  try{
    const r = await fetch('/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ senderName,email,password,subject,message,recipients })});
    const j = await r.json();
    st.innerText = JSON.stringify(j, null, 2);
    if(j.success) alert('Done');
    else alert('Failed: '+(j.message||''));
  }catch(e){ st.innerText = 'Error: '+e.message; console.error(e); }
  $('sendBtn').disabled = false; $('sendBtn').innerText='Send All';
});
