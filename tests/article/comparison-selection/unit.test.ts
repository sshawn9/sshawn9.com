import { describe, expect, it } from 'vitest';
import {
  resolveVersionComparisonSelection,
  type VersionComparisonVersion,
} from '../../../apps/site/src/content/version-comparison';

function version(number: number): VersionComparisonVersion {
  return {
    number,
    dateTime: `2026-0${number}-01T00:00:00.000Z`,
    dateLabel: `v${number} date`,
    href: `/v/${number}/`,
    sourceHref: `/data/${number}.json`,
  };
}
const versions = [version(3), version(2), version(1)];

describe('version comparison selection', () => {
  it('defaults to the latest version and the first distinct alternative', () => {
    const selection = resolveVersionComparisonSelection(versions);
    expect(selection.base.number).toBe(3);
    expect(selection.comparison.number).toBe(2);
    expect(selection.orderedPair.map(({ number }) => number)).toEqual([2, 3]);
  });

  it('accepts a valid query pair and orders the diff by version number', () => {
    const selection = resolveVersionComparisonSelection(
      versions,
      new URLSearchParams({ base: '1', compare: '3' }),
    );
    expect(selection.base.number).toBe(1);
    expect(selection.comparison.number).toBe(3);
    expect(selection.orderedPair.map(({ number }) => number)).toEqual([1, 3]);
  });

  it('replaces an identical or unknown comparison without losing a valid base', () => {
    for (const compare of ['2', '99']) {
      const selection = resolveVersionComparisonSelection(
        versions,
        new URLSearchParams({ base: '2', compare }),
      );
      expect(selection.base.number).toBe(2);
      expect(selection.comparison.number).toBe(3);
    }
  });
});
