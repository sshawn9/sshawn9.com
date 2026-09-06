import { describe, expect, it } from 'vitest';
import { resolveArticles, type ResolvableArticleEntry } from '@sshawn9/site-domain/articles';

function entry(id: string): ResolvableArticleEntry {
  return {
    id,
    data: { publishedAt: new Date('2024-01-01T00:00:00Z'), tags: [], projects: [], draft: false },
  };
}

describe('article locale resolution', () => {
  it('prefers an explicit locale and otherwise keeps the article visible through fallback', () => {
    const localizedArticles = resolveArticles(
      [entry('localized/index'), entry('localized/index.en'), entry('localized/index.zh')],
      'en',
    );
    expect(localizedArticles).toHaveLength(1);
    const [localized] = localizedArticles;
    expect(localized.current.entry.id).toBe('localized/index.en');
    expect(localized.current.availableLocales).toEqual(['en', 'zh']);
    expect(localized.current.hasRequestedLocale).toBe(true);

    const [fallback] = resolveArticles([entry('zh-only/index.zh')], 'en');
    expect(fallback.current.contentLocale).toBe('zh');
    expect(fallback.current.hasRequestedLocale).toBe(false);
    expect(fallback.current.availableLocales).toEqual(['zh']);
  });
});
