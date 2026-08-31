import { getRelativeLocaleUrl } from 'astro:i18n';
import {
  BASE_LOCALE,
  LOCALES,
  isLocale,
  otherLocale,
  requireLocale,
  toLanguageTag,
  type Locale,
} from '@sshawn9/site-domain/locales';

export { BASE_LOCALE, LOCALES, isLocale, otherLocale, requireLocale, toLanguageTag, type Locale };

export function getLocaleStaticPaths() {
  return LOCALES.map((locale) => ({ params: { locale }, props: { locale } }));
}

export function localePath(locale: Locale, path = '/'): string {
  const normalized = path === '/' ? undefined : path.replace(/^\/+|\/+$/g, '');
  return getRelativeLocaleUrl(locale, normalized);
}

export function replacePathLocale(pathname: string, locale: Locale): string {
  const unprefixed = pathname.replace(/^\/(?:en|zh)(?=\/|$)/, '') || '/';
  return localePath(locale, unprefixed);
}
