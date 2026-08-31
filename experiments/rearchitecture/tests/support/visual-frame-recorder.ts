import type { Page, TestInfo } from '@playwright/test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const STORAGE_KEY = 'poc:test:visual-frame-recording';
const MAX_PRESENTED_FRAMES = 240;
const FILMSTRIP_FRAME_COUNT = 24;

interface FrameRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface VisualDomFrame {
  articleCount: number;
  articleDisplay: string | null;
  bodyBackground: string | null;
  bodyColor: string | null;
  bodyExists: boolean;
  bodyFontFamily: string | null;
  bodyOpacity: number | null;
  bodyVisible: boolean;
  buildId: string | null;
  cumulativeLayoutShift: number;
  documentFrame: number;
  documentId: number;
  documentReadyState: DocumentReadyState;
  fontStatus: FontFaceSetLoadStatus | 'unsupported';
  headingRect: FrameRect | null;
  headingText: string | null;
  initialFrameReadyCount: number;
  mainCount: number;
  mainRect: FrameRect | null;
  navigationProgressActive: boolean;
  pageScrollX: number;
  pageScrollY: number;
  pageBackground: string;
  pageKind: string | null;
  pathname: string;
  rootTheme: string | null;
  rootWallpaper: string | null;
  sequence: number;
  shellCount: number;
  shellRect: FrameRect | null;
  siteBackgroundCount: number;
  siteBackgroundDisplay: string | null;
  siteBackgroundOpacity: number | null;
  articleTocScrollY: number | null;
  tagRailScrollY: number | null;
  stylesheetHrefs: string[];
  timestamp: number;
  viewportHeight: number;
  viewportWidth: number;
  blogCount: number;
  blogDisplay: string | null;
}

interface VisualProbeState {
  active: boolean;
  frames: VisualDomFrame[];
  nextDocumentId: number;
  version: 1;
}

interface PresentedFrame {
  data: Buffer;
  timestamp: number;
  viewportHeight: number;
  viewportWidth: number;
}

export interface VisualEvidence {
  domFrames: VisualDomFrame[];
  presentedFrameCount: number;
  presentedFrameTimestamps: number[];
}

type VisualProbeWindow = Window &
  typeof globalThis & {
    __pocStartVisualFrameProbe?: () => void;
    __pocStopVisualFrameProbe?: () => void;
  };

/**
 * Installs a test-only sampler before the first document is parsed. The init
 * script is re-run by Playwright for every real document navigation, so one
 * recording can span a deployment-boundary reload without production hooks.
 */
