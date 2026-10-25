import sharp from 'sharp';

/**
 * The delivery receipt as a picture.
 *
 * A number in a chat is easy to lose; a card with the UID, the pack and the
 * reference on it is what a buyer forwards when they come back in a week asking
 * where their diamonds went. It is drawn as SVG and rasterised with sharp — the
 * bot already depends on it for stickers — so there is no headless browser and
 * no new native dependency to keep alive on the seller's machine.
 *
 * Labels stay English on purpose: the font librsvg reaches for here has no
 * Sinhala faces, and half a word rendered as empty boxes is worse than a word
 * in the other language. The Sinhala goes out in the message text instead.
 */

export interface ReceiptCard {
  storeName: string;
  ref: string;
  ffId: string;
  nickname: string;
  level?: number | null;
  region?: string;
  items: { name: string; qty: number; price: number }[];
  total: number;
  method: string;
  at: Date;
}

const W = 1080;
const PAD = 72;
const ROW = 54;

// Same palette the storefront ships under its minimal theme, so the card and
// the site read as one shop rather than two unrelated products.
const INK = {
  bg: '#0b0d10',
  panel: '#12161a',
  line: '#252c34',
  text: '#eef3f7',
  muted: '#8b96a5',
  accent: '#4fd8f0',
  good: '#3ecf8e',
};

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const money = (n: number) => `${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

/**
 * Nicknames are whatever the player called themselves, and the font this card
 * draws with covers Latin letters and not much else. Anything outside that is
 * dropped so the card falls back to the UID instead of painting empty boxes.
 */
function latinOnly(v: string): string {
  const trimmed = String(v || '').trim();
  return /^[\u0020-\u024F\u2018\u2019\u201c\u201d\-_.#@$%&*+()]{1,28}$/.test(trimmed) ? trimmed : '';
}

function stamp(at: Date): string {
  const d = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function label(text: string, x: number, y: number, size: number, fill: string, weight = 400, anchor = 'start'): string {
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${esc(text)}</text>`;
}

export async function renderReceipt(card: ReceiptCard): Promise<Buffer> {
  const items = card.items.slice(0, 6);
  const top = 250;
  const h = top + items.length * ROW + 210;

  const rows = items
    .map((item, i) => {
      const y = top + 40 + i * ROW;
      return [
        label(item.qty > 1 ? `${item.name}  x${item.qty}` : item.name, PAD, y, 30, INK.text, 600),
        label(money(item.price * item.qty), W - PAD, y, 30, INK.muted, 500, 'end'),
      ].join('');
    })
    .join('');

  const picked = latinOnly(card.nickname);
  const who = picked ? `${picked}${card.level ? `  ·  lvl ${card.level}` : ''}` : card.ffId;
  const totalY = top + items.length * ROW + 46;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">
  <rect width="${W}" height="${h}" fill="${INK.bg}"/>
  <rect x="${PAD - 24}" y="150" width="${W - (PAD - 24) * 2}" height="${h - 240}" rx="26" fill="${INK.panel}" stroke="${INK.line}"/>
  <rect x="0" y="0" width="${W}" height="8" fill="${INK.accent}"/>
  ${label(card.storeName || 'NOAURA', PAD, 92, 40, INK.accent, 800)}
  ${label('TOP-UP RECEIPT', W - PAD, 92, 26, INK.muted, 600, 'end')}
  ${label('Delivered', PAD, 208, 30, INK.good, 700)}
  ${label(who, W - PAD, 208, 30, INK.text, 600, 'end')}
  ${label(`UID ${card.ffId}${card.region ? `  ·  ${card.region}` : ''}`, W - PAD, 244, 22, INK.muted, 400, 'end')}
  <line x1="${PAD - 24}" y1="${top}" x2="${W - PAD + 24}" y2="${top}" stroke="${INK.line}"/>
  ${rows}
  <line x1="${PAD - 24}" y1="${totalY - 44}" x2="${W - PAD + 24}" y2="${totalY - 44}" stroke="${INK.line}"/>
  ${label('Total paid', PAD, totalY, 28, INK.muted, 500)}
  ${label(`Rs ${money(card.total)}`, W - PAD, totalY, 40, INK.text, 800, 'end')}
  ${label(`Ref ${card.ref}  ·  ${card.method}  ·  ${stamp(card.at)}`, PAD, totalY + 66, 24, INK.muted, 400)}
</svg>`;

  return sharp(Buffer.from(svg), { density: 96 }).flatten({ background: INK.bg }).png().toBuffer();
}
