import { afterEach, describe, expect, it, vi } from 'vitest';
import { build as viteBuild } from 'vite';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { brotliCompressSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  captureClientManifest,
  fontPolicyUrl,
} from '../../../apps/site/tools/resource-inventory/build-info.mjs';
import { createResourceInventory } from '../../../apps/site/tools/resource-inventory/inventory.mjs';
import { fontResourceUrls } from '../../../apps/site/tools/resource-inventory/fonts.mjs';
import { renderInventoryMarkdown } from '../../../apps/site/tools/resource-inventory/markdown.mjs';
import { measureFileSizes } from '../../../apps/site/tools/resource-inventory/sizes.mjs';
import {
  readHtmlReferences,
  readModuleReferences,
  readModuleText,
  readStylesheet,
} from '../../../apps/site/tools/resource-inventory/references.mjs';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(files: Record<string, string>, manifest: Record<string, any> = {}) {
  const parent = fileURLToPath(new URL('../../.results/', import.meta.url));
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'resource-inventory-'));
  temporaryDirectories.push(directory);
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await writeFile(join(directory, file), contents);
  }
  return {
    directory,
    buildInfo: {
      site: 'https://site.test',
      buildId: 'test-build',
      mode: 'production',
      manifest,
      fontPolicyHash: createHash('sha256')
        .update(await readFile(fontPolicyUrl))
        .digest('hex'),
      fileHashes: Object.fromEntries(
        Object.entries(files).map(([file, source]) => [
          file,
          createHash('sha256').update(source).digest('hex'),
        ]),
      ),
    },
  };
}

describe('resource inventory build boundary', () => {
  it('captures static and dynamic dependencies without changing deployed output', async () => {
    let manifest: Record<string, any> = {};
    async function build(capture: boolean) {
      const output = await viteBuild({
        configFile: false,
        root: fileURLToPath(new URL('../../../', import.meta.url)),
        publicDir: false,
        logLevel: 'silent',
        plugins: [
          {
            name: 'inventory-fixture',
            resolveId(id) {
              if (id.startsWith('virtual:inventory-')) return id;
            },
            load(id) {
              if (id === 'virtual:inventory-entry')
                return 'import "virtual:inventory-site.css"; import { shared } from "virtual:inventory-shared"; console.log(shared); window.loadInventory=()=>import("virtual:inventory-lazy")';
              if (id === 'virtual:inventory-second')
                return 'import { shared } from "virtual:inventory-shared"; console.log(shared)';
              if (id === 'virtual:inventory-shared') return 'export const shared = "shared"';
              if (id === 'virtual:inventory-site.css') return 'body{color:red}';
              if (id === 'virtual:inventory-lazy.css') return 'body{color:blue}';
              if (id === 'virtual:inventory-lazy')
                return 'import "virtual:inventory-lazy.css"; import { shared } from "virtual:inventory-shared"; console.log(shared)';
            },
          },
          ...(capture
            ? [captureClientManifest((value: typeof manifest) => (manifest = value))]
            : []),
        ],
        build: {
          write: false,
          rolldownOptions: { input: ['virtual:inventory-entry', 'virtual:inventory-second'] },
        },
      });
      if (Array.isArray(output) || !('output' in output)) throw new Error('Expected one bundle');
      return output.output
        .map((item) => ({
          file: item.fileName,
          content: item.type === 'chunk' ? item.code : String(item.source),
        }))
        .sort((a, b) => a.file.localeCompare(b.file));
    }
    const original = await build(false);
    expect(await build(true)).toEqual(original);
    const entry = Object.values(manifest).find(
      (chunk: any) => chunk.isEntry && chunk.dynamicImports,
    ) as any;
    expect(entry.imports.length).toBeGreaterThan(0);
    expect(entry.dynamicImports.length).toBeGreaterThan(0);
    expect(entry.css.length).toBeGreaterThan(0);
  });
});

