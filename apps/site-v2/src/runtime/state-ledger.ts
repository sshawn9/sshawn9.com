export const SITE_HISTORY_KEY = 'sshawn9';
export const SITE_HISTORY_VERSION = 1;

const MAX_SCROLL_OFFSET = 2_147_483_647;
const MAX_REGION_KEY_LENGTH = 128;

export type ScrollPoint = {
  x: number;
  y: number;
};

export type ScrollSnapshot = {
  version: typeof SITE_HISTORY_VERSION;
  routeKey: string;
  page: ScrollPoint;
  regions: Record<string, ScrollPoint>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(MAX_SCROLL_OFFSET, Math.max(0, value));
}

function decodePoint(value: unknown): ScrollPoint {
  if (!isRecord(value)) return { x: 0, y: 0 };
  return { x: normalizeOffset(value.x), y: normalizeOffset(value.y) };
}

export function decodeScrollSnapshot(
  historyState: unknown,
  expectedRouteKey: string,
): ScrollSnapshot | undefined {
  if (!isRecord(historyState)) return undefined;

  const candidate = historyState[SITE_HISTORY_KEY];
  if (
    !isRecord(candidate) ||
    candidate.version !== SITE_HISTORY_VERSION ||
    candidate.routeKey !== expectedRouteKey ||
    !isRecord(candidate.regions)
  ) {
    return undefined;
  }

  const regions: Record<string, ScrollPoint> = {};
  for (const [key, value] of Object.entries(candidate.regions)) {
    if (key.length === 0 || key.length > MAX_REGION_KEY_LENGTH) continue;
    regions[key] = decodePoint(value);
  }

  return {
    version: SITE_HISTORY_VERSION,
    routeKey: expectedRouteKey,
    page: decodePoint(candidate.page),
    regions,
  };
}

/** Preserves Astro and browser-owned history fields while updating our namespace. */
export function mergeScrollSnapshot(
  historyState: unknown,
  snapshot: ScrollSnapshot,
): Record<string, unknown> {
  const base = isRecord(historyState) ? historyState : {};
  return { ...base, [SITE_HISTORY_KEY]: snapshot };
}

/** Serializes the exact decoder used by the parser-executed first-frame entry. */
export function createScrollSnapshotDecoderSource(): string {
  return [
    `const SITE_HISTORY_KEY = ${JSON.stringify(SITE_HISTORY_KEY)};`,
    `const SITE_HISTORY_VERSION = ${SITE_HISTORY_VERSION};`,
    `const MAX_SCROLL_OFFSET = ${MAX_SCROLL_OFFSET};`,
    `const MAX_REGION_KEY_LENGTH = ${MAX_REGION_KEY_LENGTH};`,
    isRecord.toString(),
    normalizeOffset.toString(),
    decodePoint.toString(),
    decodeScrollSnapshot.toString(),
  ].join('\n');
}
