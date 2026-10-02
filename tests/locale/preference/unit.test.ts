import { describe, expect, it } from 'vitest';
import { localeFromLanguageTag, resolvePreferredLocale } from '@sshawn9/site-domain/locales';

describe('locale preference', () => {
  it('resolves supported stored and browser languages with the documented priority', () => {
    expect(localeFromLanguageTag('ZH-hans')).toBe('zh');
    expect(resolvePreferredLocale('en', ['zh-CN'])).toBe('en');
    expect(resolvePreferredLocale('unsupported', ['fr-FR', 'zh-TW'])).toBe('zh');
    expect(resolvePreferredLocale(undefined, ['fr-FR'])).toBe('en');
  });
});
