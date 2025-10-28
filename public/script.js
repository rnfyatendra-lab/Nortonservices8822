// public/script.js - concurrent sends with per-recipient popup
const $ = id => document.getElementById(id);
$('logoutBtn')?.addEventListener('click', ()=> fetch('/logout',{method:'POST'}).then(()=>location.href='/'));

async function postJSON(url, body){
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  return res.json().catch(()=>({ success:false, message:'Invalid JSON response' }));
}

$('sendBtn')?.addEventListener('click', async ()=>{
  const senderName = $('senderName').value || '';
  const email = ($('email').value||'').trim();
  const password = ($('pass').value||'').trim();
  const subject = $('subject').value || '';
  const message = $('message').value || '';
  const recipientsRaw = ($('recipients').value||'').trim();
  const statusEl = $('statusMessage');
  statusEl.innerText = ''; // keep nothing below as requested

  if(!email || !password || !recipientsRaw){ alert('Enter email, password and recipients'); return; }

  // parse recipients
  const list = recipientsRaw.split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean);
  if(!list.length){ alert('No recipients'); return; }

  // concurrency - adjust if Gmail throttles you
  const CONCURRENCY = 20;
  let idx = 0;

  // worker to process next recipient
  async function worker(){
    while(true){
      let i;
      // atomic fetch
      if(idx >= list.length) return;
      i = idx++;
      const to = list[i];
      try{
        const res = await postJSON('/sendOne', { email, password, senderName, to, subject, message });
        if(res && res.success){
          alert(`✅ Mail sent to ${res.to}`);
        } else {
          const id = (res && res.to) || to;
          const msg = (res && res.message) || 'Failed';
          alert(`✘ Failed to ${id}\n${msg}`);
        }
      }catch(e){
        alert(`✘ Failed to ${to}\n${e && e.message ? e.message : e}`);
      }
    }
  }

  // start workers
  const workers = [];
  for(let w=0; w<Math.min(CONCURRENCY, list.length); w++) workers.push(worker());
  // wait all finish
  await Promise.all(workers);

  // final small alert
  alert('All sends attempted');
});
