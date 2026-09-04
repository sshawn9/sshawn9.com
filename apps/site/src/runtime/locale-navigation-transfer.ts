export const LOCALE_NAVIGATION_TRANSFER_KEY = 'site:locale-navigation-transfer';
export const LOCALE_NAVIGATION_TRANSFER_VERSION = 1;

export interface LocaleNavigationTarget {
  pathname: string;
  search: string;
  hash: string;
}

export interface LocaleNavigationPoint {
  x: number;
  y: number;
}

interface LocaleNavigationTransfer {
  version: typeof LOCALE_NAVIGATION_TRANSFER_VERSION;
  targetRouteKey: string;
  page: LocaleNavigationPoint;
}

export function localeNavigationRouteKey(target: LocaleNavigationTarget): string {
  return target.pathname + target.search + target.hash;
}

function safeCoordinate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined;
}

function decodeLocaleNavigationTransfer(value: unknown): LocaleNavigationTransfer | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const candidate = value as Record<string, unknown>;
  if (candidate.version !== LOCALE_NAVIGATION_TRANSFER_VERSION) return undefined;
  if (typeof candidate.targetRouteKey !== 'string') return undefined;
  if (!candidate.page || typeof candidate.page !== 'object') return undefined;

  const page = candidate.page as Record<string, unknown>;
  const x = safeCoordinate(page.x);
  const y = safeCoordinate(page.y);
  if (x === undefined || y === undefined) return undefined;

  return {
    version: LOCALE_NAVIGATION_TRANSFER_VERSION,
    targetRouteKey: candidate.targetRouteKey,
    page: { x, y },
  };
}

export function persistLocaleNavigationTransfer(
  storage: Storage,
  target: LocaleNavigationTarget,
  point: LocaleNavigationPoint,
): boolean {
  const x = safeCoordinate(point.x);
  const y = safeCoordinate(point.y);
  if (x === undefined || y === undefined) return false;

  try {
    storage.setItem(
      LOCALE_NAVIGATION_TRANSFER_KEY,
      JSON.stringify({
        version: LOCALE_NAVIGATION_TRANSFER_VERSION,
        targetRouteKey: localeNavigationRouteKey(target),
        page: { x, y },
      } satisfies LocaleNavigationTransfer),
    );
    return true;
  } catch {
    return false;
  }
}

/** Reads and removes the transfer atomically; every click can be applied at most once. */
export function consumeLocaleNavigationTransfer(
  storage: Storage,
  target: LocaleNavigationTarget,
): LocaleNavigationPoint | undefined {
  let serialized: string | null;
  try {
    serialized = storage.getItem(LOCALE_NAVIGATION_TRANSFER_KEY);
    storage.removeItem(LOCALE_NAVIGATION_TRANSFER_KEY);
  } catch {
    return undefined;
  }
  if (!serialized) return undefined;

  try {
    const transfer = decodeLocaleNavigationTransfer(JSON.parse(serialized));
    return transfer?.targetRouteKey === localeNavigationRouteKey(target)
      ? transfer.page
      : undefined;
  } catch {
    return undefined;
  }
}

export function discardLocaleNavigationTransfer(
  storage: Storage,
  expectedTarget?: LocaleNavigationTarget,
): void {
  try {
    if (expectedTarget) {
      const serialized = storage.getItem(LOCALE_NAVIGATION_TRANSFER_KEY);
      if (!serialized) return;

      const transfer = decodeLocaleNavigationTransfer(JSON.parse(serialized));
      if (transfer?.targetRouteKey !== localeNavigationRouteKey(expectedTarget)) return;
    }
    storage.removeItem(LOCALE_NAVIGATION_TRANSFER_KEY);
  } catch {
    try {
      storage.removeItem(LOCALE_NAVIGATION_TRANSFER_KEY);
    } catch {}
  }
}
