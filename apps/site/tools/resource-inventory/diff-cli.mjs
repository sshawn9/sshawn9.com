import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  compareInventories,
  renderInventoryDiffMarkdown,
  renderInventoryDiffSummary,
} from './diff.mjs';

const usage =
  'Usage: npm run inventory:diff -- BEFORE.json AFTER.json [--check | --output DIRECTORY [--summary FILE]]';

async function readInventory(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read inventory ${file}: ${error.message}`);
  }
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      check: { type: 'boolean', default: false },
      output: { type: 'string' },
      summary: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(usage);
  } else {
    if (
      positionals.length !== 2 ||
      (values.check ? values.output || values.summary : !values.output)
    ) {
      throw new Error(usage);
    }
    const [beforePath, afterPath] = positionals;
    const before = await readInventory(beforePath);
    const after = await readInventory(afterPath);
    const comparison = compareInventories(before, after);
    if (values.check) {
      console.log(`Validated production inventories: ${before.buildId} -> ${after.buildId}`);
    } else {
      const report = {
        generatedAt: new Date().toISOString(),
        beforeSavedAt: (await stat(beforePath)).mtime.toISOString(),
        ...comparison,
      };
      await mkdir(values.output, { recursive: true });
      await writeFile(join(values.output, 'diff.json'), JSON.stringify(report, null, 2) + '\n');
      await writeFile(join(values.output, 'diff.md'), renderInventoryDiffMarkdown(report));
      if (values.summary) await appendFile(values.summary, renderInventoryDiffSummary(report));
      console.log(
        `Pages: +${report.pages.added.length} / -${report.pages.removed.length}; resources: +${report.resources.added.length} / -${report.resources.removed.length}.`,
      );
    }
  }
} catch (error) {
  console.error(`Inventory comparison failed: ${error.message}`);
  process.exitCode = 1;
}
