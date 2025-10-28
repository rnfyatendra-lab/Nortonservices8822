// public/script.js (updated)
// behaviour:
// - no visible "sending" status while sending (statusMessage kept hidden)
// - per-recipient popup after each send: ✅ email  or  ✘ email
// - concurrent workers for speed; adjust CONCURRENCY if Gmail rate-limits you

const $ = id => document.getElementById(id);
$('logoutBtn')?.addEventListener('click', ()=> fetch('/logout',{method:'POST'}).then(()=>location.href='/'));

async function postJSON(url, body){
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  return res.json().catch(()=>({ success:false, message:'Invalid JSON' }));
}

$('sendBtn')?.addEventListener('click', async () => {
  const senderName = $('senderName').value || '';
  const email = ($('email').value || '').trim();
  const password = ($('pass').value || '').trim();
  const subject = $('subject').value || '';
  const message = $('message').value || '';
  const raw = ($('recipients').value || '').trim();

  // keep status hidden per request
  const statusEl = $('statusMessage');
  if(statusEl) statusEl.style.display = 'none';

  if (!email || !password || !raw) { alert('Enter email, password and recipients'); return; }

  const list = raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  if (!list.length) { alert('No recipients'); return; }

  // concurrency: lower this if Gmail rate-limits
  const CONCURRENCY = 15;
  let idx = 0;
  let successCount = 0;
  let failCount = 0;

  async function worker(){
    while (true) {
      const i = idx++;
      if (i >= list.length) return;
      const to = list[i];
      try {
        const res = await postJSON('/sendOne', { email, password, senderName, to, subject, message });
        if (res && res.success) {
          successCount++;
          alert(`✅ Mail sent to ${res.to || to}`);
        } else {
          failCount++;
          alert(`✘ Failed to ${res.to || to}\n${(res && res.message) || 'Error'}`);
        }
      } catch (e) {
        failCount++;
        alert(`✘ Failed to ${to}\n${e && e.message ? e.message : e}`);
      }
    }
  }

  // disable send button while sending (but do NOT show any "sending" text)
  const sendBtn = $('sendBtn');
  if (sendBtn) sendBtn.disabled = true;

  const workers = [];
  const n = Math.min(CONCURRENCY, list.length);
  for (let w = 0; w < n; w++) workers.push(worker());
  await Promise.all(workers);

  if (sendBtn) sendBtn.disabled = false;

  // final summary popup
  alert(`All done — Sent: ${successCount}, Failed: ${failCount}`);
});
