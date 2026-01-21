const sendBtn = document.getElementById('sendBtn');

sendBtn.onclick = async () => {
  sendBtn.disabled = true;
  sendBtn.innerText = "Sending…";

  const res = await fetch('/send', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      senderName: senderName.value,
      email: email.value,
      password: password.value,
      subject: subject.value,
      message: message.value,
      recipients: recipients.value
    })
  });

  const data = await res.json();
  alert(data.message);

  sendBtn.disabled = false;
  sendBtn.innerText = "Send";
};

function logout(){
  fetch('/logout',{method:'POST'}).then(()=>location.href='/');
}
