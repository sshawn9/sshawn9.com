import { describe, expect, it } from 'vitest';
import { getTagSlug } from '@sshawn9/site-domain/tags';

describe('tag slug generation', () => {
  it('creates URL-safe tag slugs with the maintained slugger', () => {
    expect(getTagSlug('Control Systems')).toBe('control-systems');
  });
});
