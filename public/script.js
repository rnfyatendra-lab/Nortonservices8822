// public/script.js - client for /sendBulk
const $ = id => document.getElementById(id);

$('logoutBtn')?.addEventListener('click', ()=>fetch('/logout',{method:'POST'}).then(()=>location.href='/'));

$('sendBtn')?.addEventListener('click', async ()=>{
  const senderName = $('senderName')?.value || '';
  const fromEmail = ($('email')?.value || '').trim();
  const password = ($('pass')?.value || '').trim(); // optional if using server-side SMTP env or SendGrid
  const subject = $('subject')?.value || '';
  const text = $('message')?.value || '';
  const recipients = ($('recipients')?.value || '').trim();

  if(!fromEmail || !recipients) { alert('Enter From email and recipients'); return; }

  // You can pass concurrency and retries if you want; else server defaults
  const payload = {
    senderName,
    fromEmail,
    // NOTE: prefer server-side SendGrid; but if you want SMTP user/pass to be used by server,
    // you may send them here — however it's recommended to set SMTP credentials as environment variables on server.
    // We'll send password only if present (optional).
    ...(password ? { smtpPasswordClientProvided: password } : {}),
    subject,
    text,
    recipients,
    // optional tuning
    concurrency: 30,
    retries: 3,
    listUnsubscribe: '' // optional URL or mailto: for unsubscribe
  };

  // disable button and show Sending...
  const btn = $('sendBtn');
  btn.disabled = true;
  const origText = btn.innerText;
  btn.innerText = 'Sending...';

  try {
    const res = await fetch('/sendBulk', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const j = await res.json();

    // single popup according to your rule
    if (j && j.success) {
      alert('✅ Mail sent');
    } else {
      const failCount = (j && j.failCount) ? j.failCount : (j && j.failures ? j.failures.length : 'unknown');
      alert(`✘ Some mails failed (${failCount})`);
    }
  } catch (err) {
    console.error('sendBulk error', err);
    alert('✘ Some mails failed (network/server error)');
  } finally {
    btn.disabled = false;
    btn.innerText = origText || 'Send All';
  }
});
