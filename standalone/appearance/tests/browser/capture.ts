import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

export type Sample = {
  index: number;
  elapsedMs: number;
  screenshotElapsedMs?: number;
  screenshot?: string;
  screenshotError?: string;
  snapshotError?: string;
  pixels?: ReturnType<typeof inspectPng>;
  document?: {
    url: string;
    readyState: string;
    bodyVisible: boolean;
    fontLoaded: boolean;
    theme: string | null;
    pairs: {
      id: string | null;
      creditId: string | null;
      credit: string;
      visible: boolean;
      complete: boolean;
      width: number;
      height: number;
    }[];
    imageCount: number;
  };
};

// Inspect the real raster output without a third-party image decoder. Playwright
// PNG screenshots are non-interlaced 8-bit RGB/RGBA; unexpected formats fail
// loudly rather than silently omitting a frame from analysis.
export function inspectPng(png: Buffer) {
  const signature = '89504e470d0a1a0a';
  if (png.subarray(0, 8).toString('hex') !== signature) throw new Error('Not a PNG screenshot');
  let width = 0,
    height = 0,
    channels = 0;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8],
        color = data[9],
        interlace = data[12];
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0)
        throw new Error('Unsupported screenshot PNG format');
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') chunks.push(data);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (!width || !height || !channels) throw new Error('Missing PNG image header');
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const current = new Uint8Array(stride),
    previous = new Uint8Array(stride);
  const colors = new Set<string>();
  let count = 0,
    sum = 0,
    square = 0,
    almostWhite = 0;
  let cursor = 0;
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const stepX = Math.max(1, Math.floor(width / 80)),
    stepY = Math.max(1, Math.floor(height / 60));
  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++]!;
    if (filter > 4) throw new Error('Invalid PNG filter');
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? current[x - channels]! : 0;
      const up = previous[x]!,
        diagonal = x >= channels ? previous[x - channels]! : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, diagonal);
      current[x] = (raw[cursor++]! + predictor) & 255;
    }
    if (y % stepY === 0) {
      for (let x = 0; x < width; x += stepX) {
        const offset = x * channels;
        const r = current[offset]!,
          g = current[offset + 1]!,
          b = current[offset + 2]!;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += luminance;
        square += luminance * luminance;
        count++;
        if (r > 247 && g > 247 && b > 247) almostWhite++;
        colors.add((r >> 4) + ':' + (g >> 4) + ':' + (b >> 4));
      }
    }
    previous.set(current);
  }
  return {
    width,
    height,
    sampledPixels: count,
    meanLuminance: sum / count,
    luminanceDeviation: Math.sqrt(Math.max(0, square / count - (sum / count) ** 2)),
    quantizedColors: colors.size,
    almostWhiteFraction: almostWhite / count,
  };
}

export async function snapshot(page: Page): Promise<NonNullable<Sample['document']>> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const app = document.querySelector<HTMLElement>('[data-testid=app-shell]');
    const style = app ? getComputedStyle(app) : null;
    const harness = (window as any).__appearanceDemo;
    const font = harness?.getState().font;
    return {
      url: location.href,
      readyState: document.readyState,
      bodyVisible: !!app && style?.visibility === 'visible' && style.display !== 'none',
      fontLoaded:
        font?.status === 'loaded' && font?.faceStatus === 'loaded' && font?.registered === true,
      theme: root.getAttribute('data-appearance-theme'),
      pairs: Array.from(document.querySelectorAll<HTMLElement>('.appearance-wallpaper-pair')).map(
        (pair) => {
          const image = pair.querySelector<HTMLImageElement>('.appearance-wallpaper-image');
          const credit = pair.querySelector<HTMLElement>('.appearance-wallpaper-credit');
          const pairStyle = getComputedStyle(pair);
          const bounds = pair.getBoundingClientRect();
          return {
            id: pair.dataset.wallpaperId || null,
            creditId: credit?.dataset.wallpaperId || null,
            credit: credit?.textContent?.trim() || '',
            visible:
              pairStyle.display !== 'none' &&
              pairStyle.visibility !== 'hidden' &&
              Number(pairStyle.opacity) > 0.001 &&
              bounds.width > 0 &&
              bounds.height > 0,
            complete: !!image?.complete,
            width: image?.naturalWidth || 0,
            height: image?.naturalHeight || 0,
          };
        },
      ),
      imageCount: document.querySelectorAll('.appearance-wallpaper-image').length,
    };
  });
}

