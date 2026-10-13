// Polls the pairing endpoints without any build step: this page must work even
// when the edge hands the owner a stale bundle.
var img = document.getElementById('qr');
var note = document.getElementById('note');

function showQr() {
  return fetch('/api/whatsapp/qr', { cache: 'no-store' })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (data) {
      if (data && data.dataUrl) {
        img.src = data.dataUrl;
        img.style.display = 'block';
        note.className = '';
        note.textContent = 'Scan now — WhatsApp replaces this QR about every 30 seconds.';
      }
    });
}

function tick() {
  return fetch('/api/whatsapp/status', { cache: 'no-store' })
    .then(function (r) {
      return r.json();
    })
    .then(function (s) {
      if (s.connected) {
        img.style.display = 'none';
        note.className = 'done';
        note.textContent = 'Linked. Close this page and start using the bot.';
        return;
      }
      if (!s.hasPairingQr) {
        note.className = '';
        note.textContent = 'No QR yet (' + (s.label || s.status) + '). Keep this page open — one arrives within about 30 seconds.';
        return;
      }
      return showQr();
    })
    .catch(function () {});
}

tick();
setInterval(tick, 4000);
