import { extname } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants } from 'node:zlib';

const compress = promisify(brotliCompress);

// A local comparison policy, not an imitation of CDN content negotiation.
// Images, WOFF/WOFF2 and Pagefind's compressed data retain their stored sizes.
export const compressionPolicy = {
  algorithm: 'brotli',
  quality: constants.BROTLI_DEFAULT_QUALITY,
  window: constants.BROTLI_DEFAULT_WINDOW,
  mode: 'generic',
  extensions: [
    '.html',
    '.css',
    '.js',
    '.mjs',
    '.cjs',
    '.json',
    '.webmanifest',
    '.svg',
    '.xml',
    '.txt',
    '.csv',
    '.wasm',
    '.ttf',
    '.otf',
  ],
};

/** Measure one file in memory, without writing a compressed build artifact. */
export async function measureFileSizes(file, contents) {
  return {
    bytes: contents.byteLength,
    brotliBytes: compressionPolicy.extensions.includes(extname(file).toLowerCase())
      ? (await compress(contents)).byteLength
      : contents.byteLength,
  };
}

/**
 * Resource URLs can alias a physical file. Sum each known file once and keep
 * unknown URLs separate, so a partial subtotal cannot masquerade as complete.
 * @param {Iterable<{url: string, file: string | null, bytes: number | null, brotliBytes: number | null}>} resources
 */
export function sumFileSizes(resources) {
  const files = new Set();
  const unknown = new Set();
  let knownBytes = 0;
  let knownBrotliBytes = 0;
  for (const resource of resources) {
    if (resource.file === null || resource.bytes === null || resource.brotliBytes === null) {
      unknown.add(resource.url);
      continue;
    }
    if (files.has(resource.file)) continue;
    files.add(resource.file);
    knownBytes += resource.bytes;
    knownBrotliBytes += resource.brotliBytes;
  }
  return { files: files.size, unknownResources: unknown.size, knownBytes, knownBrotliBytes };
}
