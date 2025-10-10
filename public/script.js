// script.js
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
  clearTimeout(popup._hid);
  popup._hid = setTimeout(() => popup.classList.add('hidden'), 3500);
}

// Logout only on double click
logoutBtn.addEventListener('dblclick', async () => {
  try {
    await fetch('/logout', { method: 'POST' });
  } catch (e) { /* ignore */ }
  window.location = '/login.html';
});
logoutBtn.addEventListener('click', () => {
  // single click hint
  showPopup('Double-click to logout', true);
});

// Parse bulk emails (newline or comma separated)
function parseEmails(text) {
  return text
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

sendAllBtn.addEventListener('click', async () => {
  if (sendAllBtn.disabled) return;

  const name = document.getElementById('name').value.trim();
  const senderEmail = document.getElementById('senderEmail').value.trim();
  const appPassword = document.getElementById('appPassword').value;
  const subject = document.getElementById('subject').value.trim();
  const template = document.getElementById('template').value;
  const bulkText = document.getElementById('bulkEmails').value.trim();

  if (!senderEmail || !appPassword || !subject) {
    showPopup('Please fill Sender Email, App Password and Subject.', false);
    return;
  }

  const recipients = parseEmails(bulkText);
  if (recipients.length === 0) {
    showPopup('Bulk Email list is empty. Paste email IDs manually.', false);
    return;
  }

  // disable send button and show "Sending"
  sendAllBtn.disabled = true;
  sendLabel.textContent = 'Sending';
  sendIcon.textContent = '⏳';

  try {
    const res = await fetch('/send', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        name, senderEmail, appPassword, subject, template, recipients
      })
    });
    const j = await res.json();
    if (j.ok) {
      showPopup('Send mail', true);
    } else {
      // show specific message if available
      showPopup(j.error || 'Wrong details or sending failed', false);
    }
  } catch (e) {
    console.error('Network/send error:', e);
    showPopup('Network/Server error', false);
  } finally {
    sendAllBtn.disabled = false;
    sendLabel.textContent = 'Send All';
    sendIcon.textContent = '📤';
  }
});
