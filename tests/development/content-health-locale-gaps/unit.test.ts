import { describe, expect, it } from 'vitest';
import { analyzeArticleEntries } from '../../../apps/site/devtools/content-health/diagnostics';
import { contentHealthEntry as entry } from '../content-health-fixture';

describe('content health locale gaps', () => {
  it('reports current locale gaps before fallback hides them', () => {
    const report = analyzeArticleEntries([
      entry('guide/v1/index.en', 'Guide'),
      entry('guide/v1/index.zh', '指南'),
      entry('guide/v2/index.en', 'Guide revision', true),
      entry('zh-only/index.zh', '仅中文文章'),
    ]);
    expect(report.languageGaps).toMatchObject([
      { articleId: 'guide', version: 2, missingLocales: ['zh'] },
      { articleId: 'zh-only', version: 1, missingLocales: ['en'] },
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
        routes: { en: '/en/blog/versioned/v/1/', zh: '/zh/blog/versioned/v/1/' },
      },
    ]);
  });
});