export async function installVisualFrameProbe(page: Page) {
  await page.addInitScript(
    ({ storageKey }) => {
      interface StoredFrameRect {
        height: number;
        width: number;
        x: number;
        y: number;
      }

      interface StoredProbeState {
        active: boolean;
        frames: unknown[];
        nextDocumentId: number;
        version: 1;
      }

      type ProbeWindow = Window &
        typeof globalThis & {
          __pocStartVisualFrameProbe?: () => void;
          __pocStopVisualFrameProbe?: () => void;
        };

      const probeWindow = window as ProbeWindow;
      let animationFrame = 0;
      let cumulativeLayoutShift = 0;
      let documentFrame = 0;
      let documentId: number | null = null;

      const readState = (): StoredProbeState | null => {
        try {
          const value = sessionStorage.getItem(storageKey);
          if (!value) {
            return null;
          }
          const state = JSON.parse(value) as Partial<StoredProbeState>;
          if (
            state.version !== 1 ||
            typeof state.active !== 'boolean' ||
            !Array.isArray(state.frames) ||
            typeof state.nextDocumentId !== 'number'
          ) {
            return null;
          }
          return state as StoredProbeState;
        } catch {
          return null;
        }
      };

      const writeState = (state: StoredProbeState) => {
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(state));
        } catch {
          // Evidence collection must never alter the behavior under test.
        }
      };

      const rectFor = (selector: string): StoredFrameRect | null => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return {
          height: Number(rect.height.toFixed(3)),
          width: Number(rect.width.toFixed(3)),
          x: Number(rect.x.toFixed(3)),
          y: Number(rect.y.toFixed(3)),
        };
      };

      const displayFor = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        return element ? getComputedStyle(element).display : null;
      };

      const capture = () => {
        const state = readState();
        if (!state?.active || documentId === null) {
          return false;
        }

        const root = document.documentElement;
        const body = document.body;
        const rootStyle = getComputedStyle(root);
        const bodyStyle = body ? getComputedStyle(body) : null;
        const background = document.querySelector<HTMLElement>('.site-background');
        const backgroundStyle = background ? getComputedStyle(background) : null;
        const main = document.querySelector<HTMLElement>('main.page-frame');
        const bodyOpacity = bodyStyle ? Number(bodyStyle.opacity) : null;
        const bodyVisible = Boolean(
          bodyStyle &&
          bodyStyle.display !== 'none' &&
          bodyStyle.visibility !== 'hidden' &&
          bodyOpacity !== null &&
          bodyOpacity > 0,
        );

        state.frames.push({
          articleCount: document.querySelectorAll('[data-article-page]').length,
          articleDisplay: displayFor('[data-article-page]'),
          blogCount: document.querySelectorAll('[data-blog-page]').length,
          blogDisplay: displayFor('[data-blog-page]'),
          bodyBackground: bodyStyle?.backgroundColor ?? null,
          bodyColor: bodyStyle?.color ?? null,
          bodyExists: Boolean(body),
          bodyFontFamily: bodyStyle?.fontFamily ?? null,
          bodyOpacity,
          bodyVisible,
          buildId:
            document.querySelector<HTMLMetaElement>('meta[name="poc-build-id"]')?.content ?? null,
          cumulativeLayoutShift: Number(cumulativeLayoutShift.toFixed(6)),
          documentFrame,
          documentId,
          documentReadyState: document.readyState,
          fontStatus: 'fonts' in document ? document.fonts.status : 'unsupported',
          headingRect: rectFor('main.page-frame h1'),
          headingText: main?.querySelector('h1')?.textContent?.trim() ?? null,
          initialFrameReadyCount: document.querySelectorAll('#initial-frame-ready').length,
          mainCount: document.querySelectorAll('main.page-frame').length,
          mainRect: rectFor('main.page-frame'),
          navigationProgressActive:
            document
              .querySelector<HTMLElement>('[data-navigation-progress]')
              ?.getAttribute('data-active') === 'true',
          pageBackground: rootStyle.getPropertyValue('--page-bg').trim(),
          pageKind: main?.dataset.pageKind ?? null,
          pageScrollX: Number(scrollX.toFixed(3)),
          pageScrollY: Number(scrollY.toFixed(3)),
          pathname: location.pathname,
          rootTheme: root.dataset.theme ?? null,
          rootWallpaper: root.dataset.wallpaper ?? null,
          sequence: state.frames.length,
          shellCount: document.querySelectorAll('[data-site-shell]').length,
          shellRect: rectFor('[data-site-shell]'),
          siteBackgroundCount: document.querySelectorAll('.site-background').length,
          siteBackgroundDisplay: backgroundStyle?.display ?? null,
          siteBackgroundOpacity: backgroundStyle ? Number(backgroundStyle.opacity) : null,
          articleTocScrollY:
            document.querySelector<HTMLElement>('[data-scroll-region="article-toc"]')?.scrollTop ??
            null,
          tagRailScrollY:
            document.querySelector<HTMLElement>('[data-scroll-region="tag-rail"]')?.scrollTop ??
            null,
          stylesheetHrefs: Array.from(document.styleSheets, (sheet) => sheet.href ?? 'inline'),
          timestamp: Number(performance.now().toFixed(3)),
          viewportHeight: innerHeight,
          viewportWidth: innerWidth,
        });
        documentFrame += 1;
        writeState(state);
        return true;
      };

      const sample = () => {
        if (!capture()) {
          animationFrame = 0;
          return;
        }
        animationFrame = requestAnimationFrame(sample);
      };

      const stop = () => {
        if (animationFrame !== 0) {
          cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }
      };

      const start = () => {
        if (documentId !== null || animationFrame !== 0) {
          return;
        }
        const state = readState();
        if (!state?.active) {
          return;
        }
        documentId = state.nextDocumentId;
        state.nextDocumentId += 1;
        writeState(state);
        animationFrame = requestAnimationFrame(sample);
      };

      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const layoutShift = entry as PerformanceEntry & {
              hadRecentInput?: boolean;
              value?: number;
            };
            if (!layoutShift.hadRecentInput) {
              cumulativeLayoutShift += layoutShift.value ?? 0;
            }
          }
        });
        observer.observe({ buffered: true, type: 'layout-shift' });
      } catch {
        // LayoutShift is diagnostic evidence; frame capture remains authoritative.
      }

      probeWindow.__pocStartVisualFrameProbe = start;
      probeWindow.__pocStopVisualFrameProbe = stop;
      addEventListener(
        'pagehide',
        () => {
          capture();
          stop();
        },
        { once: true },
      );

      if (readState()?.active) {
        start();
      }
    },
    { storageKey: STORAGE_KEY },
  );
}

