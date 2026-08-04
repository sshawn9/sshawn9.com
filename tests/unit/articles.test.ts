import { describe, expect, it } from 'vitest';
import { getArticleTags, resolveArticles, type BlogEntry } from '../../src/lib/articles';

type EntryOptions = {
  publishedAt?: string;
  revisedAt?: string;
  tags?: string[];
};

function entry(id: string, options: EntryOptions = {}): BlogEntry {
  return {
    id,
    collection: 'blog',
    body: `Body for ${id}`,
    data: {
      title: id,
      description: id,
      publishedAt: new Date(options.publishedAt ?? '2024-01-01T00:00:00Z'),
      revisedAt: options.revisedAt ? new Date(options.revisedAt) : undefined,
      tags: options.tags ?? [],
      draft: false,
    },
  } as BlogEntry;
}

describe('article resolution', () => {
  it('prefers an explicit requested locale and reports all available locales', () => {
    const articles = resolveArticles(
      [entry('localized/index'), entry('localized/index.en'), entry('localized/index.zh')],
      'en',
    );

    expect(articles).toHaveLength(1);
    expect(articles[0].current.entry.id).toBe('localized/index.en');
    expect(articles[0].current.availableLocales).toEqual(['en', 'zh']);
    expect(articles[0].current.hasRequestedLocale).toBe(true);
  });

  it('keeps an article visible by falling back to its available language', () => {
    const [article] = resolveArticles([entry('zh-only/index.zh')], 'en');

    expect(article.current.contentLocale).toBe('zh');
    expect(article.current.hasRequestedLocale).toBe(false);
    expect(article.current.availableLocales).toEqual(['zh']);
  });

  it('orders versions and derives tags from the latest version only', () => {
    const [article] = resolveArticles(
      [
        entry('guide/v2/index', { tags: ['Current', 'Shared', 'Current'] }),
        entry('guide/v1/index', { tags: ['Legacy', 'Shared'] }),
      ],
      'en',
    );

    expect(article.versions.map((version) => version.number)).toEqual([1, 2]);
    expect(article.current.number).toBe(2);
    expect(article.isVersioned).toBe(true);
    expect(getArticleTags(article)).toEqual(['Current', 'Shared']);
  });

  it('rejects paths outside the documented article convention', () => {
    expect(() => resolveArticles([entry('guide/v0/index')], 'en')).toThrow(
      'Version directories must be named v1, v2, …',
    );
  });

  it('sorts articles by their first publication date', () => {
    const articles = resolveArticles(
      [
        entry('older/index', { publishedAt: '2024-01-01T00:00:00Z' }),
        entry('newer/index', { publishedAt: '2025-01-01T00:00:00Z' }),
      ],
      'en',
    );

    expect(articles.map((article) => article.id)).toEqual(['newer', 'older']);
  });
});
