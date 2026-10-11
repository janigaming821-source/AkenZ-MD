import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../lib/logger.js';
export const LANGUAGES = ['en', 'si'];
const dictionaries = { en: {}, si: {} };
export function loadLocales(dir = resolve(process.cwd(), 'locales')) {
    for (const lang of LANGUAGES) {
        const file = resolve(dir, `${lang}.json`);
        if (!existsSync(file)) {
            logger.warn({ file }, 'locale file missing — falling back to English');
            continue;
        }
        try {
            dictionaries[lang] = JSON.parse(readFileSync(file, 'utf8'));
        }
        catch (error) {
            logger.error({ file, err: String(error) }, 'locale file is not valid JSON');
        }
    }
}
export function isLanguage(value) {
    return value === 'en' || value === 'si';
}
/** Sinhala script detection — used to answer in the language the user typed. */
export function detectLanguage(text) {
    return /[\u0d80-\u0dff]/.test(text) ? 'si' : null;
}
export function t(lang, key, vars = {}) {
    const template = dictionaries[lang]?.[key] ?? dictionaries.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (whole, name) => Object.hasOwn(vars, name) ? String(vars[name]) : whole);
}
export const languageName = { en: 'English', si: 'සිංහල' };
//# sourceMappingURL=index.js.map