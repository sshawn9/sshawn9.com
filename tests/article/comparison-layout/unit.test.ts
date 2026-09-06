import { describe, expect, it } from 'vitest';
import { getAutomaticVersionComparisonMode } from '../../../apps/site/src/content/version-comparison';

describe('version comparison automatic layout', () => {
  it('uses the actual comparison container width at the layout breakpoint', () => {
    expect(getAutomaticVersionComparisonMode(759.99)).toBe('unified');
    expect(getAutomaticVersionComparisonMode(760)).toBe('split');
  });
});
