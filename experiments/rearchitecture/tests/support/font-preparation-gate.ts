import type { Page } from '@playwright/test';

interface FontPreparationGate {
  callCount: number;
  release(): void;
}

type GateWindow = Window &
  typeof globalThis & {
    __pocFontPreparationGate?: FontPreparationGate;
  };

/** Delays FontFaceSet.load() without changing production code or network state. */
export async function installFontPreparationGate(page: Page) {
  await page.evaluate(() => {
    const gateWindow = window as GateWindow;
    const fontSet = document.fonts;
    const originalLoad = fontSet.load.bind(fontSet);
    let releasePending = () => {};
    const pending = new Promise<void>((resolve) => {
      releasePending = resolve;
    });
    const gate: FontPreparationGate = {
      callCount: 0,
      release: releasePending,
    };
    gateWindow.__pocFontPreparationGate = gate;

    Object.defineProperty(fontSet, 'load', {
      configurable: true,
      value: async (font: string, text?: string) => {
        gate.callCount += 1;
        await pending;
        return originalLoad(font, text);
      },
    });
  });

  return {
    callCount: () =>
      page.evaluate(() => (window as GateWindow).__pocFontPreparationGate?.callCount ?? 0),
    release: () =>
      page.evaluate(() => {
        (window as GateWindow).__pocFontPreparationGate?.release();
      }),
  };
}
