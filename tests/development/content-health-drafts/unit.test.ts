import { describe, expect, it } from 'vitest';
import { analyzeArticleEntries } from '../../../apps/site/devtools/content-health/diagnostics';
import { contentHealthEntry as entry } from '../content-health-fixture';

describe('content health draft diagnostics', () => {
  it('reports draft identity, routes, availability, and localized titles before fallback', () => {
    const report = analyzeArticleEntries([
      entry('guide/v1/index.en', 'Guide'),
      entry('guide/v1/index.zh', '指南'),
      entry('guide/v2/index.en', 'Guide revision', true),
    ]);
    expect(report.drafts).toMatchObject([
      {
        articleId: 'guide',
        version: 2,
        currentVersion: true,
        titles: { en: 'Guide revision', zh: 'Guide revision' },
        availableLocales: ['en'],
        routes: { en: '/en/blog/guide/', zh: '/zh/blog/guide/' },
      },
    ]);

    const localized = analyzeArticleEntries([
      entry('localized/index.en', 'Localized draft', true),
      entry('localized/index.zh', '本地化草稿', true),
    ]);
    expect(localized.drafts[0]?.titles).toEqual({ en: 'Localized draft', zh: '本地化草稿' });
  });
});
