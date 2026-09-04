import type { Locale } from '@sshawn9/site-domain/locales';

export const LOCALE_PREFERENCE_KEY = 'PARAGLIDE_LOCALE';

export function saveLocalePreference(storage: Storage, locale: Locale): boolean {
  try {
    storage.setItem(LOCALE_PREFERENCE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}
