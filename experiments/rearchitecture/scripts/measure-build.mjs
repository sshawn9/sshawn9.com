import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = resolve(root, 'reports/build-metrics.json');
const fixtureStats = JSON.parse(
  await readFile(resolve(root, 'shared/generated/fixture-stats.json'), 'utf8'),
);

const candidates = [
  {
    name: 'astro',
    dist: resolve(root, 'apps/astro/dist'),
    article: 'zh/blog/frenet-poc/index.html',
  },
  {
    name: 'qwik',
    dist: resolve(root, 'apps/qwik/dist'),
    article: 'zh/blog/frenet-poc/index.html',
  },
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat().sort();
}

function sizes(contents) {
  return {
    raw: contents.byteLength,
    gzip: gzipSync(contents, { level: 9 }).byteLength,
    brotli: brotliCompressSync(contents, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
      },
    }).byteLength,
  };
}

function addSizes(total, next) {
  total.raw += next.raw;
  total.gzip += next.gzip;
  total.brotli += next.brotli;
}

async function measureCandidate(candidate) {
  const files = await listFiles(candidate.dist);
  const groups = {
    javascript: new Set(['.js', '.mjs']),
    css: new Set(['.css']),
    fonts: new Set(['.woff', '.woff2']),
  };
  const totals = Object.fromEntries(
    Object.keys(groups).map((group) => [group, { files: 0, raw: 0, gzip: 0, brotli: 0 }]),
  );
  const bodyDuplicatingAssets = [];

  for (const path of files) {
    const extension = extname(path);
    const contents = await readFile(path);
    for (const [group, extensions] of Object.entries(groups)) {
      if (extensions.has(extension)) {
        totals[group].files += 1;
        addSizes(totals[group], sizes(contents));
      }
    }

    if (
      (extension === '.js' || extension === '.mjs' || extension === '.json') &&
      contents.includes(Buffer.from(fixtureStats.bodyProbe))
    ) {
      bodyDuplicatingAssets.push({
        path: relative(candidate.dist, path),
        ...sizes(contents),
      });
    }
  }

  return {
    articleDocument: sizes(await readFile(resolve(candidate.dist, candidate.article))),
    assetTotals: totals,
    bodyDuplicatingAssets,
  };
}

const measuredCandidates = Object.fromEntries(
  await Promise.all(
    candidates.map(async (candidate) => [candidate.name, await measureCandidate(candidate)]),
  ),
);

const report = {
  schemaVersion: 1,
  fixture: {
    sections: fixtureStats.sectionCount,
    bodyProbe: fixtureStats.bodyProbe,
    sourceCharacters: fixtureStats.sourceCharacters,
  },
  compression: {
    gzipLevel: 9,
    brotliQuality: 11,
  },
  candidates: measuredCandidates,
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
