import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent, fetch } from 'undici';
import { compareInventories } from './diff.mjs';

async function downloadInventory(url) {
  // Preserve the deployment workflow's existing 5s connection / 20s request limits.
  const dispatcher = new Agent({ connectTimeout: 5_000 });
  try {
    const response = await fetch(url, {
      dispatcher,
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Could not download ${url}: HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    await dispatcher.close();
  }
}

/**
 * Package the generated inventory and save the snapshots used after deployment.
 * A failed download or validation never falls back to an empty inventory.
 * @param {{ inventoryPath: string, assetsDirectory: string, reportDirectory: string, inventoryUrl: string }} options
 * @param {{ wait?: (milliseconds: number) => Promise<unknown> }} [dependencies]
 */
export async function prepareProductionInventories(
  { inventoryPath, assetsDirectory, reportDirectory, inventoryUrl },
  { wait = delay } = {},
) {
  const contents = await readFile(inventoryPath, 'utf8');
  const after = JSON.parse(contents);
  compareInventories(after, after);

  await mkdir(reportDirectory, { recursive: true });
  await copyFile(inventoryPath, join(assetsDirectory, 'resource-inventory.json'));
  await writeFile(join(reportDirectory, 'after.json'), contents);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const before = await downloadInventory(inventoryUrl);
      await writeFile(join(reportDirectory, 'before.json'), before);
      compareInventories(JSON.parse(before), after);
      return;
    } catch (error) {
      if (attempt === 3) {
        throw new Error(
          `Inventory snapshot or validation failed after three attempts: ${error.message}`,
          { cause: error },
        );
      }
      console.warn(`Inventory snapshot attempt ${attempt} failed: ${error.message}`);
      await wait(2_000);
    }
  }
}
