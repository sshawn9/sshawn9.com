import { describe, expect, it } from 'vitest';
import {
  decideBuildNavigation,
  normalizeBuildId,
} from '../../apps/site-v2/src/runtime/build-generation';

describe('v2 build generation gate', () => {
  it('allows a client swap only when the runtime and both documents agree', () => {
    expect(decideBuildNavigation('build-a', 'build-a', 'build-a')).toEqual({
      mode: 'client',
      buildId: 'build-a',
    });
  });

  it.each([
    ['build-a', 'build-a', 'build-b', 'target-runtime-mismatch'],
    ['build-a', 'build-b', 'build-b', 'current-runtime-mismatch'],
    ['build-a', 'build-a', undefined, 'invalid-target-document-id'],
    ['build-a', undefined, 'build-a', 'invalid-current-document-id'],
    [undefined, 'build-a', 'build-a', 'invalid-runtime-id'],
  ] as const)(
    'requires document navigation for an unsafe identity handshake',
    (runtime, current, target, reason) => {
      expect(decideBuildNavigation(runtime, current, target)).toEqual({
        mode: 'document',
        reason,
      });
    },
  );

  it('normalizes safe IDs and rejects malformed metadata', () => {
    expect(normalizeBuildId('  release.2026-08-29_1  ')).toBe('release.2026-08-29_1');
    expect(normalizeBuildId('release/1')).toBeUndefined();
    expect(normalizeBuildId('x'.repeat(65))).toBeUndefined();
    expect(normalizeBuildId('')).toBeUndefined();
  });
});
