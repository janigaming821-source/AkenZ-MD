import { targetFromContext } from '../whatsapp/extract.js';
import { whatsapp } from '../whatsapp/client.js';
const digits = (value) => value.replace(/[^\d]/g, '');
/**
 * Resolves the user a moderation command should apply to, in this order:
 * mentioned number in the text → replied-to message sender → replied-to author
 * → the person who joined most recently is never guessed.
 */
export async function resolveTargetJid(ctx) {
    const ctxInfo = ctx.message.message?.extendedTextMessage?.contextInfo;
    const mentioned = ctxInfo?.mentionedJid?.length ? ctxInfo.mentionedJid[0] : undefined;
    if (mentioned)
        return mentioned;
    const fromArg = ctx.args.find((a) => /(\+?\d[\d\s-]{6,}\d)/.test(a)) ?? (ctx.fullArgs.match(/\+?\d[\d\s-]{6,}\d/) ?? [])[0];
    if (fromArg) {
        const num = digits(fromArg);
        if (num.length >= 8)
            return `${num}@s.whatsapp.net`;
    }
    const quotedTarget = targetFromContext(ctx.message);
    if (quotedTarget)
        return quotedTarget;
    const quotedSender = ctxInfo?.quotedMessage ? (ctxInfo.participant ?? ctxInfo.remoteJid) : undefined;
    if (quotedSender)
        return quotedSender;
    return null;
}
export function isSelfJid(jid) {
    const self = whatsapp.selfJid;
    if (!self)
        return false;
    return jid.split('@')[0] === self.split('@')[0];
}
//# sourceMappingURL=targets.js.map