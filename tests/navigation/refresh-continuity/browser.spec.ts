import { expect, test, type Page } from '@playwright/test';

type DocumentFrame = {
  documentId: string;
  visible: boolean;
  fonts: { family: string; ready: boolean }[];
};

const cases = [
  { name: 'Chinese blog', path: '/zh/blog/', scrollY: 0, chinese: true },
  {
    name: 'deep code article',
    path: '/en/blog/git-operations-reference/',
    scrollY: 3_200,
    chinese: false,
  },
];

async function installDocumentProbe(
  page: Page,
  chinese: boolean,
  frames: DocumentFrame[],
): Promise<void> {
  await page.exposeBinding('__recordRefreshFrame', (_source, frame: DocumentFrame) => {
    frames.push(frame);
  });
  await page.addInitScript(
    ({ chinese }) => {
      localStorage.setItem('theme', 'light');
      localStorage.setItem('wallpaper-enabled', 'false');
      const documentId = crypto.randomUUID();
      let sampled = 0;
      const record = (
        window as unknown as Window & {
          __recordRefreshFrame(frame: DocumentFrame): Promise<void>;
        }
      ).__recordRefreshFrame;
      const sample = () => {
        const main = document.querySelector<HTMLElement>('main');
        if (main) {
          const style = getComputedStyle(main);
          const box = main.getBoundingClientRect();
          let opacity = 1;
          for (let element: HTMLElement | null = main; element; element = element.parentElement) {
            opacity *= Number.parseFloat(getComputedStyle(element).opacity);
          }
          const fonts: DocumentFrame['fonts'] = [];
          for (const selector of ['main', 'main h1', '.article-prose pre code']) {
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) continue;
            const font = getComputedStyle(element);
            const family = font.fontFamily
              .split(',')[0]!
              .trim()
              .replace(/^['"]|['"]$/g, '');
            const declared = Array.from(document.fonts).some(
              (face) =>
                face.family.replace(/^['"]|['"]$/g, '') === family && face.status === 'loaded',
            );
            fonts.push({
              family,
              ready:
                declared &&
                document.fonts.check(
                  `${font.fontStyle} ${font.fontWeight} 16px ${JSON.stringify(family)}`,
                  element.textContent ?? '',
                ),
            });
          }
          if (chinese) {
            const text = [...(main.textContent ?? '')]
              .filter((char) => /\p{Script=Han}/u.test(char))
              .join('');
            if (text) {
              fonts.push({
                family: 'Noto Sans SC Variable',
                ready:
                  Array.from(document.fonts).some(
                    (face) =>
                      face.family.replace(/^['"]|['"]$/g, '') === 'Noto Sans SC Variable' &&
                      face.status === 'loaded',
                  ) && document.fonts.check('400 16px "Noto Sans SC Variable"', text),
              });
            }
          }
          void record({
            documentId,
            visible:
              style.display !== 'none' &&
              style.visibility === 'visible' &&
              opacity > 0.99 &&
              box.width > 0 &&
              box.height > 0,
            fonts,
          }).catch(() => undefined);
          sampled += 1;
        }
        if (sampled < 30) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    },
    { chinese },
  );
}

// Decode in an independent document: neither navigation nor FontFaceSet.ready
// may delay capture, and an image library is unnecessary for this pixel check.
async function contentEdges(page: Page, pngs: string[]): Promise<number[]> {
  return page.evaluate(async (pngs) => {
    const counts: number[] = [];
    for (const png of pngs) {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
      let count = 0;
      // Exclude the header/progress line and sidebars. Smooth background
      // gradients do not have the local contrast of readable body text.
      for (let y = Math.floor(height * 0.2); y < height * 0.85; y++) {
        for (let x = Math.floor(width * 0.35); x < width * 0.85; x++) {
          const index = (y * width + x) * 4;
          if (
            Math.max(
              Math.abs(data[index]! - data[index + 4]!),
              Math.abs(data[index + 1]! - data[index + 5]!),
              Math.abs(data[index + 2]! - data[index + 6]!),
            ) > 32
          )
            count++;
        }
      }
      counts.push(count);
    }
    return counts;
  }, pngs);
}

test.use({ viewport: { width: 1280, height: 900 } });

for (const scenario of cases) {
  for (const { ignoreCache, failFonts } of [
    { ignoreCache: false, failFonts: false },
    { ignoreCache: true, failFonts: false },
    { ignoreCache: false, failFonts: true },
    { ignoreCache: true, failFonts: true },
  ]) {
    test(`${scenario.name} stays readable in correct fonts through rapid ${ignoreCache ? 'hard' : 'ordinary'} reloads${failFonts ? ' with font failures and retries' : ''}`, async ({
      page,
      browserName,
      context,
    }, testInfo) => {
      test.skip(browserName !== 'chromium', 'Cross-document compositor capture uses Chromium CDP.');
      test.setTimeout(60_000);
      const documentFrames: DocumentFrame[] = [];
      await installDocumentProbe(page, scenario.chinese, documentFrames);
      await page.goto(scenario.path, { waitUntil: 'networkidle' });
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');
      if (scenario.scrollY) {
        await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), scenario.scrollY);
        await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scenario.scrollY, 0);
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (history.state as { sshawn9?: { page?: { y?: number } } } | null)?.sshawn9?.page?.y,
            ),
          )
          .toBe(scenario.scrollY);
      }
      await expect.poll(() => documentFrames.length).toBeGreaterThanOrEqual(8);
      // Establish a real, fully typeset reference without discarding any earlier
      // samples: an incorrect initial frame remains a failure below.
      await expect
        .poll(() => {
          const frame = documentFrames.at(-1);
          return Boolean(
            frame?.visible &&
            frame.fonts.every((font) => font.ready) &&
            frame.fonts.some((font) =>
              scenario.chinese
                ? font.family === 'Noto Sans SC Variable'
                : /JetBrains Mono/.test(font.family),
            ),
          );
        })
        .toBe(true);

      let delayedFonts = 0;
      let delayedThisDocument = false;
      let failedFonts = 0;
      const fontAttempts = new Map<string, number>();
      if (ignoreCache || failFonts) {
        page.on('request', (request) => {
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            delayedThisDocument = false;
            fontAttempts.clear();
          }
        });
        // Routing disables HTTP cache, so only the hard-reload scenario uses it.
        // Delay one font file per document; delaying every font would multiply the
        // fixture's latency by the number of required unicode-range fragments.
        await page.route(/\.(?:woff2?|ttf)(?:\?|$)/, async (route) => {
          if (failFonts) {
            const path = new URL(route.request().url()).pathname;
            const attempts = (fontAttempts.get(path) ?? 0) + 1;
            fontAttempts.set(path, attempts);
            if (attempts <= 2) {
              failedFonts++;
              await route.abort('failed');
              return;
            }
          }
          if (ignoreCache && !delayedThisDocument) {
            delayedThisDocument = true;
            delayedFonts++;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          await route.continue().catch(() => undefined);
        });
      }

      const session = await context.newCDPSession(page);
      let successfulReloads = 0;
      let transientReloadRetries = 0;
      const reload = async (): Promise<void> => {
        const deadline = Date.now() + 500;
        for (;;) {
          try {
            await session.send('Page.reload', { ignoreCache });
            successfulReloads++;
            return;
          } catch (error) {
            // A renderer replacement can briefly leave CDP without an active
            // page. Retry only that transport window, never a failed reload.
            if (
              !(error instanceof Error) ||
              !error.message.includes('Not attached to an active page') ||
              Date.now() >= deadline
            )
              throw error;
            transientReloadRetries++;
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
      };
      const compositorFrames: string[] = [];
      session.on('Page.screencastFrame', (frame) => {
        compositorFrames.push(frame.data);
        void session
          .send('Page.screencastFrameAck', { sessionId: frame.sessionId })
          .catch(() => undefined);
      });
      let baseline: string;
      try {
        // CDP capture does not wait for fonts, unlike Playwright screenshots.
        baseline = (await session.send('Page.captureScreenshot', { format: 'png' })).data;
        await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
        await expect.poll(() => compositorFrames.length).toBeGreaterThan(0);
        for (let completed = 0; completed < 2; completed++) {
          const loaded = page.waitForEvent('load');
          await reload();
          await loaded;
          await expect(page.locator('main')).toBeVisible();
          await page.waitForTimeout(150);
        }
        for (let refresh = 0; refresh < 8; refresh++) {
          await reload();
          await page.waitForTimeout(80);
        }
        const loaded = page.waitForEvent('load');
        await reload();
        await loaded;
        await expect(page.locator('main')).toBeVisible();
        await page.waitForTimeout(200);
        await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scenario.scrollY, 0);
      } finally {
        await session.send('Page.stopScreencast');
        await session.detach();
        await page.unrouteAll({ behavior: 'wait' });
      }

      await testInfo.attach('reload-requests', {
        body: JSON.stringify({ successfulReloads, transientReloadRetries, failedFonts }),
        contentType: 'application/json',
      });
      expect(successfulReloads).toBe(11);
      expect(new Set(documentFrames.map((frame) => frame.documentId)).size).toBeGreaterThanOrEqual(
        4,
      );
      expect(compositorFrames.length).toBeGreaterThanOrEqual(4);
      if (ignoreCache) expect(delayedFonts).toBeGreaterThanOrEqual(3);
      if (failFonts) expect(failedFonts).toBeGreaterThan(0);
      const invalidDocumentFrames = documentFrames.filter(
        (frame) =>
          !frame.visible || frame.fonts.length === 0 || frame.fonts.some((font) => !font.ready),
      );
      await testInfo.attach('document-font-frames', {
        body: JSON.stringify(documentFrames),
        contentType: 'application/json',
      });

      const decoder = await context.newPage();
      let edges: number[];
      try {
        edges = await contentEdges(decoder, [baseline!, ...compositorFrames]);
      } finally {
        await decoder.close();
      }
      expect(edges[0], 'The stable reference must contain readable body text.').toBeGreaterThan(
        1_000,
      );
      const minimumEdges = Math.max(100, edges[0]! * 0.1);
      const blank = edges.slice(1).findIndex((count) => count < minimumEdges);
      if (blank >= 0) {
        for (
          let index = Math.max(0, blank - 1);
          index <= Math.min(blank + 1, compositorFrames.length - 1);
          index++
        ) {
          await testInfo.attach(`compositor-frame-${index}`, {
            body: Buffer.from(compositorFrames[index]!, 'base64'),
            contentType: 'image/png',
          });
        }
      }
      expect(
        blank,
        `Body contrast disappeared: reference=${edges[0]}, frames=${edges.slice(1).join(',')}`,
      ).toBe(-1);
      expect(invalidDocumentFrames, JSON.stringify(invalidDocumentFrames)).toEqual([]);
    });
  }
}
