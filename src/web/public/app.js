/** AkenZ MD — private dashboard. Plain ES modules, no build step. */

const csrf = { token: null };

const el = (id) => document.getElementById(id);
const views = el('view');
// The view on screen, and an optional refresher it registers to stay live
// between polls. Guarded by name so a slow render can't repaint another view.
let currentView = '';
let live = null;

const h = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const num = (n) => new Intl.NumberFormat().format(Number(n) || 0);

const duration = (ms) => {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(csrf.token && method !== 'GET' ? { 'x-csrf-token': csrf.token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Session expired. Sign in again.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message, bad = false) {
  const node = document.createElement('div');
  node.className = `toast${bad ? ' bad' : ''}`;
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 6000);
}

function table(headers, rows) {
  if (!rows.length) return '<p class="empty">Nothing stored yet.</p>';
  return `<table><thead><tr>${headers
    .map((t) => `<th>${h(t)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

/* ── Theme ─────────────────────────────────────────────────────────────── */
const THEMES = ['dark', 'light', 'system'];
let themeIndex = Number(THEMES.includes(localStorage.getItem('akenz.theme')) ? THEMES.indexOf(localStorage.getItem('akenz.theme')) : 0);

function applyTheme() {
  const mode = THEMES[themeIndex];
  const dark = mode === 'dark' || (mode === 'system' && !matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  el('theme-toggle').textContent = `Theme: ${mode[0].toUpperCase()}${mode.slice(1)}`;
}

el('theme-toggle').addEventListener('click', () => {
  themeIndex = (themeIndex + 1) % THEMES.length;
  localStorage.setItem('akenz.theme', THEMES[themeIndex]);
  applyTheme();
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (THEMES[themeIndex] === 'system') applyTheme();
});

/* ── Auth ──────────────────────────────────────────────────────────────── */
function showLogin() {
  el('login').hidden = false;
  el('app').hidden = true;
}

function showApp() {
  el('login').hidden = true;
  el('app').hidden = false;
}

el('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const box = el('login-error');
  box.hidden = true;
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: { username: el('login-username').value.trim(), password: el('login-password').value },
    });
    csrf.token = data.csrf;
    showApp();
    await route();
  } catch (error) {
    box.textContent = error.message;
    box.hidden = false;
  }
});

el('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  csrf.token = null;
  showLogin();
});

/* ── Connection pill ───────────────────────────────────────────────────── */
function paintPill(state) {
  const pill = el('conn-pill');
  const connected = state.status === 'connected';
  const warning = state.status === 'connecting' || state.status === 'reconnecting' || state.status === 'awaiting_pairing';
  pill.className = `pill ${connected ? 'pill-ok' : warning ? 'pill-warn' : 'pill-off'}`;
  pill.textContent = `${state.label}${state.reconnectAttempt ? ` (try ${state.reconnectAttempt})` : ''}`;
}

async function refreshStatus() {
  try {
    const data = await api('/api/whatsapp/status');
    paintPill(data);
    return data;
  } catch (error) {
    el('conn-pill').className = 'pill pill-off';
    el('conn-pill').textContent = 'Bot unreachable';
    throw error;
  }
}

/* ── Views ─────────────────────────────────────────────────────────────── */
const VIEWS = {
  overview: { title: 'Dashboard', note: 'Live data from this bot process.', render: renderOverview },
  whatsapp: { title: 'WhatsApp', note: 'Pairing code, session and reconnect controls.', render: renderWhatsapp },
  commands: { title: 'Commands', note: 'Custom commands and built-in commands.', render: renderCommands },
  autoreplies: { title: 'Auto Reply', note: 'Database-backed replies, matched case-insensitively.', render: renderAutoReplies },
  groups: { title: 'Groups', note: 'Groups the bot has seen, with their settings.', render: renderGroups },
  media: { title: 'Media', note: 'Downloader tooling and job history.', render: renderMedia },
  ai: { title: 'AI', note: 'AI provider state and the .ai switch.', render: renderAi },
  scheduler: { title: 'Scheduler', note: 'Pending, delivered and failed tasks.', render: renderScheduler },
  logs: { title: 'Logs', note: 'Bot events — no message content, no secrets.', render: renderLogs },
  settings: { title: 'Settings', note: 'Stored in the database, applied immediately.', render: renderSettings },
};

