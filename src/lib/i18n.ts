import { useSyncExternalStore } from 'react';
import chinese from '@/locales/zh-CN.json';

export type Language = 'en' | 'zh-CN';
export const LANGUAGE_STORAGE_KEY = 'chessblox.language';
const dictionary: Record<string, string> = chinese;
const listeners = new Set<() => void>();
function savedLanguage(): Language {
  try { return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'zh-CN' ? 'zh-CN' : 'en'; }
  catch { return 'en'; }
}
let language: Language = savedLanguage();
function updateDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.title = language === 'zh-CN' ? 'ChessBlox · 方块国际象棋竞技场' : 'ChessBlox — Make your move';
}
updateDocument();
export function getLanguage(): Language { return language; }
export function setLanguage(next: Language) {
  if (next !== 'en' && next !== 'zh-CN') return;
  language = next;
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Browsing without storage remains supported. */ }
  updateDocument();
  listeners.forEach(listener => listener());
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== LANGUAGE_STORAGE_KEY && event.key !== null) return;
  language = savedLanguage(); updateDocument(); listeners.forEach(listener => listener());
});
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useLanguage() { return useSyncExternalStore(subscribe, () => language, () => 'en' as Language); }
const normalized = new Map(Object.entries(dictionary).map(([key, value]) => [key.toLowerCase(), value]));
const templates = Object.entries(dictionary).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => ({
  pattern: new RegExp('^' + key.split(/(\{\d+\})/).map(part => /^\{\d+\}$/.test(part) ? '(.+?)' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$', 'i'), value,
}));
/** Translate application copy only; input values, wallet identifiers and game data stay unchanged. */
export function translateText(text: string, locale: Language = language): string {
  if (locale === 'en' || !text.trim()) return text;
  const key = text.trim().replace(/\s+/g, ' ');
  let translated = dictionary[key] ?? normalized.get(key.toLowerCase());
  if (translated === undefined) {
    for (const template of templates) { const match = key.match(template.pattern); if (match) { translated = template.value.replace(/\{(\d+)\}/g, (_, i) => match[Number(i) + 1] ?? ''); break; } }
  }
  if (translated === undefined) return text;
  return (text.match(/^\s*/)?.[0] ?? '') + translated + (text.match(/\s*$/)?.[0] ?? '');
}
/** Localize rendered text without changing React elements or non-text values. */
export function localize<T>(value: T): T {
  if (typeof value === 'string') return translateText(value) as T;
  if (Array.isArray(value)) return value.map(item => localize(item)) as T;
  return value;
}
