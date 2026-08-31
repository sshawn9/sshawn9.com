import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FONT_TIMEOUT_MS } from '../../apps/astro/src/runtime/font-coordinator';
import { createInitialFrameScript } from '../../apps/astro/src/runtime/initial-frame';

interface Boundary {
  id: string;
  removeAttribute(name: string): void;
}

function installInitialDocument(fontLoad: () => Promise<FontFace[]>) {
  const neverReady = new Promise<FontFaceSet>(() => {});
  const boundary: Boundary = {
    id: 'initial-frame-ready',
    removeAttribute(name) {
      if (name === 'id') {
        this.id = '';
      }
    },
  };
  vi.stubGlobal('document', {
    currentScript: { parentElement: boundary },
    fonts: { load: fontLoad, ready: neverReady },
    querySelector: () => ({ getAttribute: () => '400,700' }),
    readyState: 'complete',
  });
  vi.stubGlobal('history', { state: null });
  vi.stubGlobal('location', { pathname: '/zh/blog/', search: '' });
  return boundary;
}

describe('initial-frame coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('releases the render boundary after the bounded font timeout', async () => {
    const boundary = installInitialDocument(() => new Promise<FontFace[]>(() => {}));

    Function(createInitialFrameScript())();
    expect(boundary.id).toBe('');

    await vi.advanceTimersByTimeAsync(FONT_TIMEOUT_MS);
    expect(boundary.id).toBe('initial-frame-ready');
  });

  it('releases the render boundary after a synchronous setup failure', () => {
    const boundary = installInitialDocument(async () => []);
    vi.stubGlobal('history', {
      get state() {
        throw new Error('history unavailable');
      },
    });

    Function(createInitialFrameScript())();

    expect(boundary.id).toBe('initial-frame-ready');
  });
});
