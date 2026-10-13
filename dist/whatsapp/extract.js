import { downloadMediaMessage } from 'baileys';
import { logger } from '../lib/logger.js';
/** Message bodies live under different keys depending on type and edition. */
export function getText(message) {
    const m = message.message;
    if (!m)
        return '';
    const body = m.extendedTextMessage?.text ??
        m.conversation ??
        m.imageMessage?.caption ??
        m.videoMessage?.caption ??
        m.documentMessage?.caption ??
        m.buttonsResponseMessage?.selectedDisplayText ??
        m.listResponseMessage?.title ??
        m.templateButtonReplyMessage?.selectedDisplayText ??
        '';
    return String(body).trim();
}
export function getMediaType(message) {
    const m = message.message;
    if (!m)
        return null;
    if (m.imageMessage)
        return 'image';
    if (m.videoMessage)
        return 'video';
    if (m.audioMessage)
        return 'audio';
    if (m.stickerMessage)
        return 'sticker';
    if (m.documentMessage)
        return 'document';
    return null;
}
/** Text of the message this one quotes, if any. */
export function getQuotedText(message) {
    const quoted = quotedContent(message);
    if (!quoted)
        return '';
    return getText({ ...message, message: quoted });
}
export function quotedMessageId(message) {
    return message.message?.extendedTextMessage?.contextInfo?.stanzaId ?? undefined;
}
export async function downloadMedia(sock, message) {
    const buffer = await downloadMediaMessage(message, 'buffer', {}, {
        logger,
        // WhatsApp expires old media; the paired phone can re-upload it on request.
        reuploadRequest: async (target) => (await sock.updateMediaMessage(target)),
    });
    if (!buffer || buffer.length === 0)
        throw new Error('Media was not available');
    return buffer;
}
/**
 * The message whose *media* should be downloaded: the command message itself
 * (caption on an image/video) or, when it quotes one, the quoted message.
 * The key is kept so Baileys can still decrypt the attachment.
 */
export function mediaSourceMessage(message) {
    const own = getMediaType(message);
    if (own)
        return message;
    const quoted = quotedContent(message);
    if (!quoted)
        return null;
    const wrapped = { ...message, message: quoted };
    return getMediaType(wrapped) ? wrapped : null;
}
/** When a message is quoted, the sender of that message is the likely target. */
export function targetFromContext(message) {
    return message.message?.extendedTextMessage?.contextInfo?.participant ?? undefined;
}
/** Quoted payload, whichever wrapper the message arrived in. */
function quotedContent(message) {
    const m = message.message;
    return (m?.extendedTextMessage?.contextInfo?.quotedMessage ??
        m?.viewOnceMessage?.message?.extendedTextMessage?.contextInfo?.quotedMessage ??
        m?.viewOnceMessageV2?.message?.extendedTextMessage?.contextInfo?.quotedMessage ??
        null);
}
//# sourceMappingURL=extract.js.map