describe('Pagefind build lifecycle', () => {
  it.each(['success', 'initialization', 'indexing', 'writing files'])(
    'handles %s and always closes the service',
    async (stage) => {
      const result = (action: string) => ({ errors: action === stage ? ['test failure'] : [] });
      const index = {
        addDirectory: vi.fn(async () => ({ ...result('indexing'), page_count: 2 })),
        writeFiles: vi.fn(async () => result('writing files')),
      };
      const close = vi.fn(async () => null);
      vi.resetModules();
      vi.doMock('pagefind', () => ({
        createIndex: vi.fn(async () => ({ ...result('initialization'), index })),
        close,
      }));
      try {
        const { pagefindBuild } = await import('../../../apps/site/config/search-index.mjs');
        const run = pagefindBuild().hooks['astro:build:done']({
          dir: new URL('file:///tmp/site-output/'),
          logger: { info: vi.fn() },
        });
        if (stage === 'success') {
          await run;
          expect(index.addDirectory).toHaveBeenCalledWith({ path: '/tmp/site-output/' });
          expect(index.writeFiles).toHaveBeenCalledWith({
            outputPath: '/tmp/site-output/pagefind',
          });
        } else {
          await expect(run).rejects.toThrow(`Pagefind ${stage} failed`);
          if (stage !== 'writing files') expect(index.writeFiles).not.toHaveBeenCalled();
        }
        expect(close).toHaveBeenCalledOnce();
      } finally {
        vi.doUnmock('pagefind');
        vi.resetModules();
      }
    },
  );
});

describe('resource reference parsing', () => {
  it('keeps all page-associated resources, including template and noscript content', async () => {
    const document = await readHtmlReferences(
      `<!doctype html><html lang="zh-CN"><head><title>A &amp; B</title><base href="/assets/"><meta name="site-build-id" content="test-build"><link rel="stylesheet" href="site.css?v=1&amp;x=2#part"><script type="application/json" src="not-script.js"></script><script type="module">import './entry.js'; import('./lazy.js')</script></head><body><a href="/next/">Next</a><a data-article-media-item href="large.webp">Zoom</a><img srcset="small.webp 1x, large.webp 2x"><template><img src="template.webp"></template><noscript><img src="noscript.webp"></noscript><div style="background:url(decoration.svg)"></div></body></html>`,
    );
    expect(document).toMatchObject({
      language: 'zh-CN',
      title: 'A & B',
      baseHref: '/assets/',
      buildId: 'test-build',
    });
    expect(document.references).toEqual(
      expect.arrayContaining([
        'site.css?v=1&x=2#part',
        './entry.js',
        './lazy.js',
        'large.webp',
        'template.webp',
        'noscript.webp',
        'decoration.svg',
      ]),
    );
    expect(document.references).not.toContain('/next/');
    expect(document.references).not.toContain('not-script.js');
  });

  it('separates regular CSS URLs from parsed font faces', () => {
    const stylesheet = readStylesheet(
      String.raw`@import "base.css"; .x{background:url("icon.svg")} @font-face{font-family: Test Font;src:local(Test),url("font\20 latin.woff2");font-style:italic;font-weight:bold;unicode-range:U+4??,U+4E00-9FFF} :root{--font-test:"Test Font",sans-serif}`,
    );
    expect(stylesheet.references).toEqual(['base.css', 'icon.svg']);
    expect(stylesheet.variables['--font-test']).toContain('Test Font');
    expect(stylesheet.faces).toEqual([
      expect.objectContaining({
        family: 'Test Font',
        style: 'italic',
        weight: [700, 700],
        ranges: [
          [0x400, 0x4ff],
          [0x4e00, 0x9fff],
        ],
        urls: ['font latin.woff2'],
      }),
    ]);
  });

  it('does not treat bare or computed module imports as known files', async () => {
    expect(
      await readModuleReferences(
        `import 'package-name'; import('./lazy.js'); import(variable); console.log(import.meta.url)`,
      ),
    ).toEqual({ references: ['./lazy.js'], unresolved: true });
  });

  it('reads fixed island text without executing strings or losing Unicode escapes', () => {
    const text = readModuleText(
      'throw new Error("must not execute"); const label="\\u540c\\u6b65"; const message=`开始 ${value} 结束`;',
    );
    for (const character of '同步开始结束') expect(text).toContain(character);
  });

  it('keeps arbitrary input coverage within the declared input font families', async () => {
    const html = await readHtmlReferences(
      '<meta name="site-font-query" content="400 1em var(--font-test)"><style>:root{--font-test:"Input Font","Noto Sans SC Variable"}@font-face{font-family:"Input Font";src:url(/latin.woff2);unicode-range:U+0-FF}@font-face{font-family:"Noto Sans SC Variable";src:url(/han.woff2);unicode-range:U+4E00-9FFF}@font-face{font-family:"KaTeX_Main";src:url(/math.woff2)}</style><input>',
    );
    expect(
      fontResourceUrls({
        document: html.document,
        styles: html.styles,
        unrestrictedInput: true,
      }).sort(),
    ).toEqual(['/han.woff2', '/latin.woff2']);
  });
});