export function assertAtomicSamples(samples: Sample[]) {
  for (const sample of samples) {
    const doc = sample.document;
    if (!doc) continue; // The error is retained in the manifest, never dropped.
    for (const pair of doc.pairs.filter((entry) => entry.visible)) {
      expect(pair.id, 'frame ' + sample.index + ' image/credit ID').toBe(pair.creditId);
      expect(pair.credit, 'frame ' + sample.index + ' missing credit').not.toBe('');
      expect(pair.complete, 'frame ' + sample.index + ' incomplete image').toBe(true);
      expect(pair.width).toBe(1920);
      expect(pair.height).toBe(1080);
      expect(
        doc.fontLoaded,
        'frame ' + sample.index + ' displayed before its exact FontFace loaded',
      ).toBe(true);
    }
    if (doc.bodyVisible)
      expect(doc.fontLoaded, 'fallback body text must never be revealed').toBe(true);
  }
}

export async function captureSequence(
  page: Page,
  testInfo: TestInfo,
  name: string,
  action: () => Promise<unknown>,
  minimumMs = 1600,
) {
  const directory = testInfo.outputPath(name);
  await mkdir(directory, { recursive: true });
  const started = Date.now();
  const samples: Sample[] = [];
  async function capture() {
    const sample: Sample = { index: samples.length, elapsedMs: Date.now() - started };
    try {
      sample.document = await snapshot(page);
    } catch (error) {
      sample.snapshotError = String(error);
    }
    try {
      const png = await page.screenshot({
        type: 'png',
        animations: 'allow',
        caret: 'initial',
        timeout: 2500,
      });
      sample.screenshot = 'frame-' + String(sample.index).padStart(4, '0') + '.png';
      await writeFile(join(directory, sample.screenshot), png);
      sample.screenshotElapsedMs = Date.now() - started;
      sample.pixels = inspectPng(png);
    } catch (error) {
      sample.screenshotError = String(error);
    }
    samples.push(sample);
  }
  // Capture BEFORE invoking navigation/action, and retain every attempted sample,
  // including context-destroyed, missing-body, missing-image and blank rasters.
  await capture();
  let settled = false;
  let actionError: unknown;
  const actionPromise = action()
    .catch((error: unknown) => {
      actionError = error;
    })
    .finally(() => {
      settled = true;
    });
  while (!settled || Date.now() - started < minimumMs) {
    await capture();
    if (Date.now() - started > 18000) break;
    await new Promise((resolve) => setTimeout(resolve, 45));
  }
  await actionPromise;
  await capture();
  const missingBody = samples.filter((sample) => !sample.document?.bodyVisible);
  const missingImage = samples.filter(
    (sample) => !sample.document?.pairs.some((pair) => pair.visible),
  );
  const screenshotErrors = samples.filter((sample) => !!sample.screenshotError);
  const estimatedMissingDuration = (predicate: (sample: Sample) => boolean) =>
    samples.reduce(
      (sum, sample, index) =>
        sum +
        (predicate(sample)
          ? Math.max(0, (samples[index + 1]?.elapsedMs ?? sample.elapsedMs) - sample.elapsedMs)
          : 0),
      0,
    );
  const manifest = {
    name,
    note: 'All attempted samples are retained. DOM observations precede screenshots and are not frame-perfect compositor synchronization. Video and trace are also retained. Initial/navigation missing-content samples are reported, not filtered or counted as proof of zero-flash.',
    sampleCount: samples.length,
    missingBodyFrames: missingBody.map((sample) => sample.index),
    missingImageFrames: missingImage.map((sample) => sample.index),
    estimatedMissingBodyMs: estimatedMissingDuration((sample) => !sample.document?.bodyVisible),
    estimatedMissingImageMs: estimatedMissingDuration(
      (sample) => !sample.document?.pairs.some((pair) => pair.visible),
    ),
    screenshotErrors: screenshotErrors.map((sample) => sample.index),
    actionError: actionError ? String(actionError) : null,
    samples,
  };
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await testInfo.attach(name + '-all-frames', {
    path: manifestPath,
    contentType: 'application/json',
  });
  for (const sample of samples) {
    if (sample.screenshot)
      await testInfo.attach(name + '-' + sample.screenshot, {
        path: join(directory, sample.screenshot),
        contentType: 'image/png',
      });
  }
  testInfo.annotations.push({
    type: 'navigation-frame-observation',
    description:
      name +
      ': ' +
      missingBody.length +
      ' missing-body / ' +
      missingImage.length +
      ' missing-image / ' +
      screenshotErrors.length +
      ' capture errors out of ' +
      samples.length +
      ' samples; see complete manifest.',
  });
  expect(samples.length).toBeGreaterThan(2);
  expect(
    screenshotErrors,
    'a missing screenshot is a capture gap, not a passing frame',
  ).toHaveLength(0);
  assertAtomicSamples(samples);
  if (actionError) throw actionError;
  return samples;
}
