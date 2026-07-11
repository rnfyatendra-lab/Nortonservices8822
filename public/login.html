<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fast Mailer — Login</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);display:flex;align-items:center;justify-content:center;font-family:'Inter',sans-serif;padding:20px}
.card{background:#ffffff;border-radius:20px;padding:44px 40px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,0.2)}
.logo{text-align:center;margin-bottom:32px}
.logo-icon{font-size:48px;display:block;margin-bottom:10px}
.logo-title{font-size:26px;font-weight:700;color:#1a1a2e}
.logo-title span{color:#667eea}
.subtitle{color:#888;font-size:14px;margin-top:6px}
.field{margin-bottom:18px}
.field label{display:block;font-size:13px;font-weight:600;color:#333;margin-bottom:7px}
.field input{width:100%;padding:13px 16px;background:#f5f6ff;border:2px solid #dde1ff;border-radius:10px;color:#1a1a2e;font-family:'Inter',sans-serif;font-size:15px;outline:none;transition:all 0.2s}
.field input:focus{border-color:#667eea;background:#fff;box-shadow:0 0 0 4px rgba(102,126,234,0.15)}
.field input::placeholder{color:#bbb}
.btn{width:100%;padding:14px;margin-top:4px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:10px;color:#fff;font-family:'Inter',sans-serif;font-size:15px;font-weight:600;cursor:pointer;transition:all 0.2s}
.btn:hover{transform:translateY(-1px);box-shadow:0 8px 25px rgba(102,126,234,0.5)}
.btn:disabled{opacity:0.6;cursor:not-allowed;transform:none}
.status{margin-top:14px;padding:11px 14px;border-radius:8px;font-size:13px;text-align:center;display:none;font-weight:500}
.status.error{background:#fff0f0;border:1.5px solid #ffcccc;color:#e53e3e;display:block}
.status.success{background:#f0fff4;border:1.5px solid #9ae6b4;color:#276749;display:block}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <span class="logo-icon">📧</span>
    <div class="logo-title">Fast<span>Mailer</span></div>
    <div class="subtitle">Sign in to launch your campaigns</div>
  </div>
  <div class="field"><label>Username</label><input id="username" type="text" placeholder="Enter your username"></div>
  <div class="field"><label>Password</label><input id="password" type="password" placeholder="Enter your password"></div>
  <button class="btn" id="loginBtn">Sign In →</button>
  <div class="status" id="status"></div>
</div>
<script>
const btn=document.getElementById('loginBtn'),st=document.getElementById('status');
async function doLogin(){
  const u=document.getElementById('username').value.trim(),p=document.getElementById('password').value.trim();
  if(!u||!p){st.className='status error';st.textContent='Username and password required';return}
  btn.disabled=true;btn.textContent='Signing in...';st.className='status';
  try{
    const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    const d=await r.json();
    if(d.success){st.className='status success';st.textContent='✅ Login successful!';setTimeout(()=>window.location.href='/launcher',700)}
    else{st.className='status error';st.textContent='❌ '+(d.message||'Invalid credentials');btn.disabled=false;btn.textContent='Sign In →'}
  }catch(e){st.className='status error';st.textContent='❌ Connection error';btn.disabled=false;btn.textContent='Sign In →'}
}
btn.addEventListener('click',doLogin);
document.addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
</script>
</body>
</html>
