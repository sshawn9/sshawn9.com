import { getRelativeLocaleUrl } from 'astro:i18n';

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

export function getLocaleStaticPaths() {
  return LOCALES.map((locale) => ({ params: { locale }, props: { locale } }));
}

export function toLanguageTag(locale: Locale): 'en' | 'zh-CN' {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

export function localePath(locale: Locale, path = '/'): string {
  const normalized = path === '/' ? undefined : path.replace(/^\/+|\/+$/g, '');
  return getRelativeLocaleUrl(locale, normalized);
}

export function replacePathLocale(pathname: string, locale: Locale): string {
  const unprefixed = pathname.replace(/^\/(?:en|zh)(?=\/|$)/, '') || '/';
  return localePath(locale, unprefixed);
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'en' ? 'zh' : 'en';
}
