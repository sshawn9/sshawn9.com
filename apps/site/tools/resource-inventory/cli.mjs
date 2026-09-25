import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildInfoUrl } from './build-info.mjs';
import { createResourceInventory } from './inventory.mjs';
import { renderInventoryMarkdown } from './markdown.mjs';

const directory = fileURLToPath(new URL('../../dist/', import.meta.url));
const reportDirectory = new URL('../../.reports/', import.meta.url);
const reportUrl = new URL('resource-inventory.json', reportDirectory);
const markdownUrl = new URL('resource-inventory.md', reportDirectory);

async function replaceReports(json, markdown) {
  const temporaryUrls = [
    new URL(`resource-inventory.json.tmp-${process.pid}-${randomUUID()}`, reportDirectory),
    new URL(`resource-inventory.md.tmp-${process.pid}-${randomUUID()}`, reportDirectory),
  ];
  try {
    await writeFile(temporaryUrls[0], json);
    await writeFile(temporaryUrls[1], markdown);
    await rename(temporaryUrls[0], reportUrl);
    await rename(temporaryUrls[1], markdownUrl);
  } finally {
    await Promise.all(temporaryUrls.map((url) => rm(url, { force: true })));
  }
}

export async function generateResourceInventory() {
  let buildInfo;
  try {
    buildInfo = JSON.parse(await readFile(buildInfoUrl, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(
      'Missing build information. Run npm run build first. This command does not build automatically.',
    );
  }
  const report = await createResourceInventory({ directory, buildInfo });
  const markdown = renderInventoryMarkdown(report);
  const errors = report.diagnostics.filter((item) => item.level === 'error');
  const warnings = report.diagnostics.length - errors.length;
  if (errors.length) {
    for (const item of errors) console.error(`${item.url}: ${item.message}`);
    throw new Error('Resource inventory contains errors; existing reports were not updated.');
  }
  await mkdir(reportDirectory, { recursive: true });
  await replaceReports(JSON.stringify(report, null, 2) + '\n', markdown);
  console.log(
    `${report.pages.length} pages, ${report.resources.length} resources; ${errors.length} errors, ${warnings} warnings.`,
  );
  console.log(fileURLToPath(reportUrl));
  console.log(fileURLToPath(markdownUrl));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await generateResourceInventory();
  } catch (error) {
    console.error(`Resource inventory generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
