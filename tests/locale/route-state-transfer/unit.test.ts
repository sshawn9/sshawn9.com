import { describe, expect, it } from 'vitest';
import {
  getLocaleSwitchHref,
  replaceRouteLocale,
} from '../../../apps/site/src/content/locale-routes';
import {
  consumeLocaleNavigationTransfer,
  LOCALE_NAVIGATION_TRANSFER_KEY,
  persistLocaleNavigationTransfer,
} from '../../../apps/site/src/runtime/locale-navigation-transfer';
import { MemoryStorage } from '../memory-storage';

const target = { pathname: '/zh/blog/article/', search: '?version=2', hash: '#details' };

describe('locale route state transfer', () => {
  it('changes only the locale prefix while preserving query and fragment state', () => {
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

  it('consumes the click-time point once and only for the matching target route', () => {
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