describe('resource inventory', () => {
  it('builds deduplicated symmetric page/resource relationships through imports and cycles', async () => {
    const input = await fixture(
      {
        'a/index.html':
          '<link rel="stylesheet" href="/shared.css"><script src="/_astro/a.js"></script>',
        'b/index.html': '<link rel="stylesheet" href="/shared.css">',
        'shared.css': '@import "theme.css"; .x{background:url("/image.webp")}',
        'theme.css': '@import "shared.css";',
        '_astro/a.js': '',
        '_astro/shared.js': '',
        '_astro/lazy.js': '',
        '_astro/lazy.css': '',
        'image.webp': 'image',
        'unreferenced.webp': 'image',
      },
      {
        a: { file: '_astro/a.js', imports: ['shared'], dynamicImports: ['lazy'] },
        shared: { file: '_astro/shared.js', imports: ['a'] },
        lazy: { file: '_astro/lazy.js', css: ['_astro/lazy.css'] },
      },
    );
    const report = await createResourceInventory(input);
    expect(report.pageResources['https://site.test/a/']).toEqual(
      expect.arrayContaining([
        'https://site.test/_astro/shared.js',
        'https://site.test/_astro/lazy.css',
        'https://site.test/theme.css',
        'https://site.test/image.webp',
      ]),
    );
    for (const [page, resources] of Object.entries(report.pageResources))
      for (const resource of resources as string[])
        expect(report.resourcePages[resource]).toContain(page);
    for (const [resource, pages] of Object.entries(report.resourcePages))
      for (const page of pages as string[]) expect(report.pageResources[page]).toContain(resource);
    expect(
      report.pageResources['https://site.test/a/'].filter((url) => url === 'https://site.test/a/'),
    ).toHaveLength(1);
    expect(report.resourcePages['https://site.test/unreferenced.webp']).toEqual([]);
    expect(report.diagnostics).toEqual([]);
    expect(await createResourceInventory(input)).toEqual(report);
  });

  it('includes unlinked and noindex HTML, identifies 404, and rejects unrecorded documents', async () => {
    const input = await fixture({
      'index.html': '<title>Entry</title>',
      'hidden/index.html': '<meta name="robots" content="noindex">',
      '404.html': '<title>Missing</title>',
    });
    const report = await createResourceInventory(input);
    expect(report.pages.map((page) => page.url)).toContain('https://site.test/hidden/');
    expect(report.pages.find((page) => page.url === 'https://site.test/404')?.kind).toBe(
      'not-found',
    );
    await writeFile(join(input.directory, 'extra.html'), '<title>Another build</title>');
    await expect(createResourceInventory(input)).rejects.toThrow('Build file list does not match');
  });

  it('keeps responsive and gallery media associated with their page only', async () => {
    const report = await createResourceInventory(
      await fixture(
        {
          'article/index.html':
            '<main data-article-page><div class="article-prose"><img src="/small.webp" srcset="/small.webp 1x,/large.webp 2x"><a data-article-media-item href="/large.webp">open</a></div></main><script src="/_astro/runtime.js"></script>',
          'about/index.html':
            '<main><img src="/about.webp"></main><script src="/_astro/runtime.js"></script>',
          'small.webp': 'x',
          'large.webp': 'x',
          'about.webp': 'x',
          '_astro/runtime.js': '',
          '_astro/gallery.js': '',
          '_astro/gallery.css': '',
        },
        {
          runtime: { file: '_astro/runtime.js', dynamicImports: ['gallery', 'galleryCss'] },
          gallery: {
            file: '_astro/gallery.js',
            src: '../../node_modules/photoswipe/dist/photoswipe.esm.js',
          },
          galleryCss: {
            file: '_astro/gallery.css',
            src: '../../node_modules/photoswipe/dist/photoswipe.css',
          },
        },
      ),
    );
    expect(report.pageResources['https://site.test/article/']).toEqual(
      expect.arrayContaining([
        'https://site.test/small.webp',
        'https://site.test/large.webp',
        'https://site.test/_astro/gallery.js',
        'https://site.test/_astro/gallery.css',
      ]),
    );
    expect(report.pageResources['https://site.test/about/']).not.toContain(
      'https://site.test/_astro/gallery.js',
    );
    expect(report.pageResources['https://site.test/about/']).not.toContain(
      'https://site.test/_astro/gallery.css',
    );
    expect(report.diagnostics).toEqual([]);
  });

  it('selects declared font face fragments for actual page text', async () => {
    const report = await createResourceInventory(
      await fixture({
        'index.html': `<meta name="site-font-query" content='400 1em "Test Font"'><link rel="stylesheet" href="/fonts.css?v=1"><main data-font-surface>中文</main>`,
        'fonts.css':
          '@font-face{font-family:"Test Font";src:url("/latin.woff2");unicode-range:U+0000-00FF}@font-face{font-family:"Noto Sans SC Variable";src:url("/han.woff2"),url("/han.woff");unicode-range:U+4E00-9FFF}@font-face{font-family:"Noto Sans SC Variable";src:url("/unneeded.woff2");unicode-range:U+1F600}',
        'latin.woff2': 'latin',
        'han.woff2': 'han',
        'han.woff': 'han alternative',
        'unneeded.woff2': 'unused fragment',
      }),
    );
    expect(report.pageResources['https://site.test/']).toEqual(
      expect.arrayContaining([
        'https://site.test/latin.woff2',
        'https://site.test/han.woff2',
        'https://site.test/han.woff',
      ]),
    );
    expect(report.pageResources['https://site.test/']).not.toContain(
      'https://site.test/unneeded.woff2',
    );
    expect(report.diagnostics).toEqual([]);
    const katex = readStylesheet(
      '@font-face{font-family:"KaTeX_Main";src:url("main.woff2");font-weight:400 700;unicode-range:U+0000-00FF}',
    );
    expect(katex.faces[0]).toMatchObject({
      family: 'KaTeX_Main',
      weight: [400, 700],
      ranges: [[0, 0xff]],
    });
  });

  it('does not assign site fonts to a system-font locale entry page', async () => {
    const report = await createResourceInventory(
      await fixture({ 'index.html': '<a href="/en/">English</a><a href="/zh/">中文</a>' }),
    );
    expect(report.pageResources['https://site.test/']).toEqual(['https://site.test/']);
    expect(report.diagnostics).toEqual([]);
  });

  it('includes fallback glyphs and fixed island text absent from the HTML', async () => {
    const report = await createResourceInventory(
      await fixture({
        'index.html':
          '<meta name="site-font-query" content="400 1em var(--font-test)"><link rel="stylesheet" href="/font.css"><main data-font-surface>Tree └─</main><astro-island component-url="/island.js" props="{}"></astro-island>',
        'font.css':
          ':root{--font-test:"Test Font","Noto Sans SC Variable"}@font-face{font-family:"Test Font";src:url("/latin.woff2");unicode-range:U+0-FF}@font-face{font-family:"Noto Sans SC Variable";src:url("/tree.woff2");unicode-range:U+2500-257F}@font-face{font-family:"Noto Sans SC Variable";src:url("/label.woff2");unicode-range:U+540C}@font-face{font-family:"Noto Sans SC Variable";src:url("/other.woff2");unicode-range:U+4E16}',
        'island.js': 'export const label="\\u540c";',
        'latin.woff2': 'x',
        'tree.woff2': 'x',
        'label.woff2': 'x',
        'other.woff2': 'x',
      }),
    );
    const urls = report.pageResources['https://site.test/'];
    expect(urls).toEqual(
      expect.arrayContaining(['https://site.test/tree.woff2', 'https://site.test/label.woff2']),
    );
    expect(urls).not.toContain('https://site.test/other.woff2');
    expect(report.diagnostics).toEqual([]);
  });

  it('includes version source data only for the actual comparison component', async () => {
    const props = JSON.stringify({ versions: [1, [{ sourceHref: [0, '/compare/data/1.json'] }]] });
    const island = (component: string) =>
      `<astro-island component-url="/${component}.js" props='${props}'></astro-island>`;
    const report = await createResourceInventory(
      await fixture(
        {
          'compare/index.html': island('comparison'),
          'other/index.html': island('other'),
          'comparison.js': '',
          'other.js': '',
          'compare/data/1.json': '{"source":"One version"}',
        },
        {
          comparison: {
            file: 'comparison.js',
            src: 'src/features/article/components/VersionComparison.tsx',
          },
          other: { file: 'other.js', src: 'src/Other.tsx' },
        },
      ),
    );
    expect(report.pageResources['https://site.test/compare/']).toContain(
      'https://site.test/compare/data/1.json',
    );
    expect(report.pageResources['https://site.test/other/']).not.toContain(
      'https://site.test/compare/data/1.json',
    );
    expect(report.diagnostics).toEqual([]);
  });

  it('preserves query strings, resolves CSS relative to its stylesheet, and avoids network access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Must not make requests');
      }),
    );
    const report = await createResourceInventory(
      await fixture({
        'index.html':
          '<base href="/assets/"><link rel="stylesheet" href="site.css?v=1#one"><img src="https://cdn.test/a.webp">',
        'assets/site.css': '.x{background:url("../image.webp")}',
        'image.webp': 'x',
      }),
    );
    expect(report.pageResources['https://site.test/']).toEqual(
      expect.arrayContaining([
        'https://site.test/assets/site.css?v=1',
        'https://site.test/image.webp',
      ]),
    );
    expect(
      report.resources.find((resource) => resource.url === 'https://cdn.test/a.webp'),
    ).toMatchObject({ external: true, file: null, bytes: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('scopes Pagefind output to the page language and selected metadata hash', async () => {
    const files = {
      'en/search/index.html':
        '<pagefind-config bundle-path="/pagefind/" lang="en" meta-cache-tag="test-build">',
      'zh/search/index.html':
        '<pagefind-config bundle-path="/pagefind/" lang="zh-cn" meta-cache-tag="test-build">',
      'article/index.html': '<title>Article</title>',
      'pagefind/fallback-ui.js': '',
      'pagefind/pagefind-component-ui.js': 'const source = "pagefind.js";',
      'pagefind/pagefind.js':
        'const backgroundScript = "pagefind-worker.js"; new Worker( backgroundScript );',
      'pagefind/pagefind-worker.js': '',
      'pagefind/pagefind-ui.js': 'import(legacyUiPath);',
      'pagefind/pagefind-modular-ui.js': 'import(modularUiPath);',
      'pagefind/pagefind-entry.json': JSON.stringify({
        languages: {
          en: { hash: 'enhash', page_count: 2, wasm: null },
          'zh-cn': { hash: 'zhhash', page_count: 1, wasm: null },
        },
      }),
      'pagefind/pagefind.enhash.pf_meta': '',
      'pagefind/pagefind.zhhash.pf_meta': '',
      'pagefind/wasm.unknown.pagefind': '',
      'pagefind/index/en_a.pf_index': '',
      'pagefind/index/en_b.pf_index': '',
      'pagefind/fragment/en_a.pf_fragment': '',
      'pagefind/fragment/en_b.pf_fragment': '',
      'pagefind/index/zh-cn_a.pf_index': '',
      'pagefind/fragment/zh-cn_a.pf_fragment': '',
    };
    const input = await fixture(files);
    const report = await createResourceInventory(input);
    const english = report.pageResources['https://site.test/en/search/'];
    const chinese = report.pageResources['https://site.test/zh/search/'];
    expect(english).toEqual(
      expect.arrayContaining([
        'https://site.test/pagefind/pagefind.enhash.pf_meta',
        'https://site.test/pagefind/fragment/en_a.pf_fragment',
        'https://site.test/pagefind/pagefind-worker.js',
      ]),
    );
    expect(english).not.toContain('https://site.test/pagefind/fragment/zh-cn_a.pf_fragment');
    expect(chinese).toContain('https://site.test/pagefind/fragment/zh-cn_a.pf_fragment');
    expect(chinese).not.toContain('https://site.test/article/');
    expect(chinese).not.toContain('https://site.test/pagefind/fallback-ui.js');
    expect(english).not.toContain('https://site.test/pagefind/pagefind-ui.js');
    expect(report.diagnostics).toEqual([]);

    // Missing one shard must fail even while other shards still exist.
    for (const file of [
      'pagefind/fragment/en_a.pf_fragment',
      'pagefind/index/en_a.pf_index',
      'pagefind/pagefind-worker.js',
    ] as const) {
      await rm(join(input.directory, file));
      await expect(createResourceInventory(input)).rejects.toThrow(`Missing: ${file}`);
      await writeFile(join(input.directory, file), files[file]);
    }
    // Do not blanket-hide unresolved modules merely because they have no page owner.
    const unhandled = await createResourceInventory(
      await fixture({ ...files, 'unrelated.js': 'import(unknownPath);' }),
    );
    expect(unhandled.diagnostics).toEqual([
      expect.objectContaining({ level: 'warning', url: 'https://site.test/unrelated.js' }),
    ]);
  });

  it('rejects changed non-HTML assets and deployment configuration', async () => {
    const files = {
      'index.html': '<title>Snapshot</title>',
      'site.css': 'body{color:red}',
      'site.js': 'export {};',
      'image.webp': 'original image',
      _headers: 'original headers',
    };
    const input = await fixture(files);
    for (const file of ['site.css', 'site.js', 'image.webp', '_headers'] as const) {
      await writeFile(join(input.directory, file), 'changed');
      await expect(createResourceInventory(input)).rejects.toThrow(`${file} has changed`);
      await writeFile(join(input.directory, file), files[file]);
    }
    const oldMetadata = { ...input.buildInfo, fileHashes: undefined };
    await expect(createResourceInventory({ ...input, buildInfo: oldMetadata })).rejects.toThrow(
      'Missing final',
    );
  });

  it('reports missing resources and unresolved imports, and rejects stale inputs', async () => {
    const input = await fixture({
      'index.html': '<script type="module">import(variable)</script><img src="/missing.webp">',
    });
    const report = await createResourceInventory(input);
    expect(report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'error', url: 'https://site.test/missing.webp' }),
        expect.objectContaining({ level: 'warning', url: 'https://site.test/' }),
      ]),
    );
    await writeFile(join(input.directory, 'index.html'), '<title>New</title>');
    await expect(createResourceInventory(input)).rejects.toThrow('stale');
    const unknown = await createResourceInventory(
      await fixture(
        { 'index.html': '<script src="/_astro/a.js"></script>', '_astro/a.js': '' },
        { a: { file: '_astro/a.js', imports: ['missing'] } },
      ),
    );
    expect(unknown.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Unknown manifest dependency'),
        }),
      ]),
    );
    const oldPolicy = await fixture({ 'index.html': '<title>Old font policy</title>' });
    oldPolicy.buildInfo.fontPolicyHash = 'old';
    await expect(createResourceInventory(oldPolicy)).rejects.toThrow('Font rules do not match');
  });
});

