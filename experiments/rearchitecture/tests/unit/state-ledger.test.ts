import { describe, expect, it } from "vitest";
import * as astroLedger from "../../apps/astro/src/runtime/state-ledger";
import * as qwikLedger from "../../apps/qwik/src/runtime/state-ledger";

const candidates = [
  ["astro", astroLedger],
  ["qwik", qwikLedger],
] as const;

describe.each(candidates)("%s state ledger", (_name, ledger) => {
  const snapshot = {
    version: 1,
    routeKey: "/zh/blog/?page=2",
    page: { x: 12, y: 840 },
    regions: {
      "tag-rail": { x: 0, y: 310 },
    },
  } as const;

  it("preserves router-owned history fields while adding site state", () => {
    const routerState = { index: 7, scrollX: 4, privateRouterKey: "keep" };
    const merged = ledger.mergeSnapshot(routerState, snapshot);

    expect(merged).toMatchObject(routerState);
    expect(merged[ledger.LEDGER_KEY]).toEqual(snapshot);
  });

  it("restores only the matching history entry route", () => {
    const merged = ledger.mergeSnapshot({}, snapshot);

    expect(ledger.readSnapshot(merged, snapshot.routeKey)).toEqual(snapshot);
    expect(ledger.readSnapshot(merged, "/zh/blog/?page=1")).toBeUndefined();
  });

  it("rejects corrupt versions and safely normalizes invalid coordinates", () => {
    const corruptVersion = {
      [ledger.LEDGER_KEY]: { ...snapshot, version: 99 },
    };
    expect(
      ledger.readSnapshot(corruptVersion, snapshot.routeKey),
    ).toBeUndefined();

    const malformed = {
      [ledger.LEDGER_KEY]: {
        ...snapshot,
        page: { x: -5, y: Number.NaN },
        regions: { "tag-rail": { x: "bad", y: 42 } },
      },
    };
    expect(ledger.readSnapshot(malformed, snapshot.routeKey)).toEqual({
      ...snapshot,
      page: { x: 0, y: 0 },
      regions: { "tag-rail": { x: 0, y: 42 } },
    });
  });

  it("uses a safe empty base when browser history state is unavailable", () => {
    expect(ledger.mergeSnapshot(null, snapshot)).toEqual({
      [ledger.LEDGER_KEY]: snapshot,
    });
  });
});
