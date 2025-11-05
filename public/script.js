// --- Cross-tab logout broadcast using localStorage ---
function broadcastLogout() {
  try {
    localStorage.setItem('fastmailer:logout', String(Date.now()));
  } catch (_) {}
}

// Listen for logout event from other tabs
window.addEventListener('storage', (e) => {
  if (e.key === 'fastmailer:logout') {
    // Redirect this tab to login if any other tab logged out
    window.location.replace('/');
  }
});

// 1-click logout
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  fetch('/logout', { method: 'POST' })
    .then(() => {
      broadcastLogout();
      window.location.replace('/');
    })
    .catch(() => {
      // Even if request fails due to network hiccup, force redirect
      broadcastLogout();
      window.location.replace('/');
    });
});

// Send mails
document.getElementById('sendBtn')?.addEventListener('click', () => {
  const senderName = document.getElementById('senderName').value;
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('pass').value.trim();
  const subject = document.getElementById('subject').value;
  const message = document.getElementById('message').value;
  const recipients = document.getElementById('recipients').value.trim();
  const status = document.getElementById('statusMessage');

  if (!email || !password || !recipients) {
    alert('❌ Email, password and recipients required');
    return;
  }

  const btn = document.getElementById('sendBtn');
  btn.disabled = true;
  btn.innerText = '⏳ Sending...';

  fetch('/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderName, email, password, subject, message, recipients })
  })
    .then(r => r.json())
    .then(data => {
      status.innerText = data.message;
      alert(data.success ? '✅ Mail sent!' : '❌ ' + data.message);
    })
    .catch(err => {
      status.innerText = '❌ ' + err.message;
      alert('❌ ' + err.message);
    })
    .finally(() => {
      btn.disabled = false;
      btn.innerText = 'Send All';
    });
});
