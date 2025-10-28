// public/script.js - improved client behaviour and per-recipient progress
function logout() {
  fetch('/logout', { method: 'POST' })
    .then(() => window.location.href = '/');
}

function el(id) { return document.getElementById(id); }

const sendBtn = el('sendBtn');
const status = el('statusMessage');

sendBtn?.addEventListener('click', async () => {
  const senderName = el('senderName').value.trim();
  const email = el('email').value.trim();
  const password = el('pass').value.trim();
  const subject = el('subject').value.trim();
  const message = el('message').value;
  const recipients = el('recipients').value.trim();

  if (!email || !password || !recipients) {
    status.innerText = '❌ Email, password and recipients required';
    alert('❌ Email, password and recipients required');
    return;
  }

  sendBtn.disabled = true;
  sendBtn.innerText = '⏳ Sending...';
  status.innerText = 'Connecting to SMTP...';

  try {
    const payload = { senderName, email, password, subject, message, recipients };
    const res = await fetch('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.success) {
      // Show summary + details if any
      status.innerText = `✅ ${data.message}`;
      if (data.details) {
        const d = data.details;
        let detailsText = `Total: ${d.total} • Sent: ${d.successCount} • Failed: ${d.failures.length}`;
        if (d.failures.length > 0) {
          detailsText += '\n\nFailures:\n' + d.failures.map(f => `${f.to}: ${f.error}`).join('\n');
          // show in alert so user notices
          alert('Some sends failed — check details below.');
        } else {
          alert('✅ All messages were sent (or accepted by SMTP).');
        }
        status.innerText = detailsText;
      } else {
        alert('✅ Mail sent successfully!');
      }
    } else {
      status.innerText = '❌ ' + (data.message || 'Send failed');
      alert('❌ Failed: ' + (data.message || 'Send failed'));
    }
  } catch (err) {
    status.innerText = '❌ Error: ' + err.message;
    alert('❌ Error: ' + err.message);
  } finally {
    sendBtn.disabled = false;
    sendBtn.innerText = 'Send All';
  }
});
