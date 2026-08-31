/** Owns validation and merging for this candidate's per-history-entry state. */
export const LEDGER_KEY = 'rearchitecturePoc';

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

/**
 * Self-contained decoder shared by the normal runtime and the generated
 * pre-render restore script. Keep its helpers inside the function so the
 * implementation can be serialized without hidden module dependencies.
 */
export function decodeSnapshot(
  historyState: unknown,
  expectedRouteKey: string,
  ledgerKey: string,
): ScrollSnapshot | undefined {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function finiteNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
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

  if (!isRecord(historyState)) {
    return undefined;
  }

  const candidate = historyState[ledgerKey];
  if (
    !isRecord(candidate) ||
    candidate.version !== 1 ||
    candidate.routeKey !== expectedRouteKey ||
    !isRecord(candidate.regions)
  ) {
    return undefined;
  }

  const regions = Object.fromEntries(
    Object.entries(candidate.regions).map(([key, value]) => [key, readPoint(value)]),
  );

  return {
    version: 1,
    routeKey: expectedRouteKey,
    page: readPoint(candidate.page),
    regions,
  };
}

export function readSnapshot(
  historyState: unknown,
  expectedRouteKey: string,
): ScrollSnapshot | undefined {
  return decodeSnapshot(historyState, expectedRouteKey, LEDGER_KEY);
}

export function mergeSnapshot(
  historyState: unknown,
  snapshot: ScrollSnapshot,
): Record<string, unknown> {
  const base =
    typeof historyState === 'object' && historyState !== null && !Array.isArray(historyState)
      ? historyState
      : {};
  return {
    ...base,
    [LEDGER_KEY]: snapshot,
  };
}