function template(name) {
  return el(`tpl-${name}`).content.cloneNode(true);
}

async function renderOverview() {
  views.replaceChildren(template('overview'));
  const [status, logs] = await Promise.all([api('/api/status'), api('/api/logs?limit=12')]);
  const wa = status.whatsapp;
  el('conn-pill').className = `pill ${wa.connected ? 'pill-ok' : wa.status.includes('ing') ? 'pill-warn' : 'pill-off'}`;
  el('conn-pill').textContent = wa.label;

  el('s-whatsapp').textContent = wa.label.replace(/^[^\s]+\s/, '');
  el('s-bot').textContent = 'Online';
  el('s-users').textContent = num(status.stats.users);
  el('s-groups').textContent = num(status.stats.groups);
  el('s-messages').textContent = num(status.stats.messages);
  el('s-commands').textContent = num(status.stats.commands);
  el('s-media').textContent = num(status.stats.media ?? 0);
  el('s-uptime').textContent = duration(Date.now() - status.startedAt);

  const dl = el('session-detail');
  dl.replaceChildren(
    ...entries({
      'Bot name': status.bot.name,
      Version: status.bot.version,
      Prefix: status.bot.prefix,
      Account: wa.selfJid ?? 'not paired',
      'Connected since': wa.connectedAt ? fmt.format(new Date(wa.connectedAt)) : '—',
      'Last error': wa.lastError ?? 'none',
    })
  );
  el('overview-logs').innerHTML = table(
    ['Time', 'Level', 'Scope', 'Message'],
    logs.map((l) => [fmt.format(new Date(l.createdAt)), `<span class="tag">${h(l.level)}</span>`, h(l.scope), h(l.message)])
  );
  live = { view: 'overview', refresh: renderOverview };
}

function entries(map) {
  return Object.entries(map).flatMap(([k, v]) => [
    (() => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      return dt;
    })(),
    (() => {
      const dd = document.createElement('dd');
      dd.textContent = v === null || v === undefined ? '—' : String(v);
      return dd;
    })(),
  ]);
}

