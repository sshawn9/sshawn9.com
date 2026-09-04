import { describe, expect, it } from 'vitest';
import { developmentFontAssets } from '../../apps/site/config/development-font-assets.mjs';

describe('development font assets', () => {
  it('gives dependency fonts a versioned identity and caches only identified font URLs', () => {
    const [versionUrls, cacheResponses] = developmentFontAssets();
    const originalUrl =
      '/@fs/repo/node_modules/@fontsource-variable/noto-sans-sc/files/noto-sans-sc-chinese-simplified-400-normal.woff2';
    const transformed = versionUrls.transform?.(
      `@font-face { src: url("${originalUrl}"); }`,
      '/repo/node_modules/@fontsource-variable/noto-sans-sc/wght.css',
    );
    const code = typeof transformed === 'object' && transformed ? transformed.code : transformed;
    const versionedUrl = code?.match(/url\("([^"]+)"\)/)?.[1];

    expect(versionedUrl).toMatch(`${originalUrl}?v=`);

    let middleware:
      | ((
          request: { url?: string },
          response: { setHeader(name: string, value: string): unknown },
          next: () => void,
        ) => void)
      | undefined;
    cacheResponses.configureServer?.({
      middlewares: {
        use(value: Exclude<typeof middleware, undefined>) {
          middleware = value;
        },
      },
    });

    const headers = new Map<string, string>();
    const response = {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
        return this;
      },
    };
    middleware?.({ url: versionedUrl }, response, () => undefined);
    response.setHeader('Cache-Control', 'no-cache');

    expect(headers.get('cache-control')).toBe('public, max-age=31536000, immutable');

    const ordinaryHeaders = new Map<string, string>();
    const ordinaryResponse = {
      setHeader(name: string, value: string) {
        ordinaryHeaders.set(name.toLowerCase(), value);
        return this;
      },
    };
    middleware?.({ url: originalUrl }, ordinaryResponse, () => undefined);
    ordinaryResponse.setHeader('Cache-Control', 'no-cache');

    expect(ordinaryHeaders.get('cache-control')).toBe('no-cache');
  });
});