/** Records one user journey and attaches video, a filmstrip, and raw DOM frames. */
export async function recordVisualJourney(
  page: Page,
  testInfo: TestInfo,
  name: string,
  journey: () => Promise<void>,
): Promise<VisualEvidence> {
  const safeName = name.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const videoPath = testInfo.outputPath(safeName + '.webm');
  const retainedPresentedFrames: PresentedFrame[] = [];
  const presentedFrameTimestamps: number[] = [];
  let journeyError: unknown;
  let screencastStarted = false;

  await page.screencast.start({
    onFrame: (frame) => {
      presentedFrameTimestamps.push(frame.timestamp);
      const retained = { ...frame, data: Buffer.from(frame.data) };
      if (retainedPresentedFrames.length < MAX_PRESENTED_FRAMES) {
        retainedPresentedFrames.push(retained);
      } else {
        retainedPresentedFrames[MAX_PRESENTED_FRAMES - 1] = retained;
      }
    },
    path: videoPath,
    quality: 72,
    size: { height: 800, width: 1280 },
  });
  screencastStarted = true;

  await page.evaluate((storageKey) => {
    const state: VisualProbeState = {
      active: true,
      frames: [],
      nextDocumentId: 0,
      version: 1,
    };
    sessionStorage.setItem(storageKey, JSON.stringify(state));
    (window as VisualProbeWindow).__pocStartVisualFrameProbe?.();
  }, STORAGE_KEY);

  await waitForAnimationFrames(page, 3);

  try {
    await journey();
    await waitForAnimationFrames(page, 5);
  } catch (error) {
    journeyError = error;
  }

  let domFrames: VisualDomFrame[] = [];
  try {
    domFrames = await page.evaluate((storageKey) => {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) {
        return [];
      }
      const state = JSON.parse(raw) as VisualProbeState;
      state.active = false;
      sessionStorage.setItem(storageKey, JSON.stringify(state));
      (window as VisualProbeWindow).__pocStopVisualFrameProbe?.();
      return state.frames;
    }, STORAGE_KEY);
  } finally {
    if (screencastStarted) {
      await page.screencast.stop();
    }
  }

  const evidence: VisualEvidence = {
    domFrames,
    presentedFrameCount: presentedFrameTimestamps.length,
    presentedFrameTimestamps,
  };

  await attachEvidence(testInfo, safeName, evidence, retainedPresentedFrames, videoPath);

  if (journeyError) {
    throw journeyError;
  }
  return evidence;
}

async function waitForAnimationFrames(page: Page, count: number) {
  await page.evaluate(
    (frameCount) =>
      new Promise<void>((resolve) => {
        let remaining = frameCount;
        const next = () => {
          remaining -= 1;
          if (remaining <= 0) {
            resolve();
          } else {
            requestAnimationFrame(next);
          }
        };
        requestAnimationFrame(next);
      }),
    count,
  );
}

async function attachEvidence(
  testInfo: TestInfo,
  name: string,
  evidence: VisualEvidence,
  presentedFrames: PresentedFrame[],
  videoPath: string,
) {
  if (existsSync(videoPath)) {
    await testInfo.attach(name + '-video', {
      contentType: 'video/webm',
      path: videoPath,
    });
  }

  const domFramesPath = testInfo.outputPath(name + '.dom-frames.json');
  await writeFile(domFramesPath, JSON.stringify(evidence, null, 2));
  await testInfo.attach(name + '-dom-frames', {
    contentType: 'application/json',
    path: domFramesPath,
  });

  if (presentedFrames.length === 0) {
    return;
  }

  const filmstripPath = testInfo.outputPath(name + '.filmstrip.html');
  await writeFile(filmstripPath, renderFilmstrip(name, presentedFrames));
  await testInfo.attach(name + '-filmstrip', {
    contentType: 'text/html',
    path: filmstripPath,
  });
}

function renderFilmstrip(name: string, frames: PresentedFrame[]) {
  const selected = selectEvenly(frames, FILMSTRIP_FRAME_COUNT);
  const firstTimestamp = frames[0]?.timestamp ?? 0;
  const figures = selected
    .map(({ frame, index }) => {
      const elapsedMilliseconds = Math.round((frame.timestamp - firstTimestamp) * 1_000);
      return `<figure><img src="data:image/jpeg;base64,${frame.data.toString('base64')}" alt="Frame ${index}" /><figcaption>#${index} · ${elapsedMilliseconds} ms · ${frame.viewportWidth}×${frame.viewportHeight}</figcaption></figure>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width" />
  <title>${escapeHtml(name)} filmstrip</title>
  <style>
    body { margin: 1rem; color: #e7ecee; background: #10171a; font: 14px/1.4 system-ui, sans-serif; }
    h1 { font-size: 1.1rem; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem; }
    figure { margin: 0; padding: .5rem; border: 1px solid #47555b; border-radius: .5rem; background: #172126; }
    img { display: block; width: 100%; height: auto; background: #000; }
    figcaption { margin-top: .4rem; color: #b7c2c7; }
  </style>
</head>
<body><h1>${escapeHtml(name)} · ${frames.length} retained presented frames</h1><main>${figures}</main></body>
</html>`;
}

function selectEvenly<T>(values: T[], maximum: number) {
  if (values.length <= maximum) {
    return values.map((frame, index) => ({ frame, index }));
  }

  const selectedIndexes = new Set<number>();
  for (let position = 0; position < maximum; position += 1) {
    selectedIndexes.add(Math.round((position * (values.length - 1)) / (maximum - 1)));
  }
  return Array.from(selectedIndexes, (index) => ({ frame: values[index], index }));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}