async function renderWhatsapp() {
  views.replaceChildren(template('whatsapp'));
  const state = await refreshStatus();

  el('pair-number').value = state.phoneNumber ?? '';

  el('pair-btn').addEventListener('click', async () => {
    const btn = el('pair-btn');
    btn.disabled = true;
    el('pair-error').hidden = true;
    try {
      const data = await api('/api/whatsapp/pair', { method: 'POST', body: { phoneNumber: el('pair-number').value } });
      await refreshDetail();
      el('steps-en').innerHTML = data.instructions.en.map((s) => `<li>${h(s)}</li>`).join('');
      el('steps-si').innerHTML = data.instructions.si.map((s) => `<li>${h(s)}</li>`).join('');
    } catch (error) {
      el('pair-error').textContent = error.message;
      el('pair-error').hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  const act = async (path, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    try {
      await api(path, { method: 'POST' });
      await refreshDetail();
      await refreshStatus();
      toast('Done.');
    } catch (error) {
      toast(error.message, true);
    }
  };
  el('wa-reconnect').addEventListener('click', () => act('/api/whatsapp/reconnect'));
  el('wa-disconnect').addEventListener('click', () => act('/api/whatsapp/disconnect', 'Disconnect the bot session now?'));
  el('wa-logout').addEventListener('click', () =>
    act('/api/whatsapp/logout', 'This unlinks the device and destroys the stored session. You will have to pair again. Continue?')
  );

  async function refreshDetail() {
    const s = await api('/api/whatsapp/status');
    el('wa-detail').replaceChildren(
      ...entries({
        Status: s.label,
        Number: s.phoneNumber ?? '—',
        'Self JID': s.selfJid ?? '—',
        'Pairing code': s.pairingCode ? `${s.pairingCode} (expires ${fmt.format(new Date(s.pairingCodeExpiresAt))})` : 'none active',
        'Last error': s.lastError ?? 'none',
      })
    );
    // Baileys rotates the QR every ~20s, so it is re-fetched on each poll rather
    // than once; a stale image would scan and be rejected.
    if (s.status === 'awaiting_pairing') await paintQr(s);
    else hideQr();
    // The server re-issues a code when WhatsApp drops the socket, so it — not the
    // original button response — is the source of truth for what is valid now.
    if (s.pairingCode) paintCode(s);
    else if (s.lastError === 'Pairing code expired') paintExpired();
    else hideCode();
  }
  live = { view: 'whatsapp', refresh: refreshDetail };
  await refreshDetail();

  async function paintQr(s) {
    el('pair-qr-box').hidden = false;
    if (!s.hasPairingQr) {
      // WhatsApp closes the socket when its QR refs run out, so there is often a
      // gap of a few seconds between one QR and the next. Say so — an empty panel
      // reads as a broken bot.
      el('pair-qr').removeAttribute('src');
      el('pair-qr-note').textContent = 'Waiting for the next QR from WhatsApp. Keep this page open — one appears within about 30 seconds.';
      return;
    }
    try {
      const { dataUrl } = await api('/api/whatsapp/qr');
      el('pair-qr').src = dataUrl;
      el('pair-qr-note').textContent = 'Scan this now — WhatsApp replaces the QR roughly every 30 seconds, and an old one will not pair.';
    } catch (error) {
      // The QR can expire between the status poll and this fetch — the next poll
      // retries, so this is not worth a toast.
      el('pair-qr').removeAttribute('src');
      el('pair-qr-note').textContent = `QR just rotated (${error.message}) — the next poll brings the new one.`;
    }
  }

  function hideQr() {
    el('pair-qr-box').hidden = true;
  }

  function paintCode(s) {
    el('pair-out').hidden = false;
    el('pair-code').textContent = s.pairingCode ?? '------';
    el('pair-expires').textContent =
      `For +${s.phoneNumber ?? ''} — type it on that phone. Valid until ` +
      `${fmt.format(new Date(s.pairingCodeExpiresAt))}. If it changes, the old one is dead.`;
  }

  function paintExpired() {
    el('pair-out').hidden = false;
    el('pair-code').textContent = '------';
    el('pair-expires').textContent =
      'No live code right now. While pairing is running a fresh one appears on its ' +
      'own — if none shows up, press Generate Pairing Code again.';
  }

  // A code only ever belongs to the socket that asked for it. Showing the last
  // one while the server holds none would invite the owner to type dead digits.
  function hideCode() {
    el('pair-out').hidden = true;
  }
}

async function renderCommands() {
  views.replaceChildren(template('commands'));
  const data = await api('/api/commands');

  el('custom-commands').innerHTML = table(
    ['Command', 'Response', 'Created by', ''],
    data.custom.map((c) => [
      `<code>.${h(c.name)}</code>`,
      h(c.response.slice(0, 120)) + (c.response.length > 120 ? '…' : ''),
      h(c.createdBy),
      `<button class="btn btn-mini" data-del="${c.id}">Delete</button>`,
    ])
  );
  el('builtin-commands').innerHTML = table(
    ['Command', 'Category', 'Description', 'Access'],
    data.builtIn.map((c) => [
      `<code>${h(c.usage)}</code>`,
      `<span class="tag">${h(c.category)}</span>`,
      h(c.description),
      c.ownerOnly ? '<span class="tag off">owner only</span>' : '<span class="tag">everyone</span>',
    ])
  );

  el('custom-commands').addEventListener('click', async (event) => {
    const id = event.target.dataset?.del;
    if (!id) return;
    try {
      await api(`/api/commands/${id}`, { method: 'DELETE' });
      await renderCommands();
    } catch (error) {
      toast(error.message, true);
    }
  });

  el('cmd-add').addEventListener('click', async () => {
    el('cmd-error').hidden = true;
    try {
      await api('/api/commands', {
        method: 'POST',
        body: { name: el('cmd-name').value, response: el('cmd-response').value },
      });
      el('cmd-name').value = '';
      el('cmd-response').value = '';
      await renderCommands();
      toast('Command added.');
    } catch (error) {
      el('cmd-error').textContent = error.message;
      el('cmd-error').hidden = false;
    }
  });
}

async function renderAutoReplies() {
  views.replaceChildren(template('autoreplies'));
  const rows = await api('/api/autoreplies');
  el('autoreply-list').innerHTML = table(
    ['Triggers', 'Match', 'Response', 'Enabled', ''],
    rows.map((r) => [
      h(r.triggers),
      `<span class="tag">${h(r.matchType)}</span>`,
      h(r.response.slice(0, 120)) + (r.response.length > 120 ? '…' : ''),
      `<button class="btn btn-mini" data-toggle="${r.id}" aria-pressed="${String(r.enabled)}">${
        r.enabled ? '<span class="dot ok"></span>on' : '<span class="dot err"></span>off'
      }</button>`,
      `<button class="btn btn-mini" data-del="${r.id}">Delete</button>`,
    ])
  );

  el('autoreply-list').addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const { del, toggle } = button.dataset;
    try {
      if (del) await api(`/api/autoreplies/${del}`, { method: 'DELETE' });
      if (toggle) {
        await api(`/api/autoreplies/${toggle}`, {
          method: 'PATCH',
          body: { enabled: button.getAttribute('aria-pressed') !== 'true' },
        });
      }
      await renderAutoReplies();
    } catch (error) {
      toast(error.message, true);
    }
  });

  el('ar-add').addEventListener('click', async () => {
    el('ar-error').hidden = true;
    try {
      await api('/api/autoreplies', {
        method: 'POST',
        body: {
          triggers: el('ar-triggers').value,
          response: el('ar-response').value,
          matchType: el('ar-match').value,
        },
      });
      el('ar-triggers').value = '';
      el('ar-response').value = '';
      await renderAutoReplies();
      toast('Auto reply added.');
    } catch (error) {
      el('ar-error').textContent = error.message;
      el('ar-error').hidden = false;
    }
  });
}

async function renderGroups() {
  views.replaceChildren(template('groups'));
  const rows = await api('/api/groups');
  el('group-list').innerHTML = table(
    ['Name', 'Members', 'Prefix', 'Welcome', 'Goodbye', 'Anti-spam', 'Muted', 'Rules'],
    rows.map((g) => {
      const s = g.settings;
      const flag = (v) => (v ? '<span class="dot ok"></span>on' : '<span class="dot err"></span>off');
      return [
        h(g.name ?? g.jid),
        num(g.memberCount),
        s ? h(s.prefix || 'default') : '—',
        s ? flag(s.welcome) : '—',
        s ? flag(s.goodbye) : '—',
        s ? flag(s.antiSpam) : '—',
        s ? flag(s.muted) : '—',
        s && s.rules ? `${h(s.rules.slice(0, 40))}${s.rules.length > 40 ? '…' : ''}` : '—',
      ];
    })
  );
}

async function renderMedia() {
  views.replaceChildren(template('media'));
  const [tools, history] = await Promise.all([api('/api/media/tools'), api('/api/media/history')]);
  const card = (name, value, note) =>
    `<div class="card stat"><span class="stat-label">${h(name)}</span><strong>${h(value)}</strong><span class="muted">${h(note)}</span></div>`;
  el('media-tools').innerHTML =
    card('yt-dlp', tools.ytdlp ? tools.ytdlp : 'not installed', tools.ytdlp ? 'music + video ready' : 'needed for .music / .video') +
    card('ffmpeg', tools.ffmpeg ? tools.ffmpeg : 'not installed', tools.ffmpeg ? 'animated stickers ready' : 'needed for video stickers') +
    card('Limits', `${tools.limits.maxMb} MB`, `${tools.limits.ratePerHour} jobs per user per hour`);

  el('media-history').innerHTML = table(
    ['Time', 'Kind', 'Search', 'Provider', 'Status', 'Size'],
    history.map((m) => [
      fmt.format(new Date(m.createdAt)),
      h(m.kind),
      h((m.query || '').slice(0, 60)),
      h(m.provider ?? '—'),
      `<span class="tag ${m.status === 'ok' ? 'on' : 'off'}">${h(m.status)}</span>`,
      m.bytes ? `${(m.bytes / 1024 / 1024).toFixed(1)} MB` : '—',
    ])
  );
}

async function renderAi() {
  views.replaceChildren(template('ai'));
  const [integration, settings] = await Promise.all([api('/api/integrations'), api('/api/settings')]);
  const ai = integration.ai;
  el('ai-detail').replaceChildren(
    ...entries({
      Provider: ai.provider === 'none' ? 'not configured' : ai.provider,
      Model: ai.model || '—',
      Configured: ai.configured ? 'yes — .ai will answer' : 'no — .ai says it is disabled',
      'Conversation memory': 'in this process only, never stored in the database',
    })
  );
  el('ai-enabled').checked = Boolean(settings.settings.aiEnabled);
  el('ai-save').addEventListener('click', async () => {
    await api('/api/settings', { method: 'POST', body: { aiEnabled: el('ai-enabled').checked } });
    toast('Saved.');
  });
}

async function renderScheduler() {
  views.replaceChildren(template('scheduler'));
  const data = await api('/api/schedules');
  el('schedule-list').innerHTML = table(
    ['Runs at', 'Chat', 'Message', 'Status', 'Tries', ''],
    data.tasks.map((t) => [
      `<span class="muted">${fmt.format(new Date(t.runAt))}</span>`,
      h(t.chatJid.split('@')[0]),
      h(t.message.slice(0, 90)) + (t.message.length > 90 ? '…' : ''),
      `<span class="tag ${t.status === 'done' ? 'on': t.status === 'failed' ? 'off' : ''}">${h(t.status)}</span>`,
      num(t.attempts),
      t.status === 'pending' ? `<button class="btn btn-mini" data-del="${t.id}">Cancel</button>` : '',
    ])
  );
  el('schedule-list').addEventListener('click', async (event) => {
    const id = event.target.dataset?.del;
    if (!id) return;
    try {
      await api(`/api/schedules/${id}`, { method: 'DELETE' });
      await renderScheduler();
    } catch (error) {
      toast(error.message, true);
    }
  });
}

async function renderLogs() {
  views.replaceChildren(template('logs'));
  const rows = await api('/api/logs?limit=200');
  el('log-list').innerHTML = table(
    ['Time', 'Level', 'Scope', 'Message', 'Detail'],
    rows.map((l) => [
      fmt.format(new Date(l.createdAt)),
      `<span class="tag ${l.level === 'error' ? 'off' : l.level === 'warn' ? '' : 'on'}">${h(l.level)}</span>`,
      h(l.scope),
      h(l.message),
      `<span class="muted">${h(JSON.stringify(l.meta ?? {}))}</span>`,
    ])
  );
}

const SETTINGS_FIELDS = [
  { key: 'name', label: 'Bot name', type: 'text' },
  { key: 'prefix', label: 'Prefix', type: 'select', options: ['.', '!', '/', '#'] },
  { key: 'language', label: 'Default language', type: 'select', options: ['en', 'si'], labels: { en: 'English', si: 'සිංහල' } },
  { key: 'statusText', label: 'Status text', type: 'text' },
  { key: 'maxWarnings', label: 'Max warnings', type: 'number' },
  { key: 'warningAction', label: 'Warning limit action', type: 'select', options: ['mute', 'remove'] },
  { key: 'autoReplyEnabled', label: 'Auto reply', type: 'bool' },
  { key: 'mediaEnabled', label: 'Media tools', type: 'bool' },
  { key: 'groupToolsEnabled', label: 'Group tools', type: 'bool' },
  { key: 'welcomeEnabled', label: 'Welcome messages', type: 'bool' },
  { key: 'goodbyeEnabled', label: 'Goodbye messages', type: 'bool' },
];

async function renderSettings() {
  views.replaceChildren(template('settings'));
  const [{ settings, hasLogo }, integration] = await Promise.all([api('/api/settings'), api('/api/integrations')]);
  const form = el('settings-form');
  form.replaceChildren();
  const inputs = {};

  for (const field of SETTINGS_FIELDS) {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = field.label;
    wrap.appendChild(label);
    let node;
    if (field.type === 'bool') {
      node = document.createElement('input');
      node.type = 'checkbox';
      node.checked = Boolean(settings[field.key]);
      wrap.classList.add('check-wrap');
      const inner = document.createElement('label');
      inner.className = 'check';
      inner.appendChild(node);
      const text = document.createElement('span');
      text.textContent = settings[field.key] ? 'On' : 'Off';
      inner.appendChild(text);
      node.addEventListener('change', () => (text.textContent = node.checked ? 'On' : 'Off'));
      wrap.appendChild(inner);
      label.textContent = field.label;
    } else if (field.type === 'select') {
      node = document.createElement('select');
      for (const option of field.options) {
        const o = document.createElement('option');
        o.value = option;
        o.textContent = field.labels?.[option] ?? option;
        node.appendChild(o);
      }
      node.value = String(settings[field.key] ?? field.options[0]);
    } else {
      node = document.createElement('input');
      node.type = field.type === 'number' ? 'number' : 'text';
      node.min = '1';
      node.max = '10';
      node.value = settings[field.key] ?? '';
    }
    inputs[field.key] = node;
    if (field.type !== 'bool') wrap.appendChild(node);
    form.appendChild(wrap);
  }

  el('settings-save').addEventListener('click', async () => {
    const body = {};
    for (const [key, node] of Object.entries(inputs)) body[key] = node.type === 'checkbox' ? node.checked : node.value;
    await api('/api/settings', { method: 'POST', body });
    el('settings-msg').textContent = `Saved at ${fmt.format(new Date())}. Prefix and language changes apply to the next message.`;
    toast('Settings saved.');
  });

  // Brand image. Painted from the API rather than the picked file, so what the
  // owner sees is what the bot actually stored.
  let shown = hasLogo;
  const paintBrand = () => {
    const box = el('brand-preview');
    box.replaceChildren();
    if (!shown) {
      const note = document.createElement('p');
      note.className = 'muted';
      note.textContent = 'No image uploaded — the menu falls back to the built-in banner.';
      box.appendChild(note);
      return;
    }
    const img = document.createElement('img');
    img.className = 'brand-img';
    img.alt = 'Current brand image';
    img.src = `/api/settings/logo?t=${Date.now()}`;
    box.appendChild(img);
  };
  paintBrand();

  el('brand-save').addEventListener('click', async () => {
    const file = el('brand-file').files?.[0];
    if (!file) {
      toast('Choose a JPEG or PNG image first.', true);
      return;
    }
    const res = await fetch('/api/settings/logo', {
      method: 'PUT',
      headers: {
        'content-type': file.type || 'image/jpeg',
        ...(csrf.token ? { 'x-csrf-token': csrf.token } : {}),
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error ?? `Upload failed (${res.status}).`, true);
      return;
    }
    shown = true;
    paintBrand();
    el('brand-msg').textContent = `Stored ${num(Math.round(data.bytes / 1024))} kB. The next menu uses it.`;
    toast('Brand image saved.');
  });

  el('brand-remove').addEventListener('click', async () => {
    try {
      await api('/api/settings/logo', { method: 'DELETE' });
      shown = false;
      paintBrand();
      el('brand-msg').textContent = '';
      toast('Brand image removed.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  el('integration-detail').replaceChildren(
    ...entries({
      'Owner number': integration.ownerNumberSet ? 'set in .env' : 'NOT SET — owner commands stay locked until you set OWNER_NUMBER',
      'Owner WhatsApp ID': integration.ownerJidSet
        ? 'set in .env — needed for owner commands in private chats'
        : 'NOT SET — run .profile in a private chat and put that ID in OWNER_JID',
      Weather: integration.weather.keyless ? 'Open-Meteo (no key needed)' : `OpenWeatherMap — API key ${integration.weather.configured ? 'set' : 'missing'}`,
      Translate: integration.translate.keyless ? 'MyMemory (no key needed)' : 'DeepL — API key required',
      AI: integration.ai.configured ? `${integration.ai.provider} / ${integration.ai.model}` : 'no key — .ai reports that it is disabled',
      Media: integration.media.enabled ? 'enabled' : 'disabled by config',
    })
  );
}

/* ── Router ────────────────────────────────────────────────────────────── */
async function route() {
  const name = (location.hash.replace('#/', '') || 'overview').split('?')[0];
  const view = VIEWS[name] ? name : 'overview';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  el('view-title').textContent = VIEWS[view].title;
  el('view-note').textContent = VIEWS[view].note;
  currentView = view;
  live = null;
  try {
    await VIEWS[view].render();
  } catch (error) {
    if (error.message === 'Session expired. Sign in again.') return;
    views.innerHTML = `<div class="card"><h3>Could not load this page</h3><p class="error">${h(error.message)}</p></div>`;
  }
}

addEventListener('hashchange', route);

async function boot() {
  applyTheme();
  try {
    const { token } = await api('/api/csrf');
    csrf.token = token;
    showApp();
    await route();
    setInterval(() => {
      refreshStatus()
        .then(() => {
          if (live && live.view === currentView) return live.refresh();
        })
        .catch(() => {});
    }, 5000);
  } catch {
    showLogin();
  }
}

void boot();
