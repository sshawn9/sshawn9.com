export const VERSION_COMPARISON_SPLIT_MIN_WIDTH = 760;

export type VersionComparisonMode = 'unified' | 'split';

export type VersionComparisonVersion = {
  number: number;
  dateTime: string;
  dateLabel: string;
  href: string;
  sourceHref: string;
};

export type VersionComparisonLabels = {
  eyebrow: string;
  displayMode: string;
  unified: string;
  split: string;
  compareHeading: string;
  chooseOther: string;
  baseLabelTemplate: string;
  removed: string;
  added: string;
  noChanges: string;
  loading: string;
  error: string;
  staticFallback: string;
};

export type VersionComparisonSelection = {
  base: VersionComparisonVersion;
  comparison: VersionComparisonVersion;
  orderedPair: [VersionComparisonVersion, VersionComparisonVersion];
};

type SearchParameters = Pick<URLSearchParams, 'get'>;

function requestedVersion(
  parameters: SearchParameters | undefined,
  name: string,
  versions: readonly VersionComparisonVersion[],
): VersionComparisonVersion | undefined {
  const number = Number.parseInt(parameters?.get(name) ?? '', 10);
  return versions.find((version) => version.number === number);
}

export function resolveVersionComparisonSelection(
  versions: readonly VersionComparisonVersion[],
  parameters?: SearchParameters,
): VersionComparisonSelection {
  const latest = versions[0];
  if (!latest || versions.length < 2) {
    throw new Error('Version comparison requires at least two published versions.');
  }

  const base = requestedVersion(parameters, 'base', versions) ?? latest;
  const requestedComparison = requestedVersion(parameters, 'compare', versions);
  const comparison =
    requestedComparison && requestedComparison.number !== base.number
      ? requestedComparison
      : versions.find((version) => version.number !== base.number);

  if (!comparison) {
    throw new Error('Version comparison requires two distinct published versions.');
  }

  const orderedPair = [base, comparison].toSorted((left, right) => left.number - right.number) as [
    VersionComparisonVersion,
    VersionComparisonVersion,
  ];
  return { base, comparison, orderedPair };
}

export function getAutomaticVersionComparisonMode(containerWidth: number): VersionComparisonMode {
  return containerWidth >= VERSION_COMPARISON_SPLIT_MIN_WIDTH ? 'split' : 'unified';
}
