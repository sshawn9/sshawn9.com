import { describe, expect, it } from 'vitest';
import { localeFromLanguageTag, resolvePreferredLocale } from '@sshawn9/site-domain/locales';
import { getLocaleSwitchHref, replaceRouteLocale } from '../../apps/site/src/content/locale-routes';
import {
  consumeLocaleNavigationTransfer,
  LOCALE_NAVIGATION_TRANSFER_KEY,
  persistLocaleNavigationTransfer,
} from '../../apps/site/src/runtime/locale-navigation-transfer';
import {
  LOCALE_PREFERENCE_KEY,
  saveLocalePreference,
} from '../../apps/site/src/runtime/locale-preference';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('locale routing and preference', () => {
  it('resolves a supported stored preference before browser languages', () => {
    expect(localeFromLanguageTag('ZH-hans')).toBe('zh');
    expect(resolvePreferredLocale('en', ['zh-CN'])).toBe('en');
    expect(resolvePreferredLocale('unsupported', ['fr-FR', 'zh-TW'])).toBe('zh');
    expect(resolvePreferredLocale(undefined, ['fr-FR'])).toBe('en');
  });

  it('changes only the locale prefix and preserves query and fragment state', () => {
    expect(replaceRouteLocale('/en/blog/article/v/2/', 'zh')).toBe('/zh/blog/article/v/2/');
    expect(
      getLocaleSwitchHref(
        {
          pathname: '/en/blog/article/compare/',
          search: '?left=1&right=2',
          hash: '#changed-lines',
        },
        'zh',
      ),
    ).toBe('/zh/blog/article/compare/?left=1&right=2#changed-lines');
    expect(replaceRouteLocale('/', 'zh')).toBe('/zh/');
  });

  it('stores the locale under the production preference key', () => {
    const storage = new MemoryStorage();
    expect(saveLocalePreference(storage, 'zh')).toBe(true);
    expect(storage.getItem(LOCALE_PREFERENCE_KEY)).toBe('zh');
  });
});

describe('locale navigation transfer', () => {
  const target = {
    pathname: '/zh/blog/article/',
    search: '?version=2',
    hash: '#details',
  };

  it('uses the click-time point once and only for the matching target route', () => {
    const storage = new MemoryStorage();
    expect(persistLocaleNavigationTransfer(storage, target, { x: 12, y: 840 })).toBe(true);

    expect(consumeLocaleNavigationTransfer(storage, target)).toEqual({ x: 12, y: 840 });
    expect(consumeLocaleNavigationTransfer(storage, target)).toBeUndefined();
  });

  it('discards mismatched or corrupt transfer state safely', () => {
    const storage = new MemoryStorage();
    persistLocaleNavigationTransfer(storage, target, { x: 12, y: 840 });
    expect(
      consumeLocaleNavigationTransfer(storage, {
        ...target,
        pathname: '/zh/blog/another-article/',
      }),
    ).toBeUndefined();
    expect(storage.getItem(LOCALE_NAVIGATION_TRANSFER_KEY)).toBeNull();

    storage.setItem(LOCALE_NAVIGATION_TRANSFER_KEY, '{bad json');
    expect(consumeLocaleNavigationTransfer(storage, target)).toBeUndefined();
    expect(storage.getItem(LOCALE_NAVIGATION_TRANSFER_KEY)).toBeNull();
  });
});
