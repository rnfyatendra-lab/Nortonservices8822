const $ = id => document.getElementById(id);

$('logoutBtn')?.addEventListener('click', ()=> {
  fetch('/logout',{method:'POST'}).then(()=>location.href='/');
});

async function postJSON(url, body){
  const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return r.json();
}

$('sendBtn')?.addEventListener('click', async ()=>{
  const senderName = $('senderName').value || '';
  const email = ($('email').value||'').trim();
  const password = ($('pass').value||'').trim();
  const subject = $('subject').value || '';
  const message = $('message').value || '';
  const raw = ($('recipients').value||'').trim();

  if(!email || !password || !raw){ alert('Enter email, password, recipients'); return; }

  const list = raw.split(/[\n,;]+/).map(s=>s.trim()).filter(Boolean);
  if(!list.length){ alert('No recipients'); return; }

  const CONCURRENCY = 15; // तेज़; जरूरत हो तो 5-10 कर लें
  let i = 0;

  async function worker(){
    while(true){
      if(i>=list.length) return;
      const to = list[i++];

      try{
        const res = await postJSON('/sendOne',{ email,password,senderName,to,subject,message });
        if(res.success) alert(`✅ Mail sent to ${res.to}`);
        else alert(`✘ Failed to ${res.to||to}\n${res.message||''}`);
      }catch(e){
        alert(`✘ Failed to ${to}\n${e.message||e}`);
      }
    }
  }

  const jobs = Array.from({length: Math.min(CONCURRENCY, list.length)}, worker);
  await Promise.all(jobs);
  alert('All done');
});