describe('resource size accounting', () => {
  it('measures UTF-8 bytes and local Brotli output, leaving precompressed formats unchanged', async () => {
    const contents = Buffer.from('中文 resource content '.repeat(100));
    const compressed = brotliCompressSync(contents).byteLength;
    expect(compressed).toBeLessThan(contents.byteLength);
    for (const extension of ['html', 'css', 'js', 'json', 'svg', 'webmanifest', 'ttf', 'wasm']) {
      expect(await measureFileSizes(`resource.${extension}`, contents)).toEqual({
        bytes: contents.byteLength,
        brotliBytes: compressed,
      });
    }
    for (const extension of [
      'png',
      'webp',
      'woff',
      'woff2',
      'pf_fragment',
      'pf_index',
      'pagefind',
      'bin',
    ]) {
      expect(await measureFileSizes(`resource.${extension}`, contents)).toEqual({
        bytes: contents.byteLength,
        brotliBytes: contents.byteLength,
      });
    }
    const empty = Buffer.alloc(0);
    expect(await measureFileSizes('empty.js', empty)).toEqual({
      bytes: 0,
      brotliBytes: brotliCompressSync(empty).byteLength,
    });
  });

  it('deduplicates files across URL aliases and page totals, including unreferenced local files', async () => {
    const first =
      '<link rel="stylesheet" href="/shared.css?v=1"><link rel="stylesheet" href="/shared.css?v=2"><a href="/a/index.html" download>Save</a>';
    const second = '<link rel="stylesheet" href="/shared.css?v=1">';
    const css = 'body { color: red; }';
    const files = {
      'a/index.html': first,
      'b/index.html': second,
      'shared.css': css,
      'unreferenced.txt': 'unreferenced',
    };
    const report = await createResourceInventory(await fixture(files));
    expect(report.sizeTotals).toEqual({
      files: 4,
      unknownResources: 0,
      knownBytes: Object.values(files).reduce((sum, source) => sum + Buffer.byteLength(source), 0),
      knownBrotliBytes: Object.values(files).reduce(
        (sum, source) => sum + brotliCompressSync(source).byteLength,
        0,
      ),
    });
    for (const [page, source] of [
      ['a', first],
      ['b', second],
    ]) {
      expect(report.pageSizeTotals[`https://site.test/${page}/`]).toEqual({
        files: 2,
        unknownResources: 0,
        knownBytes: Buffer.byteLength(source) + Buffer.byteLength(css),
        knownBrotliBytes:
          brotliCompressSync(source).byteLength + brotliCompressSync(css).byteLength,
      });
    }
    const aliases = report.resources.filter((resource) => resource.file === 'shared.css');
    expect(aliases).toHaveLength(3);
    expect(new Set(aliases.map((resource) => resource.brotliBytes)).size).toBe(1);
    const markdown = renderInventoryMarkdown(report);
    expect(markdown).toContain(
      `4 unique local files · Local size total: ${report.sizeTotals.knownBytes} B`,
    );
    expect(markdown).toContain(
      `2 unique local files · Local size total: ${report.pageSizeTotals['https://site.test/a/'].knownBytes} B`,
    );
    expect(markdown).toContain(
      `| ${Buffer.byteLength(css)} B | ${brotliCompressSync(css).byteLength} B | Local |`,
    );
  });

  it('keeps external and missing sizes unknown in both JSON and Markdown totals', async () => {
    const html =
      '<img src="https://cdn.test/external.webp"><img src="/missing.webp"><img src="/missing.webp">';
    const report = await createResourceInventory(await fixture({ 'index.html': html }));
    const expected = {
      files: 1,
      unknownResources: 2,
      knownBytes: Buffer.byteLength(html),
      knownBrotliBytes: brotliCompressSync(html).byteLength,
    };
    expect(report.sizeTotals).toEqual(expected);
    expect(report.pageSizeTotals['https://site.test/']).toEqual(expected);
    for (const resource of report.resources.filter((resource) => resource.file === null)) {
      expect(resource.bytes).toBeNull();
      expect(resource.brotliBytes).toBeNull();
    }
    const markdown = renderInventoryMarkdown(report);
    expect(markdown).toContain(`Local size total: ${expected.knownBytes} B + 2 unknown`);
    expect(markdown).toContain(
      `Brotli size total (local): ${expected.knownBrotliBytes} B + 2 unknown`,
    );
    expect(markdown).toContain('| Unknown | Unknown | External |');
    expect(markdown).toContain('| Unknown | Unknown | Missing local file |');
  });
});

