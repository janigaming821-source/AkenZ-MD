/* Buyer portal. Everything goes through /api/* on this origin; the bot instance
   key stays inside the Functions proxy and is never seen here. */
const $ = (sel) => document.querySelector(sel);
const toastEl = $('#toast');

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.add('hidden'), 3600);
}

async function call(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) throw new Error(body.error ?? 'Something went wrong.');
  return body;
}

const bot = (path, options) => call(`/api/bot/${path}`, options).catch((error) => {
  toast(error.message);
  throw error;
});

const post = (body) => ({ method: 'POST', body: JSON.stringify(body) });

let me = null;

// ── sign in / restore ──────────────────────────────────────────────────────
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    await call('/api/login', post(data));
    await show();
  } catch (error) {
    toast(error.message);
  }
});

$('#signout').addEventListener('click', async () => {
  await call('/api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

async function show() {
  const session = await call('/api/session').catch(() => ({ customer: null }));
  if (!session.customer) return;
  me = session.customer;
  $('#signin').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');
  $('#hello').textContent = `${me.name}'s bot`;
  $('#plan-line').textContent =
    `${me.plan}${me.expires_at ? ` · paid up to ${String(me.expires_at).slice(0, 10)}` : ''} · login ${me.phone}`;
  loadStatus();
  loadSettings();
}

// ── connection state ───────────────────────────────────────────────────────
const chip = $('#state-chip');

async function loadStatus() {
  if (!me.bot_url) {
    chip.textContent = 'waiting for the owner to link your bot';
    chip.classList.add('warn');
    return;
  }
  const state = await bot('status').catch(() => null);
  if (!state) return;
  chip.textContent = state.connected ? `connected as ${state.phoneNumber ?? 'your number'}` : state.label ?? state.status;
  chip.classList.toggle('warn', !state.connected);
  if (state.pairingCode) renderCode(state.pairingCode, state.pairingCodeExpiresAt);
}

// ── pairing ────────────────────────────────────────────────────────────────
function renderCode(code, expiresAt) {
  $('#pair-code').textContent = code;
  $('#pair-result').classList.remove('hidden');
  const left = expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 1000)) : 0;
  $('#pair-note').textContent = left ? `This code is valid for about ${left} seconds.` : 'This code has expired — press the button again.';
}

$('#ask-code').addEventListener('click', async () => {
  const raw = $('#pair-phone').value.trim() || me.phone;
  const data = await bot('pair', post({ phoneNumber: raw })).catch(() => null);
  if (!data) return;
  renderCode(data.code, data.expiresAt);
  const steps = data.instructions?.[me.language] ?? data.instructions?.en ?? [];
  $('#pair-note').textContent = steps.join(' ');
});

$('#ask-qr').addEventListener('click', async () => {
  const data = await bot('qr').catch(() => null);
  if (!data) return;
  const img = $('#pair-qr');
  img.src = data.dataUrl;
  img.classList.remove('hidden');
  $('#pair-result').classList.remove('hidden');
});

// ── settings ───────────────────────────────────────────────────────────────
const FORM = $('#settings-form');

async function loadSettings() {
  const data = await bot('settings').catch(() => null);
  if (!data) return;
  const s = data.settings ?? {};
  for (const input of FORM.elements) {
    if (!input.name || !(input.name in s)) continue;
    if (input.type === 'checkbox') input.checked = Boolean(s[input.name]);
    else input.value = s[input.name] ?? '';
  }
  me.language = s.language ?? 'si';
  if (data.hasLogo) {
    const preview = $('#logo-preview');
    preview.src = '/api/bot/logo';
    preview.classList.remove('hidden');
  }
}

FORM.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(FORM).entries());
  const patch = {
    name: data.name,
    prefix: data.prefix,
    language: data.language,
    statusText: data.statusText ?? '',
  };
  for (const input of FORM.elements) {
    if (input.type === 'checkbox') patch[input.name] = input.checked;
  }
  await bot('settings', post(patch));
  toast('Saved — your bot uses it on the next message.');
});

// ── brand image ────────────────────────────────────────────────────────────
$('#logo-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) {
    toast('That image is over 3 MB.');
    return;
  }
  await call('/api/bot/logo', { method: 'PUT', headers: { 'content-type': file.type }, body: file });
  toast('Menu image updated.');
  $('#logo-preview').src = `/api/bot/logo?${Date.now()}`;
  $('#logo-preview').classList.remove('hidden');
});

$('#logo-clear').addEventListener('click', async () => {
  await call('/api/bot/logo', { method: 'DELETE' }).catch(() => {});
  $('#logo-preview').classList.add('hidden');
  toast('Menu image removed.');
});

// ── password ───────────────────────────────────────────────────────────────
$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    await call('/api/password', post(data));
    toast('Password changed. Sign in with the new one.');
    e.target.reset();
  } catch (error) {
    toast(error.message);
  }
});

show();
