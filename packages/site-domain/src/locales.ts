export const LOCALES = ['en', 'zh'] as const;

export type Locale = (typeof LOCALES)[number];

export const BASE_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.includes(value as Locale);
}

export function requireLocale(value: unknown): Locale {
  if (isLocale(value)) return value;
  throw new Error(`Unsupported locale: ${String(value)}`);
}

export function localeFromLanguageTag(value: unknown): Locale | undefined {
  if (typeof value !== 'string') return undefined;

  const primaryLanguage = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return LOCALES.find((locale) => locale === primaryLanguage);
}

export function resolvePreferredLocale(
  storedPreference: unknown,
  languageTags: readonly string[],
): Locale {
  const storedLocale = localeFromLanguageTag(storedPreference);
  if (storedLocale) return storedLocale;

  for (const languageTag of languageTags) {
    const locale = localeFromLanguageTag(languageTag);
    if (locale) return locale;
  }

  return BASE_LOCALE;
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'en' ? 'zh' : 'en';
}

export function toLanguageTag(locale: Locale): 'en' | 'zh-CN' {
  return locale === 'zh' ? 'zh-CN' : 'en';
}
