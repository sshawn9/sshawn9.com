import { describe, expect, it } from 'vitest';
import { belongsToView } from '../../apps/site/src/runtime/page-navigation';

const view = {
  resourceUrl: new URL('https://sshawn9.com/en/blog/?source=archive#top'),
  queryParameters: ['tag', 'page'],
};

describe('belongsToView', () => {
  it('accepts multi-value tag and page changes owned by a blog view', () => {
    expect(
      belongsToView(
        view,
        new URL('https://sshawn9.com/en/blog/?source=archive&tag=astro&tag=git&page=2'),
      ),
    ).toBe(true);
  });

  it('rejects changes outside the view-owned query parameters and resource URL', () => {
    expect(
      belongsToView(view, new URL('https://sshawn9.com/en/blog/?source=archive&sort=recent')),
    ).toBe(false);
    expect(belongsToView(view, new URL('https://sshawn9.com/en/projects/?source=archive'))).toBe(
      false,
    );
    expect(belongsToView(view, new URL('https://sshawn9.com/zh/blog/?source=archive'))).toBe(false);
    expect(belongsToView(view, new URL('https://example.com/en/blog/?source=archive'))).toBe(false);
  });

  it('accepts a hash-only change on the same resource', () => {
    expect(
      belongsToView(view, new URL('https://sshawn9.com/en/blog/?source=archive#results')),
    ).toBe(true);
  });

  it('does not mutate either URL argument', () => {
    const resourceUrl = new URL('https://sshawn9.com/en/blog/?source=archive&tag=old&page=1#top');
    const target = new URL(
      'https://sshawn9.com/en/blog/?source=archive&tag=astro&tag=git&page=2#results',
    );
    const beforeResource = resourceUrl.href;
    const beforeTarget = target.href;

    expect(belongsToView({ resourceUrl, queryParameters: ['tag', 'page'] }, target)).toBe(true);
    expect(resourceUrl.href).toBe(beforeResource);
    expect(target.href).toBe(beforeTarget);
  });
});
