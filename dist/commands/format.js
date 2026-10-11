export function formatUptime(ms) {
    const total = Math.floor(ms / 1000);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const parts = [];
    if (days)
        parts.push(`${days}d`);
    if (hours)
        parts.push(`${hours}h`);
    if (minutes)
        parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}
export function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function formatDateTime(date, timezone = 'Asia/Colombo') {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
}
/** Fixed-width box lines for the menu, so the frame stays aligned. */
export function box(top, lines, bottom = '╰━━━━━━━━━━━━━━━━━━╯') {
    return [top, ...lines.map((l) => (l.startsWith('┃') || l.startsWith('┣') ? l : `┃ ${l}`)), bottom].join('\n');
}
export function section(label) {
    return `┣━━〔 ${label} 〕━━`;
}
//# sourceMappingURL=format.js.map