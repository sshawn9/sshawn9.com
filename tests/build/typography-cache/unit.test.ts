import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import { describe, expect, it } from 'vitest';

const fixtureEntryId = 'virtual:typography-cache-entry';
const fixtureSiteStylesId = 'virtual:typography-cache-site.css';
const resolvedEntryId = `\0${fixtureEntryId}`;
const resolvedSiteStylesId = `\0${fixtureSiteStylesId}`;
const typographyStylesPath = fileURLToPath(
  new URL('../../../apps/site/src/styles/typography-vendor.css', import.meta.url),
);

type FixtureResult = {
  siteStylesheet: string;
  typographyStylesheet: string;
};

async function buildFixture(siteColor: string): Promise<FixtureResult> {
  const result = await viteBuild({
    configFile: false,
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    publicDir: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'typography-cache-fixture',
        resolveId(id) {
          if (id === fixtureEntryId) return resolvedEntryId;
          if (id === fixtureSiteStylesId) return resolvedSiteStylesId;
          return undefined;
        },
        load(id) {
          if (id === resolvedEntryId) {
            return [
              `import typographyUrl from ${JSON.stringify(`${typographyStylesPath}?url`)};`,
              `import ${JSON.stringify(fixtureSiteStylesId)};`,
              'console.log(typographyUrl);',
            ].join('\n');
          }
          if (id === resolvedSiteStylesId) {
            return `.site-cache-probe { color: ${siteColor}; }`;
          }
          return undefined;
        },
      },
    ],
    build: {
      write: false,
      rolldownOptions: {
        input: fixtureEntryId,
        output: {
          assetFileNames: '_astro/[name].[hash][extname]',
          entryFileNames: '_astro/[name].[hash].js',
        },
      },
    },
  });

  if (Array.isArray(result) || !('output' in result)) {
    throw new Error('fixture build must return one in-memory output');
  }

  const output = result.output;
  const stylesheets = output.filter(
    (item) => item.type === 'asset' && item.fileName.endsWith('.css'),
  );
  const typography = stylesheets.find((item) =>
    /^_astro\/typography-vendor\.[\w-]+\.css$/.test(item.fileName),
  );
  const site = stylesheets.find((item) => item !== typography);
  const entry = output.find((item) => item.type === 'chunk' && item.isEntry);

  if (
    !typography ||
    typography.type !== 'asset' ||
    !site ||
    !entry ||
    entry.type !== 'chunk' ||
    stylesheets.length !== 2
  ) {
    throw new Error('fixture build must emit separate typography, site, and entry assets');
  }

  const typographyUrl = `/${typography.fileName}`;
  expect(entry.code).toContain(typographyUrl);
  expect(String(typography.source)).toContain('Noto Sans SC Variable');
  expect(String(typography.source)).toContain('KaTeX_Main');

  return {
    siteStylesheet: site.fileName,
    typographyStylesheet: typography.fileName,
  };
}

describe('typography vendor cache boundary', () => {
  it('keeps the real CSS ?url asset stable when only site CSS changes', async () => {
    const first = await buildFixture('#123456');
    const changed = await buildFixture('#654321');

    expect(changed.typographyStylesheet).toBe(first.typographyStylesheet);
    expect(changed.siteStylesheet).not.toBe(first.siteStylesheet);
  });
});
