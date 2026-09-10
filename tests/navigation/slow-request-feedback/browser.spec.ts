import { expect, test } from '@playwright/test';
import { installFontFrameProbe, readFontFrames } from '../../fonts/font-probe';

const articlePath = '/en/blog/git-operations-reference/';

test('slow same-build navigation delays persistent progress without replacing the old page', async ({
  page,
}) => {
  let releaseResponse = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await installFontFrameProbe(page);
  await page.route(`**${articlePath}`, async (route) => {
    if (route.request().resourceType() !== 'fetch') {
      await route.continue();
      return;
    }
    await responseGate;
    await route.continue().catch(() => undefined);
  });
  try {
    await page.goto('/en/blog/');
    await page.evaluate(() => {
      document.querySelector<HTMLAnchorElement>(
        'a[href="/en/blog/git-operations-reference/"]',
      )!.dataset.astroPrefetch = 'false';
      document.querySelector<HTMLElement>('[data-wallpaper-visual]')!.dataset.identityProbe =
        'original';
    });

    const click = page.getByRole('link', { name: 'Git Operations Reference' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('[data-blog-listing]')).toBeVisible();
    await expect(page.locator('[data-font-surface].page-outlet')).toHaveCSS('opacity', '1');
    await expect(page.locator('html')).toHaveAttribute('data-navigation-progress', 'active');
    await expect(page.locator('.navigation-progress')).toHaveCSS('opacity', '1');
    await expect
      .poll(
        async () =>
          (await readFontFrames(page)).filter(
            (frame) => frame.navigationPending && frame.progressPhase === 'active',
          ).length,
      )
      .toBeGreaterThanOrEqual(3);

    const frames = await readFontFrames(page);
    const firstActive = frames.findIndex(
      (frame) => frame.navigationPending && frame.progressPhase === 'active',
    );
    expect(firstActive).toBeGreaterThanOrEqual(0);
    const shownPendingFrames = frames.slice(firstActive);
    for (const frame of shownPendingFrames) {
      expect(frame.navigationPending, JSON.stringify(frame)).toBe(true);
      expect(frame.progressPhase, JSON.stringify(frame)).toBe('active');
      expect(frame.visible, JSON.stringify(frame)).toBe(true);
      expect(frame.progressPresent, JSON.stringify(frame)).toBe(true);
      expect(frame.progressOpacity, JSON.stringify(frame)).toBeGreaterThan(0.99);
      expect(frame.progressAnimationEnabled, JSON.stringify(frame)).toBe(true);
    }
    expect(
      await page.evaluate(() =>
        document.getAnimations().some((animation) => {
          const effect = animation.effect as
            (KeyframeEffect & { pseudoElement?: string | null }) | null;
          return effect?.pseudoElement?.includes('page-outlet') ?? false;
        }),
      ),
    ).toBe(false);

    releaseResponse();
    await click;
    await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
    await expect(page.locator('[data-wallpaper-visual]')).toHaveAttribute(
      'data-identity-probe',
      'original',
    );
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending', '');
    await expect(page.locator('main')).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation-progress', /.+/);
    await expect(page.locator('.navigation-progress')).toHaveCSS('opacity', '0');
  } finally {
    releaseResponse();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('a fast prepared navigation does not show delayed progress during its outgoing fade', async ({
  page,
}) => {
  await page.goto('/en/blog/', { waitUntil: 'networkidle' });
  const pausedAt = Date.now();
  await page.clock.install({ time: pausedAt });
  await page.clock.pauseAt(pausedAt + 1_000);
  await expect(page.locator('.navigation-progress')).toHaveCSS('opacity', '0');

  await page.evaluate(() => {
    const nativeAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<typeof nativeAnimate>) {
      const animation = nativeAnimate.apply(this, args);
      if (this instanceof HTMLElement && this.matches('.page-outlet[data-page-outlet-leaving]')) {
        animation.pause();
        Object.defineProperty(window, '__pausedOutgoingAnimation', {
          configurable: true,
          value: animation,
        });
      }
      return animation;
    };
    document.querySelector<HTMLAnchorElement>('a[href="/en/about/"]')!.dataset.astroPrefetch =
      'false';
  });

  await page
    .locator('a[href="/en/about/"]')
    .first()
    .evaluate((link) => (link as HTMLAnchorElement).click());

  try {
    await expect(page.locator('.page-outlet')).toHaveAttribute('data-page-outlet-leaving', '');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __pausedOutgoingAnimation?: Animation;
              }
            ).__pausedOutgoingAnimation?.playState,
        ),
      )
      .toBe('paused');

    await page.clock.runFor(500);
    await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation-progress', /.+/);
    await expect(page.locator('.navigation-progress')).toHaveCSS('opacity', '0');
  } finally {
    await page.evaluate(() => {
      const animation = (
        window as Window & {
          __pausedOutgoingAnimation?: Animation;
        }
      ).__pausedOutgoingAnimation;
      if (animation?.playState === 'paused') animation.finish();
    });
    await page.clock.resume();
  }

  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(page.locator('.about-page')).toBeVisible();
});
