document.addEventListener("DOMContentLoaded", () => {
  let sending = false;

  const ONE_HOUR = 60 * 60 * 1000;
  setTimeout(() => {
    localStorage.removeItem("loginTime");
    location.replace("/login.html");
  }, ONE_HOUR);

  const sendBtn = document.getElementById("sendBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const limitText = document.getElementById("limitText");

  const senderName = document.getElementById("senderName");
  const gmail = document.getElementById("gmail");
  const apppass = document.getElementById("apppass");
  const subject = document.getElementById("subject");
  const message = document.getElementById("message");
  const to = document.getElementById("to");

  sendBtn.addEventListener("click", () => {
    if (!sending) sendMail();
  });

  logoutBtn.addEventListener("dblclick", () => {
    if (sending) return;
    localStorage.removeItem("loginTime");
    location.replace("/login.html");
  });

  async function sendMail() {
    if (!senderName.value || !gmail.value || !apppass.value ||
        !subject.value || !message.value || !to.value) {
      alert("All fields required");
      return;
    }

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

      if (!data.success) alert(data.msg);
      else alert(`Mail Sent\nSent: ${data.sent}`);
    } catch {
      alert("Network error");
    } finally {
      sending = false;
      sendBtn.disabled = false;
      sendBtn.innerText = "Send All";
    }
  }
});
