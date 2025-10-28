// public/script.js
const $ = id => document.getElementById(id);
$('logoutBtn')?.addEventListener('click', ()=> fetch('/logout',{method:'POST'}).then(()=>location.href='/'));

async function postJSON(url, body){
  const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  return r.json().catch(()=>({ success:false, message:'Invalid JSON' }));
}

$('sendBtn')?.addEventListener('click', async () => {
  const senderName = $('senderName').value || '';
  const email = ($('email').value || '').trim();
  const password = ($('pass').value || '').trim();
  const subject = $('subject').value || '';
  const message = $('message').value || '';
  const raw = ($('recipients').value || '').trim();
  if (!email || !password || !raw) { alert('Enter email, password and recipients'); return; }

  const list = raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  if (!list.length) { alert('No recipients'); return; }

  // hide any status element
  const statusEl = $('statusMessage'); if(statusEl) statusEl.style.display = 'none';

  const CONCURRENCY = 30;
  let idx = 0, successCount = 0, failCount = 0;

  // disable button and show Sending...
  const sendBtn = $('sendBtn');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.innerText = 'Sending...'; }

  async function worker(){
    while(true){
      const i = idx++;
      if (i >= list.length) return;
      const to = list[i];
      try{
        const res = await postJSON('/sendOne', { email, password, senderName, to, subject, message });
        if (res && res.success) successCount++;
        else failCount++;
      }catch(e){
        failCount++;
      }
    }
  }

  const workers = Array.from({length: Math.min(CONCURRENCY, list.length)}, () => worker());
  await Promise.all(workers);

  // restore button
  if (sendBtn) { sendBtn.disabled = false; sendBtn.innerText = 'Send All'; }

  // single popup result
  if (failCount === 0) alert('✅ Mail sent');
  else alert(`✘ Some mails failed (${failCount})`);
});