describe('resource inventory CLI publication', () => {
  async function runCli(failure?: 'analysis' | 'diagnostics' | 'write') {
    const report = {
      pages: [],
      resources: [],
      diagnostics:
        failure === 'diagnostics'
          ? [{ level: 'error', url: 'https://site.test/missing', message: 'Missing file' }]
          : [],
    };
    let writes = 0;
    const fs = {
      mkdir: vi.fn(async (..._args: unknown[]) => undefined),
      readFile: vi.fn(async (..._args: unknown[]) => '{}'),
      rename: vi.fn(async (..._args: unknown[]) => undefined),
      rm: vi.fn(async (..._args: unknown[]) => undefined),
      writeFile: vi.fn(async (..._args: unknown[]) => {
        if (++writes === 2 && failure === 'write') throw new Error('disk full');
      }),
    };
    vi.resetModules();
    vi.doMock('node:fs/promises', () => fs);
    vi.doMock('../../../apps/site/tools/resource-inventory/build-info.mjs', () => ({
      buildInfoUrl: new URL('file:///tmp/build-info.json'),
    }));
    vi.doMock('../../../apps/site/tools/resource-inventory/inventory.mjs', () => ({
      createResourceInventory: async () => {
        if (failure === 'analysis') throw new Error('analysis failed');
        return report;
      },
    }));
    vi.doMock('../../../apps/site/tools/resource-inventory/markdown.mjs', () => ({
      renderInventoryMarkdown: () => '# Report\n',
    }));
    const previousExitCode = process.exitCode;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await import('../../../apps/site/tools/resource-inventory/cli.mjs');
      return { fs, exitCode: process.exitCode };
    } finally {
      process.exitCode = previousExitCode;
      error.mockRestore();
      log.mockRestore();
      vi.doUnmock('node:fs/promises');
      vi.doUnmock('../../../apps/site/tools/resource-inventory/build-info.mjs');
      vi.doUnmock('../../../apps/site/tools/resource-inventory/inventory.mjs');
      vi.doUnmock('../../../apps/site/tools/resource-inventory/markdown.mjs');
      vi.resetModules();
    }
  }

  it.each(['analysis', 'diagnostics'] as const)(
    'preserves existing reports on %s failure',
    async (failure) => {
      const { fs, exitCode } = await runCli(failure);
      expect(exitCode).toBe(1);
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
      expect(fs.rm).not.toHaveBeenCalled();
    },
  );

  it('prepares both files before publishing either report', async () => {
    const { fs } = await runCli();
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(fs.rename).toHaveBeenCalledTimes(2);
    expect(fs.writeFile.mock.calls.every(([url]) => String(url).includes('.tmp-'))).toBe(true);
    expect(Math.max(...fs.writeFile.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...fs.rename.mock.invocationCallOrder),
    );
    expect(String(fs.rename.mock.calls[0][1])).toMatch(/resource-inventory\.json$/);
    expect(String(fs.rename.mock.calls[1][1])).toMatch(/resource-inventory\.md$/);
  });

  it('cleans temporary files without replacing reports after a write failure', async () => {
    const { fs, exitCode } = await runCli('write');
    expect(exitCode).toBe(1);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.rm).toHaveBeenCalledTimes(2);
    expect(fs.rm.mock.calls.every(([url]) => String(url).includes('.tmp-'))).toBe(true);
  });
});

