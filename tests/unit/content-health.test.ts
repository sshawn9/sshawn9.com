import { describe, expect, it } from 'vitest';
import { analyzeArticleEntries } from '../../apps/site/devtools/content-health/diagnostics';
import type { SiteArticleEntry } from '../../apps/site/src/content/article-source';

function entry(id: string, title: string, draft = false): SiteArticleEntry {
  return {
    id,
    collection: 'blog',
    data: {
      title,
      description: title,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      tags: [],
      projects: [],
      draft,
    },
  } as SiteArticleEntry;
}

describe('content health diagnostics', () => {
  it('reports drafts and locale gaps before locale fallback hides them', () => {
    const report = analyzeArticleEntries([
      entry('guide/v1/index.en', 'Guide'),
      entry('guide/v1/index.zh', '指南'),
      entry('guide/v2/index.en', 'Guide revision', true),
      entry('zh-only/index.zh', '仅中文文章'),
    ]);

    expect(report.drafts).toMatchObject([
      {
        articleId: 'guide',
        version: 2,
        currentVersion: true,
        titles: {
          en: 'Guide revision',
          zh: 'Guide revision',
        },
        availableLocales: ['en'],
        routes: {
          en: '/en/blog/guide/',
          zh: '/zh/blog/guide/',
        },
      },
    ]);
    expect(report.languageGaps).toMatchObject([
      {
        articleId: 'guide',
        version: 2,
        missingLocales: ['zh'],
      },
      {
        articleId: 'zh-only',
        version: 1,
        missingLocales: ['en'],
      },
    ]);
  });

  it('links historical gaps to their immutable version route', () => {
    const report = analyzeArticleEntries([
      entry('versioned/v1/index.en', 'English only v1'),
      entry('versioned/v2/index.en', 'Current'),
      entry('versioned/v2/index.zh', '当前版本'),
    ]);

    expect(report.languageGaps).toMatchObject([
      {
        articleId: 'versioned',
        version: 1,
        currentVersion: false,
        routes: {
          en: '/en/blog/versioned/v/1/',
          zh: '/zh/blog/versioned/v/1/',
        },
      },
    ]);
  });

  it('preserves localized titles for the toolbar UI', () => {
    const report = analyzeArticleEntries([
      entry('localized/index.en', 'Localized draft', true),
      entry('localized/index.zh', '本地化草稿', true),
    ]);

    expect(report.drafts[0]?.titles).toEqual({
      en: 'Localized draft',
      zh: '本地化草稿',
    });
  });
});
