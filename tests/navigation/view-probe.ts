import type { Page } from '@playwright/test';

export async function installViewNavigationProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = {
      astroEvents: [] as string[],
      outletOpacities: [] as number[],
      frames: 0,
      active: true,
      stop() {
        probe.active = false;
      },
    };
    Object.defineProperty(window, '__viewNavigationProbe', { configurable: true, value: probe });
    for (const name of [
      'astro:before-preparation',
      'astro:before-swap',
      'astro:after-swap',
      'astro:page-load',
    ]) {
      document.addEventListener(name, () => probe.astroEvents.push(name));
    }
    const sample = () => {
      if (!probe.active) return;
      const outlet = document.querySelector<HTMLElement>('.page-outlet');
      if (outlet) probe.outletOpacities.push(Number.parseFloat(getComputedStyle(outlet).opacity));
      probe.frames += 1;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

export async function viewProbe(page: Page) {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __viewNavigationProbe?: {
            astroEvents: string[];
            outletOpacities: number[];
            frames: number;
          };
        }
      ).__viewNavigationProbe,
  );
}

export async function clearViewProbeEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = (window as Window & { __viewNavigationProbe?: { astroEvents: string[] } })
      .__viewNavigationProbe;
    if (probe) probe.astroEvents.length = 0;
  });
}
