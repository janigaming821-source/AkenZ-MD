import axios from 'axios';
import { config } from '../config/env.js';
const history = new Map();
export const aiIsConfigured = () => config.ai.provider !== 'none' && Boolean(config.ai.apiKey) && Boolean(config.ai.model);
function remember(chatJid, turn) {
    if (config.ai.historyLimit === 0)
        return;
    const list = history.get(chatJid) ?? [];
    list.push(turn);
    history.set(chatJid, list.slice(-config.ai.historyLimit * 2));
}
async function askGemini(question, context) {
    const contents = [
        ...context.map((t) => ({ role: t.role === 'model' ? 'model' : 'user', parts: [{ text: t.text }] })),
        { role: 'user', parts: [{ text: question }] },
    ];
    const { data } = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${config.ai.model}:generateContent`, { contents, systemInstruction: { parts: [{ text: config.ai.systemPrompt }] } }, { params: { key: config.ai.apiKey }, timeout: 45_000 });
    const text = data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? '')
        .join('')
        .trim();
    if (!text)
        throw new Error('empty response');
    return text;
}
async function askOpenAi(question, context) {
    const messages = [
        { role: 'system', content: config.ai.systemPrompt },
        ...context.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
        { role: 'user', content: question },
    ];
    const { data } = await axios.post('https://api.openai.com/v1/chat/completions', { model: config.ai.model, messages }, { headers: { Authorization: `Bearer ${config.ai.apiKey}` }, timeout: 45_000 });
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text)
        throw new Error('empty response');
    return text;
}
export async function askAi(chatJid, question) {
    if (!aiIsConfigured())
        return { ok: false, reason: 'not-configured' };
    const context = history.get(chatJid) ?? [];
    try {
        const answer = config.ai.provider === 'gemini' ? await askGemini(question, context) : await askOpenAi(question, context);
        remember(chatJid, { role: 'user', text: question });
        remember(chatJid, { role: 'model', text: answer });
        return { ok: true, data: answer.slice(0, config.ai.maxChars) };
    }
    catch (error) {
        return {
            ok: false,
            reason: 'failed',
            message: axios.isAxiosError(error)
                ? `${error.response?.status ?? 'network'} ${error.response?.data?.error?.message ?? error.message}`
                : error.message,
        };
    }
}
const WMO = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Drizzle',
    55: 'Dense drizzle',
    61: 'Light rain',
    63: 'Rain',
    65: 'Heavy rain',
    71: 'Light snow',
    73: 'Snow',
    75: 'Heavy snow',
    80: 'Rain showers',
    81: 'Rain showers',
    82: 'Violent rain showers',
    85: 'Snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with hail',
    99: 'Thunderstorm with heavy hail',
};
export async function currentWeather(city) {
    const query = city.trim();
    if (!query)
        return { ok: false, reason: 'not-found' };
    try {
        if (config.weather.provider === 'openweathermap') {
            if (!config.weather.apiKey)
                return { ok: false, reason: 'not-configured' };
            const { data } = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
                params: { q: query, units: 'metric', appid: config.weather.apiKey },
                timeout: 15_000,
            });
            return {
                ok: true,
                data: {
                    location: data.name ?? query,
                    country: data.sys?.country,
                    temperatureC: Math.round(data.main.temp),
                    feelsLikeC: Math.round(data.main.feels_like),
                    humidity: data.main.humidity,
                    windKph: Math.round(data.wind.speed * 3.6),
                    condition: String(data.weather?.[0]?.main ?? '—'),
                },
            };
        }
        // Open-Meteo: geocoding + current weather, no API key, no account.
        const geo = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
            params: { name: query, count: 1, language: 'en', format: 'json' },
            timeout: 15_000,
        });
        const place = geo.data?.results?.[0];
        if (!place)
            return { ok: false, reason: 'not-found' };
        const now = await axios.get('https://api.open-meteo.com/v1/forecast', {
            params: {
                latitude: place.latitude,
                longitude: place.longitude,
                current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code',
                timezone: 'auto',
            },
            timeout: 15_000,
        });
        const c = now.data?.current;
        if (!c)
            return { ok: false, reason: 'failed' };
        return {
            ok: true,
            data: {
                location: place.name,
                country: place.country,
                temperatureC: Math.round(c.temperature_2m),
                feelsLikeC: Math.round(c.apparent_temperature),
                humidity: c.relative_humidity_2m,
                windKph: Math.round(c.wind_speed_10m),
                condition: WMO[c.weather_code] ?? `Code ${c.weather_code}`,
            },
        };
    }
    catch (error) {
        return {
            ok: false,
            reason: axios.isAxiosError(error) && error.response?.status === 401 ? 'not-configured' : 'failed',
            message: error.message,
        };
    }
}
// ── Translator ───────────────────────────────────────────────────────────
export async function translateText(text, to) {
    if (!text.trim())
        return { ok: false, reason: 'failed' };
    try {
        if (config.translate.provider === 'deepl') {
            if (!config.translate.apiKey)
                return { ok: false, reason: 'not-configured' };
            const { data } = await axios.post('https://api-free.deepl.com/v2/translate', new URLSearchParams({ text, target_lang: to.toUpperCase() }), { headers: { Authorization: `Deepl-Auth-Key ${config.translate.apiKey}` }, timeout: 20_000 });
            const translated = data?.translations?.[0]?.text;
            return translated ? { ok: true, data: translated } : { ok: false, reason: 'failed' };
        }
        // MyMemory: free, keyless, limited anonymous quota.
        const source = /[\u0d80-\u0dff]/.test(text) ? 'si' : 'en';
        const target = to === 'si' ? 'si' : 'en';
        if (source === target)
            return { ok: true, data: text };
        const { data } = await axios.get('https://api.mymemory.translated.net/get', {
            params: { q: text.slice(0, 480), langpair: `${source}|${target}` },
            timeout: 20_000,
        });
        const translated = data?.responseData?.translatedText;
        if (!translated || /QUERY LENGTH|INVALID|MYMEMORY WARNING/i.test(translated)) {
            return { ok: false, reason: 'failed' };
        }
        return { ok: true, data: translated };
    }
    catch (error) {
        return { ok: false, reason: 'failed', message: error.message };
    }
}
// ── Short link ───────────────────────────────────────────────────────────
export async function shortenUrl(url) {
    try {
        const { data } = await axios.get('https://is.gd/create.php', {
            params: { format: 'simple', url },
            timeout: 15_000,
            responseType: 'text',
        });
        const short = String(data).trim();
        if (!short.startsWith('http'))
            return { ok: false, reason: 'failed', message: short };
        return { ok: true, data: short };
    }
    catch {
        return { ok: false, reason: 'failed' };
    }
}
// ── Wikipedia ────────────────────────────────────────────────────────────
// Wikimedia APIs 403 requests carrying default library User-Agents.
const WIKI_HEADERS = { 'User-Agent': 'NOAURA-BOT/1.0 (personal WhatsApp bot)' };
export async function wikiSummary(query) {
    const trimmed = query.trim();
    if (!trimmed)
        return { ok: false, reason: 'not-found' };
    const host = /[\u0d80-\u0dff]/.test(trimmed) ? 'si' : 'en';
    try {
        const { data } = await axios.get(`https://${host}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(trimmed)}`, { headers: WIKI_HEADERS, timeout: 15_000 });
        if (typeof data?.extract !== 'string' || !data.extract.trim()) {
            return { ok: false, reason: 'not-found' };
        }
        return {
            ok: true,
            data: {
                title: typeof data.title === 'string' && data.title ? data.title : trimmed,
                extract: data.extract.slice(0, 1200),
                url: typeof data.content_urls?.desktop?.page === 'string' ? data.content_urls.desktop.page : '',
            },
        };
    }
    catch (error) {
        return {
            ok: false,
            reason: axios.isAxiosError(error) && error.response?.status === 404 ? 'not-found' : 'failed',
            message: error.message,
        };
    }
}
// ── Dictionary ───────────────────────────────────────────────────────────
function cleanWikiMarkup(text) {
    return text
        .replace(/<a [^>]*>(.*?)<\/a>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}
export async function defineWord(word) {
    const trimmed = word.trim();
    if (!trimmed)
        return { ok: false, reason: 'not-found' };
    try {
        const { data } = await axios.get(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(trimmed)}`, { headers: WIKI_HEADERS, timeout: 15_000 });
        const entries = Array.isArray(data?.en) ? data.en : [];
        const meanings = entries
            .map((entry) => {
            const defs = Array.isArray(entry.definitions) ? entry.definitions : [];
            const definition = defs
                .map((d) => (typeof d?.definition === 'string' ? cleanWikiMarkup(d.definition) : ''))
                .find(Boolean);
            const examples = defs.flatMap((d) => (Array.isArray(d?.examples) ? d.examples : []));
            const example = examples
                .map((e) => (typeof e === 'string' ? cleanWikiMarkup(e) : ''))
                .find(Boolean);
            return {
                partOfSpeech: typeof entry.partOfSpeech === 'string' ? entry.partOfSpeech.toLowerCase() : '',
                definition: definition ?? '',
                example: example ?? '',
            };
        })
            .filter((m) => m.definition)
            .slice(0, 3);
        if (!meanings.length)
            return { ok: false, reason: 'not-found' };
        return { ok: true, data: { word: trimmed.toLowerCase(), phonetic: '', meanings } };
    }
    catch (error) {
        return {
            ok: false,
            reason: axios.isAxiosError(error) && error.response?.status === 404 ? 'not-found' : 'failed',
            message: error.message,
        };
    }
}
//# sourceMappingURL=api.js.map