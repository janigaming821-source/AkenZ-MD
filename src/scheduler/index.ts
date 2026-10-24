import { prisma } from '../db/client.js';
import { logError, logInfo } from '../db/botLog.js';
import { allClients, whatsapp } from '../whatsapp/client.js';
import { stopExpiredInstances } from '../whatsapp/instances.js';
import { OWNER_INSTANCE, runInInstance } from '../lib/scope.js';
import { claimAlerts, reportAlert, topupReady, type SiteAlert } from '../lib/topup.js';
import { validatePublicUrl } from '../tools/url.js';
import type { WAMessage } from 'baileys';

const TICK_MS = 20_000;
const MAX_ATTEMPTS = 3;
const CLAIM_COOLDOWN_MS = 60_000;
const MEDIA_MAX_BYTES = 8 * 1024 * 1024;

let timer: NodeJS.Timeout | null = null;
let claimBlockedUntil = 0;

async function runDueTasks(): Promise<void> {
  if (!whatsapp.isConnected) return;
  const due = await prisma.scheduledTask.findMany({
    where: { status: 'pending', runAt: { lte: new Date() } },
    take: 20,
    orderBy: { runAt: 'asc' },
  });

  for (const task of due) {
    try {
      await whatsapp.sendText(task.chatJid, `⏰ ${task.message}`);
      await prisma.scheduledTask.update({ where: { id: task.id }, data: { status: 'done', attempts: { increment: 1 } } });
      await logInfo('scheduler', 'Scheduled message delivered');
    } catch (error) {
      const attempts = task.attempts + 1;
      await prisma.scheduledTask.update({
        where: { id: task.id },
        data: {
          attempts,
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          // Back off instead of hammering a chat that is refusing messages.
          runAt: new Date(Date.now() + attempts * 60_000),
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      await logError('scheduler', 'Scheduled message failed', { attempt: attempts });
    }
  }
}

/**
 * Order alerts are pulled, never pushed: the storefront queues them and the
 * owner's bot collects the due ones each tick. A buyer's instance is never in
 * this loop, so a rented bot can't send on the shop's behalf.
 *
 * Reporting a send is what releases it. If that report never arrives — the
 * process died mid-message — the storefront's lease expires and the same alert
 * is handed back on a later tick, so a crash costs a retry, not the message.
 */
async function drainSiteAlerts(): Promise<void> {
  if (!topupReady() || !whatsapp.isConnected || Date.now() < claimBlockedUntil) return;

  let jobs: SiteAlert[];
  try {
    jobs = await claimAlerts(3);
  } catch (error) {
    // A site that is mid-deploy or offline is routine, not an emergency.
    claimBlockedUntil = Date.now() + CLAIM_COOLDOWN_MS;
    await logError('scheduler', 'Could not collect order alerts', { detail: String(error) });
    return;
  }

  for (const job of jobs) {
    let messageId = '';
    let failure = '';
    try {
      const jid = `${job.to}@s.whatsapp.net`;
      const quoted = job.quote_id
        ? ({ key: { id: job.quote_id, remoteJid: jid, fromMe: true } } as unknown as WAMessage)
        : undefined;
      const image = job.media_url ? await fetchAlertMedia(job.media_url) : null;
      const sent = image
        ? await whatsapp.sendMessage(jid, { image, ...(job.text ? { caption: job.text } : {}) }, { quoted })
        : await whatsapp.sendText(jid, job.text || '🔔 Order alert.', { quoted });
      messageId = sent?.key?.id ?? '';
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    // Reported separately: a failed *report* after a successful send must not
    // be logged as a failed send, and a send that never happened still has to
    // go back on the queue with its retry budget spent.
    try {
      await reportAlert(job.id, !failure, messageId, failure);
      if (failure) await logError('scheduler', `Order alert failed: ${job.ref}`, { detail: failure });
      else await logInfo('scheduler', `Order alert delivered: ${job.ref}`);
    } catch (error) {
      await logError('scheduler', `Could not report alert ${job.ref}`, { detail: String(error) });
    }
  }
}

/** A receipt that cannot be fetched must still deliver the words that go with it. */
async function fetchAlertMedia(raw: string): Promise<Buffer | null> {
  const validated = await validatePublicUrl(raw);
  if (!validated.ok) return null;
  try {
    const res = await fetch(validated.url.toString(), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.byteLength > 0 && bytes.byteLength <= MEDIA_MAX_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

async function tick(): Promise<void> {
  await stopExpiredInstances();
  for (const client of allClients()) {
    if (!client.isConnected) continue;
    await runInInstance(client.instance, runDueTasks);
    if (client.instance === OWNER_INSTANCE) await runInInstance(client.instance, drainSiteAlerts);
  }
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick().catch((error) => logError('scheduler', 'Scheduler tick failed', { detail: String(error) }));
  }, TICK_MS);
  timer.unref();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
