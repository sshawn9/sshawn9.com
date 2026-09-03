import {
  BASE_LOCALE,
  LOCALES,
  localeFromLanguageTag,
  resolvePreferredLocale,
  type Locale,
} from '@sshawn9/site-domain/locales';

export const LOCALE_PREFERENCE_KEY = 'PARAGLIDE_LOCALE';

export function saveLocalePreference(storage: Storage, locale: Locale): boolean {
  try {
    storage.setItem(LOCALE_PREFERENCE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs in the neutral entry document's head. The generated source deliberately
 * contains the shared resolver rather than importing a client locale runtime.
 */
export function createLocaleEntryRedirectScript(): string {
  return `(() => {
    const LOCALES = ${JSON.stringify(LOCALES)};
    const BASE_LOCALE = ${JSON.stringify(BASE_LOCALE)};
    const LOCALE_PREFERENCE_KEY = ${JSON.stringify(LOCALE_PREFERENCE_KEY)};
    ${localeFromLanguageTag.toString()}
    ${resolvePreferredLocale.toString()}

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
    location.replace('/' + locale + '/' + location.search + location.hash);
  })();`;
}

/**
 * Resolves locale for a root fallback document such as `404.html`, whose URL
 * is preserved by the asset platform and can therefore still carry a locale
 * prefix. The script runs in the head so localized variants are selected
 * before their markup is parsed and painted.
 */
export function createFallbackDocumentLocaleScript(
  titles: Readonly<Record<Locale, string>>,
): string {
  return `(() => {
    const LOCALES = ${JSON.stringify(LOCALES)};
    const BASE_LOCALE = ${JSON.stringify(BASE_LOCALE)};
    const LOCALE_PREFERENCE_KEY = ${JSON.stringify(LOCALE_PREFERENCE_KEY)};
    const TITLES = ${JSON.stringify(titles)};
    ${localeFromLanguageTag.toString()}
    ${resolvePreferredLocale.toString()}

    const routeLocale = location.pathname.match(/^\\/(en|zh)(?:\\/|$)/)?.[1];
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
    document.title = TITLES[locale];
  })();`;
}
