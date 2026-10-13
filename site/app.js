/* AkenZ MD — site behaviour. Static only: no analytics, no server calls, the order
   leaves as a pre-filled WhatsApp message the buyer sends themselves. */
const WA_NUMBER = '94776041953';
const EZ_CASH = '0776041953';
const EZ_DISPLAY = '077 604 1953';

const $ = (sel) => document.querySelector(sel);
const toastEl = $('#toast');

function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

const waHref = (text) => `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(text)}`;

$('#wa-direct').href = waHref('Hi! I want a AkenZ MD WhatsApp bot.');
document.querySelectorAll('.wa-link').forEach((a) => (a.href = waHref('Hi! I have a question about AkenZ MD.')));
$('#year').textContent = new Date().getFullYear();

// ── pointer glow ──────────────────────────────────────────────────────────
const glow = $('#glow');
let glowOn = false;
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  if (!glowOn) { glowOn = true; glow.classList.add('on'); }
}, { passive: true });

// ── mobile menu ───────────────────────────────────────────────────────────
const menu = $('#menu');
$('#burger').addEventListener('click', () => menu.classList.toggle('open'));
menu.addEventListener('click', (e) => { if (e.target.tagName === 'A') menu.classList.remove('open'); });

// ── nav highlight for the section you are reading ──────────────────────────
const navLinks = [...menu.querySelectorAll('a[href^="#"]')];
const sections = navLinks.map((a) => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
if ('IntersectionObserver' in window) {
  const spy = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${visible.target.id}`));
    },
    { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.25, 0.5] },
  );
  sections.forEach((s) => spy.observe(s));
}

// ── gentle reveal, skipped when the visitor asked for less motion ──────────
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealables = [...document.querySelectorAll('.card, .price, .cmd-block, .steps li, details')];
if (!reduceMotion && 'IntersectionObserver' in window) {
  const seen = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('seen');
      obs.unobserve(e.target);
    });
  }, { threshold: 0.12 });
  revealables.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = `${(i % 3) * 60}ms`;
    seen.observe(el);
  });
}

// ── pricing buttons pre-fill the order form ────────────────────────────────
const planSelect = $('#order-form select[name="plan"]');
const payAmount = $('#pay-amount');
const syncAmount = () => {
  const [, price] = planSelect.value.split('—');
  payAmount.textContent = (price ?? '').trim() || '—';
};
planSelect.addEventListener('change', syncAmount);
document.querySelectorAll('[data-plan]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const option = [...planSelect.options].find((o) => o.value.toLowerCase().includes(btn.dataset.plan));
    if (option) planSelect.value = option.value;
    syncAmount();
  });
});
syncAmount();

// ── the order ──────────────────────────────────────────────────────────────
$('#order-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const name = (data.name ?? '').trim();
  const rawPhone = (data.phone ?? '').replace(/[^\d+]/g, '');
  if (name.length < 2) { toast('Please write your name.'); return; }
  if (rawPhone.replace(/\D/g, '').length < 9) { toast('That WhatsApp number looks too short.'); return; }

  const lines = [
    '*New AkenZ MD order*',
    `Name: ${name}`,
    `WhatsApp: ${data.phone.trim()}`,
    `Plan: ${data.plan}`,
    `Bot name: ${(data.botname ?? '').trim() || 'you choose'}`,
    `Prefix: ${(data.prefix ?? '.').trim()}`,
  ];
  const notes = (data.notes ?? '').trim();
  if (notes) lines.push(`Notes: ${notes}`);
  lines.push('', 'I will pay by EZ Cash and send the transaction ID here.');

  window.open(waHref(lines.join('\n')), '_blank', 'noopener');
  toast('WhatsApp is opening — press send there.');
});

$('#copy-ez').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(EZ_CASH);
    toast(`EZ Cash number copied — ${EZ_DISPLAY}`);
  } catch {
    toast(`EZ Cash number: ${EZ_DISPLAY}`);
  }
});
