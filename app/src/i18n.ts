// UI language: Korean or English, picked in settings ('auto' follows the system language).
// Strings are written in pairs where they are used, L('한국어', 'English'), so each screen keeps
// its own words; the current language is module state set from the settings.
import type { Settings } from './types';

let en = false;

export function resolveLang(pref: Settings['language'] | undefined): 'ko' | 'en' {
  if (pref === 'ko' || pref === 'en') return pref;
  return /^ko\b/i.test(navigator.language || '') ? 'ko' : 'en';
}

/** sets the language for every L() after this; true when it changed */
export function setLang(pref: Settings['language'] | undefined): boolean {
  const next = resolveLang(pref) === 'en';
  const changed = next !== en;
  en = next;
  if (typeof document !== 'undefined') document.documentElement.lang = en ? 'en' : 'ko';
  return changed;
}

export const isEn = () => en;

export function L(ko: string, enText: string): string {
  return en ? enText : ko;
}
