import { describe, expect, it } from 'vitest';
import { resolveArticles, type BlogEntry } from '../../src/lib/articles';
import { getArticlesForTag, getTagDefinitions, getTagHref, getTagSlug } from '../../src/lib/tags';

function entry(id: string, tags: string[]): BlogEntry {
  return {
    id,
    collection: 'blog',
    body: id,
    data: {
      title: id,
      description: id,
      publishedAt: new Date('2024-01-01T00:00:00Z'),
      tags,
      draft: false,
    },
  } as BlogEntry;
}

describe('tag routes', () => {
  it('creates localized, URL-safe tag links with the maintained slugger', () => {
    expect(getTagSlug('Control Systems')).toBe('control-systems');
    expect(getTagHref('Control Systems', 'zh')).toBe('/zh/tags/control-systems/');
  });

  it('counts each article once and uses only its latest version', () => {
    const articles = resolveArticles(
      [
        entry('guide/v2/index', ['Control Systems', 'Control Systems']),
        entry('guide/v1/index', ['Legacy']),
        entry('notes/index', ['Control Systems', 'Robotics']),
      ],
      'en',
    );

    expect(getTagDefinitions(articles)).toEqual([
      { name: 'Control Systems', slug: 'control-systems', count: 2 },
      { name: 'Robotics', slug: 'robotics', count: 1 },
    ]);
    expect(getArticlesForTag(articles, 'Control Systems').map((article) => article.id)).toEqual([
      'guide',
      'notes',
    ]);
  });

  it('rejects ambiguous generated slugs instead of publishing unstable routes', () => {
    const articles = resolveArticles(
      [entry('cpp/index', ['C++']), entry('csharp/index', ['C#'])],
      'en',
    );

    expect(() => getTagDefinitions(articles)).toThrow('resolve to the same slug');
  });
});
