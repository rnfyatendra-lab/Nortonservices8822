// public/script.js - client for /sendBulk
const $ = id => document.getElementById(id);

$('logoutBtn')?.addEventListener('click', ()=> fetch('/logout', { method:'POST' }).then(()=> location.href = '/'));

$('sendBtn')?.addEventListener('click', async () => {
  const senderName = $('senderName')?.value || '';
  const smtpUser = ($('email')?.value || '').trim();
  const smtpPass = ($('pass')?.value || '').trim();
  const subject = $('subject')?.value || '';
  const text = $('message')?.value || '';
  const recipients = ($('recipients')?.value || '').trim();

  if(!smtpUser || !smtpPass || !recipients) { alert('Enter email, app password and recipients'); return; }

  const payload = {
    senderName,
    smtpUser,
    smtpPass,
    fromEmail: smtpUser,
    subject,
    text,
    recipients,
    concurrency: 10,
    retries: 5
  };

  const btn = $('sendBtn');
  const orig = btn.innerText;
  btn.disabled = true;
  btn.innerText = 'Sending...';

  try {
    const res = await fetch('/sendBulk', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
    const j = await res.json();

    // if auth false -> app password likely wrong
    if (j && j.auth === false) {
      alert('✘ App password incorrect or SMTP auth failed');
      return;
    }

    if (j && j.success) {
      alert('✅ Mail sent');
    } else {
      const fail = (j && typeof j.failCount === 'number') ? j.failCount : (j && j.failures ? j.failures.length : 'unknown');
      alert(`✘ Some mails failed (${fail})`);
    }
  } catch (err) {
    console.error('sendBulk client err', err);
    alert('✘ Some mails failed (network/server error)');
  } finally {
    btn.disabled = false;
    btn.innerText = orig || 'Send All';
  }
});
