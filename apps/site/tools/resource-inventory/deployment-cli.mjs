import { appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generateResourceInventory } from './cli.mjs';
import { prepareProductionInventories } from './deployment.mjs';

const siteDirectory = fileURLToPath(new URL('../../', import.meta.url));
const usage =
  'Usage: npm run inventory:prepare -- [--url URL] [--output DIRECTORY] [--summary FILE]';

let summary;
try {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      output: { type: 'string' },
      summary: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(usage);
  } else {
    summary = values.summary;
    const reportDirectory = resolve(
      values.output ?? join(siteDirectory, '.reports/production-inventory'),
    );
    await generateResourceInventory();
    await prepareProductionInventories({
      inventoryPath: join(siteDirectory, '.reports/resource-inventory.json'),
      assetsDirectory: join(siteDirectory, 'dist'),
      reportDirectory,
      inventoryUrl: values.url ?? 'https://sshawn9.com/resource-inventory.json',
    });
    console.log(`Prepared production inventory snapshots in ${reportDirectory}`);
  }
} catch (error) {
  process.exitCode = 1;
  const message = 'Production deployment stopped: inventory preparation failed.';
  console.error(`${message}\n${error.message}`);
  if (summary) {
    try {
      await appendFile(summary, `\n${message}\n`);
    } catch (summaryError) {
      console.error(`Could not write the deployment summary: ${summaryError.message}`);
    }
  }
}
