// public/script.js (client behavior per requirements)
const $ = id => document.getElementById(id);

$('logoutBtn')?.addEventListener('click', () => fetch('/logout', { method: 'POST' }).then(() => location.href = '/'));

$('sendBtn')?.addEventListener('click', async () => {
  const senderName = $('senderName').value || '';
  const smtpUser = ($('email').value || '').trim();
  const smtpPass = ($('pass').value || '').trim();
  const subject = $('subject').value || '';
  const text = $('message').value || '';
  const recipients = ($('recipients').value || '').trim();

  if (!smtpUser || !smtpPass || !recipients) { alert('Enter email, app password and recipients'); return; }

  const payload = {
    senderName,
    smtpUser,
    smtpPass,
    fromEmail: smtpUser,
    subject,
    text,
    recipients,
    concurrency: 30,
    retries: 3
  };

  const btn = $('sendBtn');
  const origText = btn.innerText;
  btn.disabled = true;
  btn.innerText = 'Sending...';

  try {
    const res = await fetch('/sendBulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await res.json();
    if (j && j.success) alert('✅ Mail sent');
    else {
      const fail = (j && typeof j.failCount === 'number') ? j.failCount : (j && j.failures ? j.failures.length : (j && j.total ? j.total - (j.successCount||0) : 'unknown'));
      alert(`✘ Some mails failed (${fail})`);
    }
  } catch (e) {
    console.error(e);
    alert('✘ Some mails failed (network/server error)');
  } finally {
    btn.disabled = false;
    btn.innerText = origText || 'Send All';
  }
});
