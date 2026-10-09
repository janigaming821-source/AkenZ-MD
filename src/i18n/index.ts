import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../lib/logger.js';

export type Language = 'en' | 'si';
export const LANGUAGES: Language[] = ['en', 'si'];

type Dictionary = Record<string, string>;

const dictionaries: Record<Language, Dictionary> = { en: {}, si: {} };

export function loadLocales(dir = resolve(process.cwd(), 'locales')): void {
  for (const lang of LANGUAGES) {
    const file = resolve(dir, `${lang}.json`);
    if (!existsSync(file)) {
      logger.warn({ file }, 'locale file missing — falling back to English');
      continue;
    }
    try {
      dictionaries[lang] = JSON.parse(readFileSync(file, 'utf8')) as Dictionary;
    } catch (error) {
      logger.error({ file, err: String(error) }, 'locale file is not valid JSON');
    }
  }
}

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'si';
}

/** Sinhala script detection — used to answer in the language the user typed. */
export function detectLanguage(text: string): Language | null {
  return /[\u0d80-\u0dff]/.test(text) ? 'si' : null;
}

export function t(lang: Language, key: string, vars: Record<string, string | number> = {}): string {
  const template = dictionaries[lang]?.[key] ?? dictionaries.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : whole,
  );
}

export const languageName: Record<Language, string> = { en: 'English', si: 'සිංහල' };
