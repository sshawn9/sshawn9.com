import { createThemeController } from '@sshawn9/appearance/theme';
import demoFontUrl from '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?url';
import {
  createWallpaperController,
  createDomWallpaperView,
  createIndexedDbWallpaperCache,
  prepareBrowserImage,
  downloadBrowserWallpaper,
} from '@sshawn9/appearance/wallpaper';
import './styles.css';

type Scenario =
  'normal' | 'source-failure' | 'image-failure' | 'decode-failure' | 'font-failure' | 'no-items';
type ThemePreference = 'light' | 'dark' | 'system';
type WallpaperItem = Parameters<typeof prepareBrowserImage>[0];
type EventRecord = { at: number; type: string; id?: string; detail?: unknown };
type WallpaperController = ReturnType<typeof createWallpaperController>;

const params = new URLSearchParams(location.search);
const namespace =
  (params.get('namespace') || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'default';
const themeOnly = params.get('mode') === 'theme-only';
const root = document.documentElement;
const element = <T extends HTMLElement>(id: string) => {
  const value = document.getElementById(id);
  if (!value) throw new Error('Missing demo element: ' + id);
  return value as T;
};
const catalogue: WallpaperItem[] = [
  {
    id: 'blue-hour',
    url: '/wallpapers/blue-hour.svg',
    credit: 'Blue hour · Original Appearance Lab artwork · CC0',
    creditUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    filename: 'appearance-blue-hour.svg',
  },
  {
    id: 'ochre-ridge',
    url: '/wallpapers/ochre-ridge.svg',
    credit: 'Ochre ridge · Original Appearance Lab artwork · CC0',
    creditUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    filename: 'appearance-ochre-ridge.svg',
  },
  {
    id: 'alpine-morning',
    url: '/wallpapers/alpine-morning.svg',
    credit: 'Alpine morning · Original Appearance Lab artwork · CC0',
    creditUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    filename: 'appearance-alpine-morning.svg',
  },
];
const scenarios: Scenario[] = [
  'normal',
  'source-failure',
  'image-failure',
  'decode-failure',
  'font-failure',
  'no-items',
];
const requestedScenario = params.get('scenario') as Scenario | null;
const settings = {
  scenario:
    requestedScenario && scenarios.includes(requestedScenario)
      ? requestedScenario
      : ('normal' as Scenario),
  imageDelay: Math.max(0, Math.min(30000, Number(params.get('imageDelay')) || 0)),
  fontDelay: Math.max(0, Math.min(30000, Number(params.get('fontDelay')) || 0)),
  rotationMs: Math.max(200, Math.min(60000, Number(params.get('rotationMs')) || 12000)),
};
const events: EventRecord[] = [];
let uiError: string | null = null;
let wallpaper: WallpaperController | null = null;
let fontFace: FontFace | null = null;
let fontPromise: Promise<void> | null = null;
let fontStatus: 'unloaded' | 'loading' | 'loaded' | 'failed' = 'unloaded';
let generation = 0;
let sourceCalls = 0;
let imageRequests = 0;
let downloadCalls = 0;
let commitCount = 0;
let cache = themeOnly
  ? null
  : createIndexedDbWallpaperCache({ databaseName: 'appearance-demo:v1:' + namespace });
let preferenceStorage: Storage | undefined;
try {
  preferenceStorage = window.localStorage;
} catch {
  /* Theme use remains available if persistence is blocked. */
}
const theme = createThemeController({
  root,
  storage: preferenceStorage,
  storageKey: 'appearance-demo:v1:theme:' + namespace,
  transitionMs: 220,
});
const domView = themeOnly
  ? null
  : createDomWallpaperView(element('wallpaper'), {
      transitionMs: 220,
      reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    });

function log(type: string, id?: string, detail?: unknown) {
  events.push({
    at: performance.now(),
    type,
    ...(id ? { id } : {}),
    ...(detail === undefined ? {} : { detail }),
  });
  element('event-log').textContent = events
    .slice(-90)
    .map((entry) => JSON.stringify(entry))
    .join('\n');
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function abortError() {
  return new DOMException('Demo operation aborted', 'AbortError');
}
function checkSignal(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason || abortError();
}
function delay(ms: number, signal: AbortSignal) {
  checkSignal(signal);
  if (!ms) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      reject(signal.reason || abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  checkSignal(signal);
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason || abortError());
    signal.addEventListener('abort', stop, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', stop);
        if (!signal.aborted) resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', stop);
        reject(error);
      },
    );
  });
}

