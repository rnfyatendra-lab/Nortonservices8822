const popup = document.getElementById('popup');
const sendAllBtn = document.getElementById('sendAllBtn');
const sendLabel = document.getElementById('sendLabel');
const sendIcon = document.getElementById('sendIcon');
const logoutBtn = document.getElementById('logoutBtn');

function showPopup(text, ok = true) {
  popup.classList.remove('hidden');
  popup.textContent = (ok ? '✅ ' : '❌ ') + text;
  popup.classList.toggle('success', ok);
  popup.classList.toggle('error', !ok);
  clearTimeout(popup._t);
  popup._t = setTimeout(() => popup.classList.add('hidden'), 3000);
}

logoutBtn.addEventListener('click', () => showPopup('Double-click to logout', true));
logoutBtn.addEventListener('dblclick', async () => {
  await fetch('/logout', { method: 'POST' });
  window.location = '/';
});

sendAllBtn.addEventListener('click', async () => {
  if (sendAllBtn.disabled) return;

  const name = document.getElementById('name').value.trim();
  const senderEmail = document.getElementById('senderEmail').value.trim();
  const appPassword = document.getElementById('appPassword').value;
  const subject = document.getElementById('subject').value.trim();
  const template = document.getElementById('template').value;
  const bulkText = document.getElementById('bulkEmails').value.trim();

  if (!senderEmail || !appPassword || !subject) {
    showPopup('Please fill all required fields', false);
    return;
  }

  const recipients = bulkText.split(/[\n,]+/).map(e => e.trim()).filter(Boolean);
  if (recipients.length === 0) {
    showPopup('No bulk emails entered', false);
    return;
  }

  sendAllBtn.disabled = true;
  sendLabel.textContent = 'Sending';
  sendIcon.textContent = '⏳';

  try {
    const res = await fetch('/send', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, senderEmail, appPassword, subject, template, recipients })
    });
    const j = await res.json();
    if (j.ok) showPopup('Send mail', true);
    else showPopup(j.error || 'Wrong', false);
  } catch (e) {
    console.error(e);
    showPopup('Network error', false);
  } finally {
    sendAllBtn.disabled = false;
    sendLabel.textContent = 'Send All';
    sendIcon.textContent = '📤';
  }
});
