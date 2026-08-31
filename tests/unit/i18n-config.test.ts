import { describe, expect, it } from 'vitest';
import projectSettings from '../../project.inlang/settings.json';
import { BASE_LOCALE, LOCALES } from '../../src/i18n/config';
import { baseLocale, locales } from '@sshawn9/site-i18n/runtime';

describe('locale configuration', () => {
  it('keeps application, Inlang, and generated Paraglide locales aligned', () => {
    expect([...LOCALES]).toEqual(projectSettings.locales);
    expect([...locales]).toEqual(projectSettings.locales);
    expect(BASE_LOCALE).toBe(projectSettings.baseLocale);
    expect(baseLocale).toBe(projectSettings.baseLocale);
  });
});