// A real, independently served font file. No document.fonts.ready/check shortcut,
// data URL, timeout-to-success, or fallback-font completion path is used.
function loadTargetFont(): Promise<void> {
  if (fontPromise) return fontPromise;
  fontStatus = 'loading';
  root.dataset.demoFont = fontStatus;
  fontFace = new FontFace(
    'AppearanceDemo',
    'url(' + JSON.stringify(demoFontUrl) + ') format("woff2")',
    { display: 'block' },
  );
  const target = fontFace;
  log('font-load-start', undefined, { family: target.family, source: demoFontUrl });
  fontPromise = target
    .load()
    .then((loaded) => {
      if (loaded !== target || target.status !== 'loaded')
        throw new Error('The exact demo FontFace did not finish loading');
      document.fonts.add(target);
      fontStatus = 'loaded';
      root.dataset.demoFont = 'loaded';
      log('font-loaded', undefined, {
        family: target.family,
        status: target.status,
        registered: document.fonts.has(target),
      });
      renderState();
    })
    .catch((error: unknown) => {
      fontPromise = null;
      fontStatus = 'failed';
      root.dataset.demoFont = 'failed';
      log('font-load-failed', undefined, errorMessage(error));
      renderState();
      throw error;
    });
  return fontPromise;
}
async function fontsReady(item: WallpaperItem, signal: AbortSignal): Promise<void> {
  const scenario = settings.scenario;
  const wait = settings.fontDelay;
  log('font-gate-start', item.id, { scenario, delay: wait });
  await delay(wait, signal);
  if (scenario === 'font-failure') {
    // A genuinely failing font request, scoped to this demo. It is never added
    // to FontFaceSet and cannot replace an already committed target font.
    const broken = new FontFace(
      'AppearanceDemoFailure' + generation,
      'url("/fonts/deliberately-missing.ttf") format("truetype")',
    );
    await abortable(broken.load(), signal);
    throw new Error('The deliberately missing font unexpectedly loaded');
  }
  await abortable(loadTargetFont(), signal);
  checkSignal(signal);
  if (!fontFace || fontFace.status !== 'loaded' || !document.fonts.has(fontFace)) {
    throw new Error('The exact target FontFace is not loaded and registered');
  }
  log('font-gate-complete', item.id, { family: fontFace.family, status: fontFace.status });
}

function renderState() {
  const themeState = theme.getState();
  const state = wallpaper?.getState();
  element('theme-state').textContent = themeState.resolved + ' / ' + themeState.preference;
  element('wallpaper-state').textContent = themeOnly
    ? 'Not started (theme only)'
    : !state?.initialized
      ? 'Destroyed / not initialized'
      : state.busy
        ? 'Preparing, current retained'
        : state.enabled
          ? 'Enabled'
          : 'Disabled';
  element('scene-state').textContent = state?.currentId || 'None';
  element('font-state').textContent = fontStatus;
  element('error-state').textContent = uiError || state?.error || '';
  element<HTMLInputElement>('enabled').checked = state?.enabled ?? true;
  element<HTMLInputElement>('rotate').checked = state?.autoRotate ?? false;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme]')) {
    button.setAttribute('aria-pressed', String(button.dataset.theme === themeState.preference));
  }
  element<HTMLButtonElement>('download').disabled = !state?.currentId;
}

