import { prisma } from '../db/client.js';
import { logError, logInfo } from '../db/botLog.js';
import { allClients, whatsapp } from '../whatsapp/client.js';
import { stopExpiredInstances } from '../whatsapp/instances.js';
import { runInInstance } from '../lib/scope.js';
const TICK_MS = 20_000;
const MAX_ATTEMPTS = 3;
let timer = null;
async function runDueTasks() {
    if (!whatsapp.isConnected)
        return;
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
        }
        catch (error) {
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
async function tick() {
    await stopExpiredInstances();
    for (const client of allClients()) {
        if (client.isConnected)
            await runInInstance(client.instance, runDueTasks);
    }
}
export function startScheduler() {
    if (timer)
        return;
    timer = setInterval(() => {
        void tick().catch((error) => logError('scheduler', 'Scheduler tick failed', { detail: String(error) }));
    }, TICK_MS);
    timer.unref();
}
export function stopScheduler() {
    if (timer)
        clearInterval(timer);
    timer = null;
}
//# sourceMappingURL=index.js.map