import { describe, expect, it } from 'vitest';
import { resolveArticles, type ResolvableArticleEntry } from '@sshawn9/site-domain/articles';

describe('article path validation', () => {
  it('rejects version directories outside the documented convention', () => {
    const entry: ResolvableArticleEntry = {
      id: 'guide/v0/index',
      data: { publishedAt: new Date('2024-01-01T00:00:00Z'), tags: [], projects: [], draft: false },
    };
    expect(() => resolveArticles([entry], 'en')).toThrow(
      'Version directories must be named v1, v2, …',
    );
  });
});
