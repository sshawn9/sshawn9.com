import { describe, expect, it } from 'vitest';
import {
  getAutomaticVersionComparisonMode,
  resolveVersionComparisonSelection,
  type VersionComparisonVersion,
} from '../../apps/site-v2/src/content/version-comparison';

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

describe('v2 version comparison', () => {
  it('defaults to the latest version and the first distinct alternative', () => {
    const selection = resolveVersionComparisonSelection(versions);

    expect(selection.base.number).toBe(3);
    expect(selection.comparison.number).toBe(2);
    expect(selection.orderedPair.map(({ number }) => number)).toEqual([2, 3]);
  });

  it('accepts a valid query pair and normalizes diff direction by version number', () => {
    const parameters = new URLSearchParams({ base: '1', compare: '3' });
    const selection = resolveVersionComparisonSelection(versions, parameters);

    expect(selection.base.number).toBe(1);
    expect(selection.comparison.number).toBe(3);
    expect(selection.orderedPair.map(({ number }) => number)).toEqual([1, 3]);
  });

  it('rejects an identical or unknown comparison without losing a valid base', () => {
    const identical = resolveVersionComparisonSelection(
      versions,
      new URLSearchParams({ base: '2', compare: '2' }),
    );
    const unknown = resolveVersionComparisonSelection(
      versions,
      new URLSearchParams({ base: '2', compare: '99' }),
    );

    expect(identical.base.number).toBe(2);
    expect(identical.comparison.number).toBe(3);
    expect(unknown.base.number).toBe(2);
    expect(unknown.comparison.number).toBe(3);
  });

  it('uses the actual comparison container width for the automatic layout', () => {
    expect(getAutomaticVersionComparisonMode(759.99)).toBe('unified');
    expect(getAutomaticVersionComparisonMode(760)).toBe('split');
  });
});
