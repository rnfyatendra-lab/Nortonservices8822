const $ = id => document.getElementById(id);

$('logoutBtn')?.addEventListener('click', ()=> fetch('/logout',{ method:'POST' }).then(()=> location.href = '/'));

// sendBulk client
$('sendBtn')?.addEventListener('click', async () => {
  const senderName = $('senderName')?.value || '';
  const smtpUser = ($('email')?.value || '').trim();
  const smtpPass = ($('pass')?.value || '').trim();
  const subject = ($('subject')?.value || '').trim();
  const text = ($('message')?.value || '').trim();
  const recipients = ($('recipients')?.value || '').trim();

  if (!smtpUser || !smtpPass || !recipients) { alert('Enter email, app password and recipients'); return; }

  const payload = {
    senderName,
    smtpUser,
    smtpPass,
    fromEmail: smtpUser,
    subject,
    text,
    recipients,
    concurrency: 10,
    retries: 3
  };

  const btn = $('sendBtn');
  const orig = btn.innerText;
  btn.disabled = true;
  btn.innerText = 'Sending...';

  try {
    const res = await fetch('/sendBulk', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
    const j = await res.json();

    if (j && j.auth === false) {
      alert('✘ App password incorrect (SMTP auth failed)');
    } else if (j && j.success) {
      alert('✅ Mail sent');
    } else {
      const fail = (j && typeof j.failCount === 'number') ? j.failCount : (j && j.failures ? j.failures.length : 'unknown');
      alert(`✘ Some mails failed (${fail})`);
      console.log('Details:', j);
    }
  } catch (e) {
    console.error('sendBulk error', e);
    alert('✘ Some mails failed (network/server error)');
  } finally {
    btn.disabled = false;
    btn.innerText = orig || 'Send All';
  }
});