function makeWallpaperController() {
  if (!cache) throw new Error('Theme-only mode must not create a wallpaper cache');
  const targetView = domView;
  if (!targetView) throw new Error('Theme-only mode must not create a wallpaper view');
  return createWallpaperController({
    source: async ({ currentId, signal }) => {
      checkSignal(signal);
      sourceCalls += 1;
      log('source-start', currentId || undefined, { scenario: settings.scenario });
      if (settings.scenario === 'source-failure')
        throw new Error('Demo source rejected the request');
      if (settings.scenario === 'no-items') return null;
      const index = currentId ? catalogue.findIndex((item) => item.id === currentId) : -1;
      return catalogue[(index + 1) % catalogue.length]!;
    },
    fontsReady,
    prepareImage: async (item, signal, cachedBlob) => {
      const scenario = settings.scenario;
      log('image-prepare-start', item.id, {
        cached: !!cachedBlob,
        scenario,
        delay: settings.imageDelay,
      });
      await delay(settings.imageDelay, signal);
      checkSignal(signal);
      if (!cachedBlob || scenario === 'image-failure' || scenario === 'decode-failure')
        imageRequests += 1;
      const candidate =
        scenario === 'image-failure'
          ? { ...item, url: '/wallpapers/deliberately-missing.svg' }
          : scenario === 'decode-failure'
            ? { ...item, url: '/wallpapers/not-an-image.txt' }
            : item;
      const prepared = await prepareBrowserImage(
        candidate,
        signal,
        scenario === 'normal' ||
          scenario === 'font-failure' ||
          scenario === 'no-items' ||
          scenario === 'source-failure'
          ? cachedBlob
          : undefined,
      );
      log('image-decoded', item.id, {
        width: prepared.image?.naturalWidth,
        height: prepared.image?.naturalHeight,
      });
      return prepared;
    },
    view: {
      commit(prepared, options) {
        if (!fontFace || fontFace.status !== 'loaded' || !document.fonts.has(fontFace)) {
          throw new Error(
            'Refusing to commit an image/credit pair before its exact font is loaded',
          );
        }
        targetView.commit(prepared, options);
        commitCount += 1;
        root.dataset.demoCommitted = prepared.item.id;
        log('pair-commit', prepared.item.id, {
          animate: options.animate,
          fontStatus: fontFace.status,
          width: prepared.image?.naturalWidth,
        });
      },
      setEnabled(enabled) {
        targetView.setEnabled(enabled);
        log('view-enabled', undefined, enabled);
      },
      clear() {
        targetView.clear();
        delete root.dataset.demoCommitted;
        log('view-cleared');
      },
    },
    cache,
    download: async (prepared) => {
      downloadCalls += 1;
      log('download', prepared.item.id, {
        filename: prepared.item.filename,
        credit: prepared.item.credit,
      });
      await downloadBrowserWallpaper(prepared);
    },
    timeoutMs: 30000,
    rotationMs: settings.rotationMs,
  });
}

async function runAction(label: string, action: () => void | Promise<unknown>) {
  uiError = null;
  log('action:' + label);
  try {
    await action();
  } catch (error) {
    uiError = errorMessage(error);
    log('action-error:' + label, undefined, uiError);
  } finally {
    renderState();
  }
}
async function initialize() {
  generation += 1;
  theme.init();
  if (!themeOnly) {
    if (!wallpaper) {
      wallpaper = makeWallpaperController();
      wallpaper.subscribe((state) => {
        log('wallpaper-state', state.currentId || undefined, state);
        renderState();
      });
    }
    await wallpaper.init({ enabled: true, autoRotate: false });
  } else {
    await fontsReady(catalogue[0]!, new AbortController().signal);
  }
}
function destroy() {
  wallpaper?.destroy();
  theme.destroy();
  log('destroyed', undefined, { generation });
  renderState();
}
async function corruptCache() {
  if (!cache) throw new Error('No wallpaper cache in theme-only mode');
  // Real IndexedDB persistence via the public adapter, with an invalid image
  // blob. No knowledge of private object-store names is required.
  await cache.write(
    {
      version: 1,
      current: {
        item: catalogue[0]!,
        blob: new Blob(['This is a deliberately damaged cached image.'], { type: 'image/svg+xml' }),
      },
      next: {
        item: catalogue[1]!,
        blob: new Blob(['The next cached image is damaged too.'], { type: 'image/svg+xml' }),
      },
    },
    new AbortController().signal,
  );
  log('cache-corrupted');
}
async function clearCache() {
  if (!cache) throw new Error('No wallpaper cache in theme-only mode');
  await cache.clear(new AbortController().signal);
  log('cache-cleared');
}
function setScenario(value: Scenario) {
  if (!scenarios.includes(value)) throw new Error('Unknown demo scenario');
  settings.scenario = value;
  element<HTMLSelectElement>('scenario').value = value;
  log('scenario', undefined, value);
}
function configure(patch: { scenario?: Scenario; imageDelay?: number; fontDelay?: number }) {
  if (patch.scenario) setScenario(patch.scenario);
  if (patch.imageDelay !== undefined)
    settings.imageDelay = Math.max(0, Math.min(30000, patch.imageDelay));
  if (patch.fontDelay !== undefined)
    settings.fontDelay = Math.max(0, Math.min(30000, patch.fontDelay));
  element<HTMLInputElement>('image-delay').value = String(settings.imageDelay);
  element<HTMLInputElement>('font-delay').value = String(settings.fontDelay);
}
const harness = {
  events,
  catalogue: catalogue.map((item) => ({ ...item })),
  getState: () => ({
    theme: theme.getState(),
    wallpaper: wallpaper?.getState() || null,
    font: {
      status: fontStatus,
      faceStatus: fontFace?.status || null,
      registered: fontFace ? document.fonts.has(fontFace) : false,
      family: fontFace?.family || null,
    },
    settings: { ...settings },
    sourceCalls,
    imageRequests,
    downloadCalls,
    commitCount,
    generation,
    themeOnly,
    namespace,
  }),
  actions: {
    initialize,
    destroy,
    next: () => wallpaper?.next() || Promise.resolve(false),
    cancel: () => {
      wallpaper?.cancel();
      renderState();
    },
    setEnabled: (enabled: boolean) => wallpaper?.setEnabled(enabled) || Promise.resolve(),
    setAutoRotate: (enabled: boolean) => {
      wallpaper?.setAutoRotate(enabled);
      renderState();
    },
    download: () => wallpaper?.download() || Promise.resolve(),
    corruptCache,
    clearCache,
    configure,
    readCache: () => cache?.read(new AbortController().signal) || Promise.resolve(null),
  },
};
declare global {
  interface Window {
    __appearanceDemo: typeof harness;
  }
}
window.__appearanceDemo = harness;

