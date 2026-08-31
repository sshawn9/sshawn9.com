import { LOCALES, type Locale } from '@sshawn9/site-domain/locales';

const LOCALE_PREFIX = new RegExp(`^/(?:${LOCALES.join('|')})(?=/|$)`);

export interface RouteLocation {
  pathname: string;
  search: string;
  hash: string;
}

/** Changes only the locale segment while preserving the logical route identity. */
export function replaceRouteLocale(pathname: string, targetLocale: Locale): string {
  const absolutePathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (LOCALE_PREFIX.test(absolutePathname)) {
    return absolutePathname.replace(LOCALE_PREFIX, `/${targetLocale}`);
  }

  return absolutePathname === '/' ? `/${targetLocale}/` : `/${targetLocale}${absolutePathname}`;
}

export function getLocaleSwitchHref(location: RouteLocation, targetLocale: Locale): string {
  return `${replaceRouteLocale(location.pathname, targetLocale)}${location.search}${location.hash}`;
}
