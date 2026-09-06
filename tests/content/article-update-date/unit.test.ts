import { describe, expect, it } from 'vitest';
import {
  getArticleUpdatedAt,
  resolveArticles,
  type ResolvableArticleEntry,
} from '@sshawn9/site-domain/articles';

function entry(
  id: string,
  revisedAt?: string,
  sourceLastModifiedAt?: string,
): ResolvableArticleEntry {
  return {
    id,
    sourceLastModifiedAt: sourceLastModifiedAt ? new Date(sourceLastModifiedAt) : undefined,
    data: {
      publishedAt: new Date('2024-01-01T00:00:00Z'),
      revisedAt: revisedAt ? new Date(revisedAt) : undefined,
      tags: [],
      projects: [],
      draft: false,
    },
  };
}

describe('article update date', () => {
  it('uses the selected locale commit unless an authored revision date overrides it', () => {
    const [localized] = resolveArticles(
      [
        entry('localized/index.en', undefined, '2025-01-02T00:00:00Z'),
        entry('localized/index.zh', undefined, '2025-03-04T00:00:00Z'),
      ],
      'zh',
    );
    expect(getArticleUpdatedAt(localized.current)?.toISOString()).toBe('2025-03-04T00:00:00.000Z');

    const [revised] = resolveArticles(
      [entry('guide/index', '2025-02-03T00:00:00Z', '2025-03-04T00:00:00Z')],
      'en',
    );
    expect(getArticleUpdatedAt(revised.current)?.toISOString()).toBe('2025-02-03T00:00:00.000Z');
  });
});
