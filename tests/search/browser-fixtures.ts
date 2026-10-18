import { expect, type Page } from '@playwright/test';
import { extname } from 'node:path';
import { close, createIndex, type CustomRecord } from 'pagefind';

/** Exercise the real Pagefind engine with records owned by the test, not published content. */
export async function installSearchFixture(page: Page, records: CustomRecord[]) {
  let files: Map<string, Uint8Array>;
  try {
    const created = await createIndex();
    expect(created.errors).toEqual([]);
    for (const record of records) {
      const added = await created.index!.addCustomRecord(record);
      expect(added.errors).toEqual([]);
    }
    const result = await created.index!.getFiles();
    expect(result.errors).toEqual([]);
    files = new Map(result.files.map((file) => [`/pagefind/${file.path}`, file.content]));
  } finally {
    await close();
  }

  const mime: Record<string, string> = {
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
  };
  await page.route('**/pagefind/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const content = files.get(path);
    await route.fulfill({
      status: content ? 200 : 404,
      contentType: mime[extname(path)] ?? 'application/octet-stream',
      body: content ? Buffer.from(content) : 'Unknown fixture index resource',
    });
  });
}
