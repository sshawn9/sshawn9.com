import { resolvePreferredLocale, type Locale } from '@sshawn9/site-domain/locales';
import { LOCALE_PREFERENCE_KEY } from '../locale-preference';

const entry = document.currentScript as HTMLScriptElement | null;
let titles: Partial<Record<Locale, string>> = {};
try {
  titles = JSON.parse(entry?.dataset.localeTitles ?? '{}') as Partial<Record<Locale, string>>;
} catch {}

const routeLocale = location.pathname.match(/^\/(en|zh)(?:\/|$)/)?.[1] as Locale | undefined;
let storedPreference;
try {
  storedPreference = localStorage.getItem(LOCALE_PREFERENCE_KEY);
} catch {}
const languageTags = Array.isArray(navigator.languages)
  ? navigator.languages
  : navigator.language
    ? [navigator.language]
    : [];
const locale = routeLocale ?? resolvePreferredLocale(storedPreference, languageTags);
const root = document.documentElement;
root.dataset.locale = locale;
root.lang = locale === 'zh' ? 'zh-CN' : 'en';
if (titles[locale]) document.title = titles[locale];