describe('readable resource inventory', () => {
  it('renders indexed Markdown without mutating the report', async () => {
    const report = await createResourceInventory(
      await fixture({
        'index.html': '<title>Draft | &lt;unsafe&gt; [note]</title><img src="/missing.webp">',
      }),
    );
    report.diagnostics.push({
      level: 'warning',
      url: 'https://site.test/',
      message: '<warning> | [details]\nnext line',
    });
    const original = JSON.stringify(report);
    const markdown = renderInventoryMarkdown(report);
    for (const heading of ['Pages', 'Resources', 'Page resources', 'Resource pages', 'Diagnostics'])
      expect(markdown).toContain(`## ${heading}\n`);
    expect(markdown).toContain('Referenced resources');
    expect(markdown).toContain('Referenced pages');
    expect(markdown).toContain('Local size total');
    expect(markdown).toContain('Brotli size (local)');
    expect(markdown).not.toContain('Sizes are local file sizes, not compressed transfer sizes.');
    expect(markdown).not.toMatch(/Direct pages|Candidate pages/);
    expect(markdown).toContain('Draft \\| &lt;unsafe&gt; \\[note\\]');
    expect(markdown).toContain('&lt;warning&gt; \\| \\[details\\] next line');
    expect(markdown).not.toContain('<unsafe>');
    expect(JSON.stringify(report)).toBe(original);
    expect(renderInventoryMarkdown(report)).toBe(markdown);
  });
});
