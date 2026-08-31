/** Owns validation and merging for this candidate's per-history-entry state. */
export const LEDGER_KEY = "rearchitecturePoc";

export interface ScrollPoint {
  x: number;
  y: number;
}

export interface ScrollSnapshot {
  version: 1;
  routeKey: string;
  page: ScrollPoint;
  regions: Record<string, ScrollPoint>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function readPoint(value: unknown): ScrollPoint {
  if (!isRecord(value)) {
    return { x: 0, y: 0 };
  }

  return {
    x: finiteNumber(value.x),
    y: finiteNumber(value.y),
  };
}

export function readSnapshot(
  historyState: unknown,
  expectedRouteKey: string,
): ScrollSnapshot | undefined {
  if (!isRecord(historyState)) {
    return undefined;
  }

  const candidate = historyState[LEDGER_KEY];
  if (
    !isRecord(candidate) ||
    candidate.version !== 1 ||
    candidate.routeKey !== expectedRouteKey ||
    !isRecord(candidate.regions)
  ) {
    return undefined;
  }

  const regions = Object.fromEntries(
    Object.entries(candidate.regions).map(([key, value]) => [
      key,
      readPoint(value),
    ]),
  );

  return {
    version: 1,
    routeKey: expectedRouteKey,
    page: readPoint(candidate.page),
    regions,
  };
}

export function mergeSnapshot(
  historyState: unknown,
  snapshot: ScrollSnapshot,
): Record<string, unknown> {
  const base = isRecord(historyState) ? historyState : {};
  return {
    ...base,
    [LEDGER_KEY]: snapshot,
  };
}
