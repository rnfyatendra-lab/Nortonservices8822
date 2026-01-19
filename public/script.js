document.addEventListener("DOMContentLoaded", () => {
  let sending = false;

  const sendBtn = document.getElementById("sendBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const limitText = document.getElementById("limitText");

  sendBtn.onclick = async () => {
    if (sending) return;
    sending = true;
    sendBtn.disabled = true;
    sendBtn.innerText = "Sending…";

    try {
      const res = await fetch("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderName: senderName.value.trim(),
          gmail: gmail.value.trim(),
          apppass: apppass.value,
          subject: subject.value.trim(),
          message: message.value.trim(),
          to: to.value.trim()
        })
      });

      const data = await res.json();
      limitText.innerText = `${data.count || 0} / 28`;
      alert(data.success ? `Sent: ${data.sent}` : data.msg);
    } catch {
      alert("Network error");
    }

    sending = false;
    sendBtn.disabled = false;
    sendBtn.innerText = "Send All";
  };

  logoutBtn.ondblclick = () => {
    localStorage.removeItem("loginTime");
    location.replace("/login.html");
  };
});
