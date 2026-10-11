import { pino } from 'pino';
import { config } from '../config/env.js';
// Anything that must never reach a log line, whichever key name it uses.
const REDACTED = [
    'SESSION_ENCRYPTION_KEY',
    'sessionEncryptionKey',
    'COOKIE_SECRET',
    'cookieSecret',
    'DASHBOARD_PASSWORD',
    'dashboardPassword',
    'AI_API_KEY',
    'WEATHER_API_KEY',
    'TRANSLATE_API_KEY',
    'apiKey',
    'password',
    'creds',
    'creds.*',
    '*.creds',
    'sessions',
    'appState',
    'signalKey',
];
export const logger = pino({
    level: config.logLevel,
    redact: { paths: REDACTED, censor: '[redacted]' },
    base: { name: 'noaura' },
    timestamp: pino.stdTimeFunctions.isoTime,
});
//# sourceMappingURL=logger.js.map