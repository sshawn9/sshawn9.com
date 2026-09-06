import { describe, expect, it } from 'vitest';
import { localeFromLanguageTag, resolvePreferredLocale } from '@sshawn9/site-domain/locales';
import {
  LOCALE_PREFERENCE_KEY,
  saveLocalePreference,
} from '../../../apps/site/src/runtime/locale-preference';
import { MemoryStorage } from '../memory-storage';

describe('locale preference', () => {
  it('resolves supported stored and browser languages with the documented priority', () => {
    expect(localeFromLanguageTag('ZH-hans')).toBe('zh');
    expect(resolvePreferredLocale('en', ['zh-CN'])).toBe('en');
    expect(resolvePreferredLocale('unsupported', ['fr-FR', 'zh-TW'])).toBe('zh');
    expect(resolvePreferredLocale(undefined, ['fr-FR'])).toBe('en');
  });

  it('stores the locale under the production preference key', () => {
    const storage = new MemoryStorage();
    expect(saveLocalePreference(storage, 'zh')).toBe(true);
    expect(storage.getItem(LOCALE_PREFERENCE_KEY)).toBe('zh');
  });
});
