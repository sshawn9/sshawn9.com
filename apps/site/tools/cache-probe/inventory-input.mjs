import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProbeClient } from './http.mjs';

export const defaultInventoryUrl = 'https://sshawn9.com/resource-inventory.json';

function parseInventory(contents, source) {
  const text = contents.toString('utf8');
  const parsedBytes = Buffer.from(text, 'utf8');
  let inventory;
  try {
    inventory = JSON.parse(text);
  } catch (error) {
    throw new Error(`Inventory from ${source} is not valid JSON: ${error.message}`);
  }
  return {
    inventory,
    bytes: parsedBytes.byteLength,
    sha256: createHash('sha256').update(parsedBytes).digest('hex'),
  };
}

function remoteUrl(source) {
  if (!/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(source)) return null;
  let url;
  try {
    url = new URL(source);
  } catch (error) {
    throw new Error(`Invalid inventory URL: ${error.message}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`Unsupported inventory URL protocol ${url.protocol}`);
  if (url.username || url.password) throw new Error('Inventory URL must not contain credentials.');
  return url;
}

/**
 * @param {string} source A local path or HTTP(S) URL.
 * @param {{signal?: AbortSignal, requestTimeout: number,
 *   clientFactory?: typeof createProbeClient}} options
 */
export async function loadInventory(
  source,
  { signal, requestTimeout, clientFactory = createProbeClient },
) {
  const url = remoteUrl(source);
  if (!url) {
    const file = resolve(source);
    const contents = await readFile(file, { signal });
    const parsed = parseInventory(contents, file);
    return {
      inventory: parsed.inventory,
      input: { file, bytes: parsed.bytes, sha256: parsed.sha256 },
    };
  }

  const client = clientFactory({ concurrency: 1, requestTimeout });
  try {
    const result = await client.request(url, {
      signal,
      captureLimit: Number.MAX_SAFE_INTEGER,
    });
    if (!result.complete)
      throw new Error(
        `Could not download inventory from ${url.href}: ${result.error ?? 'request failed'}`,
      );
    if (result.httpStatus !== 200)
      throw new Error(`Could not download inventory from ${url.href}: HTTP ${result.httpStatus}`);
    const contents = Buffer.from(result.text ?? '', 'utf8');
    const parsed = parseInventory(contents, url.href);
    return {
      inventory: parsed.inventory,
      input: { url: url.href, bytes: parsed.bytes, sha256: parsed.sha256 },
    };
  } finally {
    await client.close();
  }
}
