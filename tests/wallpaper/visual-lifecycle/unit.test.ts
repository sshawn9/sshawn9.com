import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { WallpaperView } from '../../../apps/site/src/features/appearance/wallpaper/view';
import type { WallpaperAsset } from '../../../apps/site/src/features/appearance/wallpaper/model';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const asset = (id: string) =>
  ({
    dataUrl: `data:image/png;base64,${id}`,
    photo: {
      id,
      photographerName: id,
      photographerUrl: 'https://unsplash.com/@test',
      photoUrl: 'https://unsplash.com/photos/test',
    },
  }) as WallpaperAsset;
const visualHtml =
  '<div data-wallpaper-visual><div class="wallpaper__images"><div class="wallpaper__image" data-wallpaper-initial></div></div><div class="wallpaper__scrim"></div></div>';
const creditHtml =
  '<div data-wallpaper-credit><a data-wallpaper-credit-photographer></a><a data-wallpaper-credit-photo></a></div>';
const preferences = {
  theme: 'light',
  enabled: true,
  autoRotation: false,
  hasExplicitTheme: true,
} as const;

function fixture() {
  const dom = parseHTML('<html><body></body></html>');
  const document = dom.document as unknown as Document;
  vi.stubGlobal('HTMLElement', dom.HTMLElement);
  const animations: Array<{
    currentTime: number;
    ready: Promise<void>;
    finished: Promise<void>;
    cancel: () => void;
    finish(): void;
  }> = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((name: string) => {
    const element = create(name);
    element.animate = vi.fn(() => {
      const completion = deferred<void>();
      const animation = {
        currentTime: 1,
        ready: Promise.resolve(),
        finished: completion.promise,
        cancel: vi.fn(() => completion.reject(new DOMException('Cancelled', 'AbortError'))),
        finish: () => completion.resolve(),
      };
      animations.push(animation);
      return animation as unknown as Animation;
    });
    return element;
  });
  const sourceWindow = {
    MutationObserver: dom.MutationObserver,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
    cancelAnimationFrame: clearTimeout,
    getComputedStyle: () => ({ opacity: '1' }),
    reportError: vi.fn(),
  } as unknown as Window;
  const view = new WallpaperView(document, sourceWindow);
  const append = () => {
    const surface = document.createElement('div');
    surface.setAttribute('data-backdrop-surface', '');
    surface.innerHTML = visualHtml + creditHtml;
    document.body.append(surface);
    return surface;
  };
  const ready = () => {
    append();
    view.boot(preferences, 'a', asset('A'));
  };
  return { document, view, append, ready, animations };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('waits for complete parser-created visual and credit nodes before handing off the root image', async () => {
  const f = fixture();
  f.view.boot(preferences, 'a', asset('A'));
  const surface = f.document.createElement('div');
  surface.setAttribute('data-backdrop-surface', '');
  f.document.body.append(surface);
  await Promise.resolve();
  expect(f.view.ready).toBe(false);
  surface.innerHTML = visualHtml;
  await Promise.resolve();
  expect(f.view.connectSurface()).toBe(false);
  expect(f.document.documentElement.style.getPropertyValue('--wallpaper-initial-image')).toContain(
    'base64,A',
  );
  surface.insertAdjacentHTML('beforeend', creditHtml);
  await vi.advanceTimersByTimeAsync(0);
  expect(f.view.ready).toBe(true);
  expect(f.document.querySelectorAll('[data-wallpaper-current]')).toHaveLength(1);
  expect(
    f.document.documentElement.style.getPropertyValue('--wallpaper-initial-image'),
  ).toBeFalsy();
  expect(f.document.querySelector('[data-wallpaper-credit-photographer]')?.textContent).toBe('A');
  f.view.dispose();
});

it('does not pretend presentation succeeded without a complete visual surface', () => {
  const f = fixture();
  f.view.boot(preferences, 'a', asset('A'));
  expect(() => f.view.presentAdvance('b', asset('B'), true)).toThrow('not ready');
  expect(f.document.documentElement.dataset.wallpaperPhotoId).toBe('A');
  f.view.dispose();
});

it('an older opaque layer removes only what it covers, and the newest completion leaves one layer', async () => {
  const f = fixture();
  f.ready();
  const first = f.document.querySelector<HTMLElement>('[data-wallpaper-current]')!;
  const b = f.view.presentAdvance('b', asset('B'), true);
  const c = f.view.presentAdvance('a', asset('C'), true);
  await b.started;
  await c.started;
  expect(f.document.querySelectorAll('.wallpaper__image')).toHaveLength(3);
  expect(first.style.backgroundImage).toContain('base64,A');
  f.animations[0].finish();
  expect(await b.finished).toBe('shown');
  expect(f.document.querySelectorAll('.wallpaper__image')).toHaveLength(2);
  expect(f.document.documentElement.dataset.wallpaperPhotoId).toBe('C');
  f.animations[1].finish();
  expect(await c.finished).toBe('shown');
  expect(f.document.querySelectorAll('.wallpaper__image')).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  f.view.dispose();
});

it('a newer completion discards pending older layers and late callbacks cannot remove it', async () => {
  const f = fixture();
  f.ready();
  const b = f.view.presentAdvance('b', asset('B'), true);
  const c = f.view.presentAdvance('a', asset('C'), true);
  f.animations[1].finish();
  expect(await c.finished).toBe('shown');
  expect(await b.finished).toBe('discarded');
  f.animations[0].finish();
  await vi.advanceTimersByTimeAsync(4000);
  expect(f.document.querySelectorAll('.wallpaper__image')).toHaveLength(1);
  expect(
    f.document.querySelector<HTMLElement>('[data-wallpaper-current]')?.style.backgroundImage,
  ).toContain('base64,C');
  f.view.dispose();
});

it('rebinds the same persistent visual without changing its layers or animations', async () => {
  const f = fixture();
  f.ready();
  const presentation = f.view.presentAdvance('b', asset('B'), true);
  const current = f.document.querySelector('[data-wallpaper-current]');
  const visual = f.document.querySelector('[data-wallpaper-visual]')!;
  f.document.querySelector('[data-backdrop-surface]')!.remove();
  const replacement = f.append();
  replacement.querySelector('[data-wallpaper-visual]')!.replaceWith(visual);
  expect(f.view.connectSurface()).toBe(true);
  expect(f.document.querySelector('[data-wallpaper-current]')).toBe(current);
  expect(f.animations[0].cancel).not.toHaveBeenCalled();
  f.view.dispose();
  expect(await presentation.finished).toBe('discarded');
  expect(vi.getTimerCount()).toBe(0);
});

it('switching to immediate presentation settles the newest image and discards older fades', async () => {
  const f = fixture();
  f.ready();
  const b = f.view.presentAdvance('b', asset('B'), true);
  const c = f.view.presentAdvance('a', asset('C'), true);
  f.view.finishPresentation();
  expect(await b.finished).toBe('discarded');
  expect(await c.finished).toBe('shown');
  expect(f.document.querySelectorAll('.wallpaper__image')).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  f.view.dispose();
});

it('an externally cancelled animation still commits the decoded image and does not strand controls', async () => {
  const f = fixture();
  f.ready();
  const presentation = f.view.presentAdvance('b', asset('B'), true);
  f.animations[0].cancel();
  expect(await presentation.finished).toBe('shown');
  await presentation.started;
  expect(f.document.querySelector('[data-wallpaper-transitioning]')).toBeNull();
  expect(f.document.querySelectorAll('.wallpaper__image')).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  f.view.dispose();
});

it.each(['start', 'finish'] as const)(
  'the %s watchdog commits a visible final image and releases both promises',
  async (stage) => {
    const f = fixture();
    f.ready();
    const presentation = f.view.presentAdvance('b', asset('B'), true);
    if (stage === 'start') f.animations[0].currentTime = 0;
    await vi.advanceTimersByTimeAsync(stage === 'start' ? 250 : 3000);
    await presentation.started;
    expect(await presentation.finished).toBe('shown');
    expect(f.animations[0].cancel).toHaveBeenCalledOnce();
    expect(f.document.querySelectorAll('.wallpaper__image')).toHaveLength(1);
    expect(f.document.querySelector('[data-wallpaper-transitioning]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    f.view.dispose();
  },
);
