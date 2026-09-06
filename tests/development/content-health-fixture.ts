import type { SiteArticleEntry } from '../../apps/site/src/content/article-source';

export function contentHealthEntry(id: string, title: string, draft = false): SiteArticleEntry {
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
