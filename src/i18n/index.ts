import english from './en.json';

export type Language = 'zh-CN' | 'en';
export const LANGUAGE_KEY = 'walletUiLanguage';
const cacheKey = 'plabs-ui-language';
const catalog: Record<string, string> = english;
const reverse = new Map(Object.entries(catalog).map(([zh, en]) => [en, zh]));
const valid = (value: unknown): value is Language =>
  value === 'zh-CN' || value === 'en';
const listeners = new Set<() => void>();
let language: Language = 'zh-CN';
let revision = 0;
let initialized: Promise<void> | undefined;
try {
  const cached = localStorage.getItem(cacheKey);
  if (valid(cached)) language = cached;
} catch {
  /* Storage may be disabled in previews. */
}
export const getLanguage = () => language;
export const dateLocale = () => (language === 'en' ? 'en-US' : 'zh-CN');
export const subscribeLanguage = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function applyLanguage(value: Language) {
  language = value;
  revision++;
  if (typeof document !== 'undefined') document.documentElement.lang = value;
  try {
    localStorage.setItem(cacheKey, value);
  } catch {
    /* Chrome storage remains authoritative. */
  }
  listeners.forEach((listener) => listener());
}
export function initializeLanguage() {
  if (initialized) return initialized;
  initialized = (async () => {
    const initialRevision = revision;
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
      try {
        const stored = (await chrome.storage.local.get(LANGUAGE_KEY))[
          LANGUAGE_KEY
        ];
        if (initialRevision === revision)
          applyLanguage(valid(stored) ? stored : 'zh-CN');
      } catch {
        /* Keep the cached preference, or Chinese on first use. */
      }
      chrome.storage.onChanged?.addListener((changes, area) => {
        if (area === 'local' && LANGUAGE_KEY in changes) {
          const next = changes[LANGUAGE_KEY].newValue;
          applyLanguage(valid(next) ? next : 'zh-CN');
        }
      });
    }
    if (typeof document !== 'undefined')
      document.documentElement.lang = language;
  })();
  return initialized;
}
export async function setLanguage(next: Language) {
  if (!valid(next)) throw new Error('Unsupported language');
  if (next === language) return;
  const previous = language;
  applyLanguage(next);
  const changeRevision = revision;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.set)
      await chrome.storage.local.set({ [LANGUAGE_KEY]: next });
  } catch (cause) {
    if (revision === changeRevision) applyLanguage(previous);
    throw cause;
  }
}
function pattern(source: string) {
  const parameters: number[] = [];
  const parts = source.split(/(\{\d+\})/g).map((part) => {
    const match = part.match(/^\{(\d+)\}$/);
    if (match) {
      parameters.push(Number(match[1]));
      return '([\\s\\S]*?)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return { regex: new RegExp('^' + parts.join('') + '$'), parameters };
}
const patterns = Object.entries(catalog)
  .filter(
    ([source]) => /\{\d+\}/.test(source) && /\p{Script=Han}/u.test(source),
  )
  .map(([zh, en]) => ({
    zh,
    en,
    zhPattern: pattern(zh),
    enPattern: pattern(en),
  }));
function interpolate(text: string, values: readonly unknown[]) {
  return text.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : match,
  );
}
/** Localize wallet copy only. Account names, addresses, symbols and signed payloads stay untouched. */
export function t(source: unknown, values: readonly unknown[] = []): string {
  if (typeof source !== 'string')
    return source === null || source === undefined ? '' : String(source);
  const direct = language === 'en' ? catalog[source] : reverse.get(source);
  if (direct !== undefined) return interpolate(direct, values);
  const key = source.trim();
  const exact = language === 'en' ? catalog[key] : reverse.get(key);
  if (exact !== undefined) {
    return (
      source.slice(0, source.length - source.trimStart().length) +
      interpolate(exact, values) +
      source.slice(source.trimEnd().length)
    );
  }
  if (
    !values.length &&
    (language === 'en'
      ? /\p{Script=Han}/u.test(source)
      : !/\p{Script=Han}/u.test(source))
  ) {
    for (const item of patterns) {
      const compiled = language === 'en' ? item.zhPattern : item.enPattern;
      const match = compiled.regex.exec(source);
      if (!match) continue;
      const captured: string[] = [];
      compiled.parameters.forEach((parameter, index) => {
        captured[parameter] = match[index + 1];
      });
      return interpolate(language === 'en' ? item.en : item.zh, captured);
    }
  }
  return interpolate(source, values);
}
