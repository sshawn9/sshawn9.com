import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { decodeDataUrl } from '../../../apps/site/src/features/appearance/wallpaper/assets';
import { IMAGE_TIMEOUT_MS } from '../../../apps/site/src/features/appearance/wallpaper/model';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function decodingImage() {
  let finish!: () => void;
  const decoded = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const image = {
    decoding: '',
    src: '',
    naturalWidth: 16,
    complete: true,
    decode: () => decoded,
    removeAttribute: vi.fn(),
  };
  const sourceWindow = {
    Image: class {
      constructor() {
        return image;
      }
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  } as unknown as Window;
  return { sourceWindow, image, finish };
}

it('cancellation releases the decode wait and its timer without waiting for the image', async () => {
  const { sourceWindow, image, finish } = decodingImage();
  const controller = new AbortController();
  const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
  const decoding = decodeDataUrl(sourceWindow, 'data:image/png;base64,fixture', controller.signal);
  expect(vi.getTimerCount()).toBe(1);
  controller.abort();
  expect(await decoding).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(image.removeAttribute).toHaveBeenCalledExactlyOnceWith('src');
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  finish();
  await Promise.resolve();
  expect(image.removeAttribute).toHaveBeenCalledTimes(1);
});

it('an already cancelled decode does not create an image or timer', async () => {
  const { sourceWindow, image } = decodingImage();
  const controller = new AbortController();
  controller.abort();
  expect(
    await decodeDataUrl(sourceWindow, 'data:image/png;base64,fixture', controller.signal),
  ).toBe(false);
  expect(image.src).toBe('');
  expect(vi.getTimerCount()).toBe(0);
});

it('the existing timeout still releases a decode without a cancellation signal', async () => {
  const { sourceWindow, image } = decodingImage();
  const decoding = decodeDataUrl(sourceWindow, 'data:image/png;base64,fixture');
  await vi.advanceTimersByTimeAsync(IMAGE_TIMEOUT_MS);
  expect(await decoding).toBe(false);
  expect(image.removeAttribute).toHaveBeenCalledExactlyOnceWith('src');
  expect(vi.getTimerCount()).toBe(0);
});