element('mode-label').textContent = themeOnly ? 'THEME ONLY' : 'THEME + WALLPAPER';
element('wallpaper-controls').hidden = themeOnly;
element<HTMLSelectElement>('scenario').value = settings.scenario;
element<HTMLInputElement>('image-delay').value = String(settings.imageDelay);
element<HTMLInputElement>('font-delay').value = String(settings.fontDelay);
element<HTMLInputElement>('rotation-delay').value = String(settings.rotationMs);
element('rotation-delay').addEventListener('change', () => {
  settings.rotationMs = Math.max(
    200,
    Math.min(60000, Number(element<HTMLInputElement>('rotation-delay').value) || 12000),
  );
  // The public interval is a construction option, not a hidden production
  // mutation API. Reconstruct explicitly when changing it in the demo.
  wallpaper?.destroy();
  wallpaper = null;
  void runAction('rotation-reconfigure', initialize);
});
element('scenario').addEventListener('change', () =>
  setScenario(element<HTMLSelectElement>('scenario').value as Scenario),
);
element('image-delay').addEventListener('change', () =>
  configure({ imageDelay: Number(element<HTMLInputElement>('image-delay').value) }),
);
element('font-delay').addEventListener('change', () =>
  configure({ fontDelay: Number(element<HTMLInputElement>('font-delay').value) }),
);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-theme]')) {
  button.addEventListener('click', () => {
    theme.setPreference(button.dataset.theme as ThemePreference);
    renderState();
  });
}
element('enabled').addEventListener(
  'change',
  () =>
    void runAction('enabled', () =>
      wallpaper?.setEnabled(element<HTMLInputElement>('enabled').checked),
    ),
);
element('rotate').addEventListener('change', () => {
  wallpaper?.setAutoRotate(element<HTMLInputElement>('rotate').checked);
  renderState();
});
element('next').addEventListener('click', () => void runAction('next', () => wallpaper?.next()));
element('download').addEventListener(
  'click',
  () => void runAction('download', () => wallpaper?.download()),
);
element('cancel').addEventListener(
  'click',
  () => void runAction('cancel', () => wallpaper?.cancel()),
);
element('destroy').addEventListener('click', () => void runAction('destroy', destroy));
element('initialize').addEventListener('click', () => void runAction('initialize', initialize));
element('corrupt-cache').addEventListener(
  'click',
  () => void runAction('corrupt-cache', corruptCache),
);
element('clear-cache').addEventListener('click', () => void runAction('clear-cache', clearCache));
theme.subscribe((state) => {
  log('theme-state', undefined, state);
  renderState();
});
theme.init();
log('demo-bootstrap', undefined, { namespace, themeOnly });
if (settings.scenario !== 'font-failure') {
  void loadTargetFont().catch((error: unknown) => {
    uiError = errorMessage(error);
    renderState();
  });
}
void runAction('initialization', initialize);
window.addEventListener('pagehide', destroy, { once: true });
