/* Owner console: approve what the site collected. Passwords and instance keys
   are rendered only here, for the owner's screen. */
const $ = (sel) => document.querySelector(sel);
const toastEl = $('#toast');
const WA_NUMBER = '94776041953';

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
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'Request failed.');
  return body;
}

const post = (body) => ({ method: 'POST', body: JSON.stringify(body) });
const waHref = (text) => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { password } = Object.fromEntries(new FormData(e.target).entries());
  try {
    await call('/api/admin/login', post({ password }));
    await show();
  } catch (error) {
    toast(error.message);
  }
});

$('#signout').addEventListener('click', async () => {
  await call('/api/admin/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

let status = 'pending';

document.querySelectorAll('[data-status]').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('[data-status]').forEach((c) => c.classList.remove('on'));
    chip.classList.add('on');
    status = chip.dataset.status;
    loadOrders();
  });
});

function orderCard(order) {
  const el = document.createElement('article');
  el.className = 'order-card';
  const paid = `EZ Cash ${esc(order.ez_number)} · ref ${esc(order.txn_id)}`;
  el.innerHTML = `
    <header>
      <b>#${esc(order.id)} ${esc(order.name)}</b>
      <span class="chip ${esc(order.status)}">${esc(order.status)}</span>
    </header>
    <p>${esc(order.plan)} — Rs ${esc(order.price_lkr)} · ${esc(order.phone)} · ${esc(order.created_at)} UTC</p>
    <p class="tiny">${paid}</p>
    <p>Bot name <b>${esc(order.bot_name) || 'you choose'}</b> · prefix <b>${esc(order.prefix)}</b></p>
    ${order.notes ? `<p class="notes">${esc(order.notes)}</p>` : ''}
    <div class="order-actions"></div>`;

  const actions = el.querySelector('.order-actions');
  if (order.status === 'pending') {
    const approve = document.createElement('button');
    approve.className = 'btn btn-primary';
    approve.textContent = 'Approve and create the login';
    approve.addEventListener('click', async () => {
      approve.disabled = true;
      try {
        const data = await call('/api/admin/approve', post({ order_id: order.id }));
        renderCredentials(actions, data);
        toast(`Login created for ${data.login.phone}.`);
      } catch (error) {
        approve.disabled = false;
        toast(error.message);
      }
    });

    const reject = document.createElement('button');
    reject.className = 'btn btn-ghost';
    reject.textContent = 'Reject';
    reject.addEventListener('click', async () => {
      const reason = window.prompt('Why? (written on the order)', 'Payment not found');
      if (reason === null) return;
      await call('/api/admin/reject', post({ order_id: order.id, reason })).catch((error) => toast(error.message));
      loadOrders();
    });

    const wire = document.createElement('a');
    wire.className = 'btn btn-ghost';
    wire.target = '_blank';
    wire.rel = 'noopener';
    wire.textContent = 'Ask about this payment';
    wire.href = waHref(`*Order #${order.id}* — ${order.name}, ${order.plan}\nEZ Cash ${order.ez_number}, ref ${order.txn_id}`);

    actions.append(approve, reject, wire);
  } else if (order.customer_id) {
    loadCustomerInto(actions, order.customer_id);
  }
  return el;
}

/**
 * The password exists in this response and nowhere else, so it is shown as a
 * block the owner can copy straight into WhatsApp.
 */
function renderCredentials(into, data) {
  const text = [
    `*${data.customer.name}*, your AkenZ MD is ready.`,
    `Sign in at https://whatsappbot.noaura.xyz/account`,
    `Login: ${data.login.phone}`,
    `Password: ${data.login.password}`,
    '',
    'Inside: link your number with one code, then set your bot name, prefix and menu image.',
  ].join('\n');

  const box = document.createElement('div');
  box.className = 'credentials';
  const pre = document.createElement('pre');
  pre.textContent = text;
  const send = document.createElement('a');
  send.className = 'btn btn-primary';
  send.target = '_blank';
  send.rel = 'noopener';
  send.textContent = 'Send this to the buyer';
  send.href = waHref(text);
  const copy = document.createElement('button');
  copy.className = 'btn btn-ghost';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    toast('Copied.');
  });
  box.append(pre, send, copy);
  into.replaceChildren(box);
}

async function loadCustomerInto(into, id) {
  const data = await call('/api/admin/customers').catch(() => null);
  const customer = data?.customers?.find((c) => c.id === id);
  if (!customer) return;
  const link = document.createElement('span');
  link.className = 'tiny';
  link.textContent = customer.bot_url ? `Login ${customer.phone} · bot linked` : `Login ${customer.phone} · bot not linked yet`;
  into.replaceChildren(link);
}

async function loadOrders() {
  const data = await call(`/api/admin/orders?status=${status}`);
  $('#n-pending').textContent = data.counts.pending;
  $('#orders').replaceChildren(...data.orders.map(orderCard));
  if (!data.orders.length) $('#orders').textContent = 'Nothing here.';
}

async function loadCustomers() {
  const data = await call('/api/admin/customers');
  $('#customers').replaceChildren(
    ...data.customers.map((c) => {
      const el = document.createElement('article');
      el.className = 'order-card';
      el.innerHTML = `
        <header><b>${esc(c.name)}</b> <span class="chip ${esc(c.status)}">${esc(c.plan)}</span></header>
        <p>${esc(c.phone)} · until ${esc(c.expires_at ?? '').slice(0, 10)} · ${esc(c.orders_approved)} order(s)</p>
        <p class="tiny">instance ${esc(c.instance_id)} · ${c.bot_url ? 'bot linked' : 'no bot linked'}</p>`;
      return el;
    })
  );
  if (!data.customers.length) $('#customers').textContent = 'No customers yet.';
}

async function show() {
  const session = await call('/api/session').catch(() => ({ admin: false }));
  if (!session.admin) return;
  $('#signin').classList.add('hidden');
  $('#console').classList.remove('hidden');
  document.querySelector('[data-status="pending"]').classList.add('on');
  await Promise.all([loadOrders(), loadCustomers()]);
}

show();
