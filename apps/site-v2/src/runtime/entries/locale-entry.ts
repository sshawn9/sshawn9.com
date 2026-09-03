import { resolvePreferredLocale } from '@sshawn9/site-domain/locales';
import { LOCALE_PREFERENCE_KEY } from '../locale-preference';

let storedPreference;
try {
  storedPreference = localStorage.getItem(LOCALE_PREFERENCE_KEY);
} catch {}

const languageTags = Array.isArray(navigator.languages)
  ? navigator.languages
  : navigator.language
    ? [navigator.language]
    : [];
const locale = resolvePreferredLocale(storedPreference, languageTags);

location.replace(`/${locale}/${location.search}${location.hash}`);
