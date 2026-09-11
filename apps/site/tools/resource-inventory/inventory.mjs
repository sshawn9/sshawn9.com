import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  readStylesheet,
  readHtmlReferences,
  readModuleReferences,
  readModuleText,
} from './references.mjs';
import { createSiteReferences } from './site-references.mjs';
import { fontResourceUrls } from './fonts.mjs';
import { fontPolicyUrl, listBuildFiles } from './build-info.mjs';
import { compressionPolicy, measureFileSizes, sumFileSizes } from './sizes.mjs';

const fileTypes = {
  '.html': 'html',
  '.css': 'css',
  '.js': 'js',
  '.mjs': 'js',
  '.woff2': 'font',
  '.woff': 'font',
  '.ttf': 'font',
  '.otf': 'font',
  '.svg': 'image',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.avif': 'image',
  '.gif': 'image',
  '.ico': 'image',
  '.mp4': 'media',
  '.webm': 'media',
  '.mp3': 'media',
  '.ogg': 'media',
};
const deploymentFiles = new Set(['_headers', '_redirects', '_worker.js']);

function publicPath(file) {
  const pathname = '/' + file.split('/').map(encodeURIComponent).join('/');
  if (pathname.endsWith('/index.html')) return pathname.slice(0, -10);
  if (pathname.endsWith('.html')) return pathname.slice(0, -5);
  return pathname;
}

function resolveReference(value, base) {
  if (!value || value.startsWith('#')) return null;
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  url.hash = '';
  return url.href;
}

/** Reads one completed build. No network requests, build execution, or writes to dist. */
export async function createResourceInventory({ directory, buildInfo }) {
  const { site, buildId, mode, manifest, fileHashes, fontPolicyHash } = buildInfo;
  if (!site || !buildId || !manifest || !fileHashes || !Object.keys(fileHashes).length) {
    throw new Error('Missing final resource-inventory build information. Run npm run build first.');
  }
  const currentFontPolicy = createHash('sha256')
    .update(await readFile(fontPolicyUrl))
    .digest('hex');
  if (fontPolicyHash !== currentFontPolicy) {
    throw new Error('Font rules do not match the recorded build. Run npm run build first.');
  }
  const origin = new URL(site).origin;
  const outputFiles = await listBuildFiles(directory);
  const outputFileSet = new Set(outputFiles);
  const missing = Object.keys(fileHashes).filter((file) => !outputFileSet.has(file));
  const unexpected = outputFiles.filter((file) => !Object.hasOwn(fileHashes, file));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Build file list does not match the recorded build. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}. Run npm run build again.`,
    );
  }
  const files = outputFiles.filter((file) => !deploymentFiles.has(file));
  const fileSet = new Set(files);
  const contents = new Map();
  async function read(file) {
    if (!contents.has(file)) contents.set(file, readFile(join(directory, file)));
    return contents.get(file);
  }
  for (const file of outputFiles) {
    const digest = createHash('sha256')
      .update(await read(file))
      .digest('hex');
    if (digest !== fileHashes[file]) {
      throw new Error(`Build information is stale: ${file} has changed. Run npm run build again.`);
    }
  }

  const resources = new Map();
  const graph = new Map();
  const stylesheetData = new Map();
  const pageData = new Map();
  const moduleTexts = new Map();
  const fileSizes = new Map();
  const siteRules = createSiteReferences({ files, manifest, read, site });
  const diagnostics = [];
  const diagnosticKeys = new Set();
  function diagnose(level, url, message) {
    const key = JSON.stringify([level, url, message]);
    if (diagnosticKeys.has(key)) return;
    diagnosticKeys.add(key);
    diagnostics.push({ level, url, message });
  }
  function fileFor(url) {
    const parsed = new URL(url);
    if (parsed.origin !== origin) return null;
    const pathname = decodeURIComponent(parsed.pathname).replace(/^\//, '');
    return (
      [
        pathname,
        `${pathname.replace(/\/$/, '')}/index.html`,
        `${pathname}.html`,
        ...(pathname ? [] : ['index.html']),
      ].find((file) => fileSet.has(file)) ?? null
    );
  }
  async function register(url) {
    if (resources.has(url)) return;
    const external = new URL(url).origin !== origin;
    const file = fileFor(url);
    const type = fileTypes[extname(file ?? new URL(url).pathname)] ?? 'data';
    if (file && !fileSizes.has(file)) {
      fileSizes.set(file, await measureFileSizes(file, await read(file)));
    }
    resources.set(url, {
      url,
      type,
      external,
      file,
      ...(file ? fileSizes.get(file) : { bytes: null, brotliBytes: null }),
    });
    if (!external && !file)
      diagnose('error', url, 'Referenced local file is missing from the build.');
  }
  async function addReferences(source, refs, base = source) {
    const outgoing = graph.get(source) ?? new Set();
    graph.set(source, outgoing);
    for (const ref of refs) {
      let url;
      try {
        url = resolveReference(ref, base);
      } catch {
        diagnose('error', source, `Invalid resource URL: ${ref}`);
        continue;
      }
      if (!url) continue;
      await register(url);
      outgoing.add(url);
    }
  }
  async function resolveStyle(style, base) {
    const faces = [];
    for (const face of style.faces) {
      const urls = face.urls.map((url) => resolveReference(url, base)).filter(Boolean);
      for (const url of urls) await register(url);
      faces.push({ ...face, urls });
    }
    return { faces, variables: style.variables };
  }

  for (const file of files) await register(new URL(publicPath(file), site).href);

  const chunks = new Map(
    Object.values(manifest).map((chunk) => [new URL('/' + chunk.file, site).href, chunk]),
  );
  for (const [url, chunk] of chunks) {
    if (!fileFor(url)) {
      diagnose('error', url, 'A recorded client output is missing from this build.');
      continue;
    }
    const refs = [];
    for (const key of ['imports', 'dynamicImports']) {
      for (const dependency of chunk[key] ?? []) {
        const target = manifest[dependency];
        if (!target) {
          diagnose('error', url, `Unknown manifest dependency: ${dependency}`);
          continue;
        }
        refs.push('/' + target.file);
      }
    }
    for (const dependency of chunk.css ?? []) refs.push('/' + dependency);
    for (const dependency of chunk.assets ?? []) refs.push('/' + dependency);
    await addReferences(url, refs);
  }

  const pages = [];
  for (const file of files) {
    const url = new URL(publicPath(file), site).href;
    try {
      if (file.endsWith('.html')) {
        const document = await readHtmlReferences((await read(file)).toString());
        if (document.buildId && document.buildId !== buildId) {
          throw new Error('HTML build identity does not match the recorded build.');
        }
        pages.push({
          url,
          title: document.title,
          language: document.language,
          kind: file === '404.html' ? 'not-found' : file === 'index.html' ? 'locale-entry' : 'page',
        });
        const base = document.baseHref ? new URL(document.baseHref, url).href : url;
        const pageRules = await siteRules.readPage(document, base);
        await addReferences(url, document.references, base);
        await addReferences(url, pageRules.additionalReferences, base);
        pageData.set(url, {
          ...document,
          ...pageRules,
          base,
          styles: await Promise.all(document.styles.map((style) => resolveStyle(style, base))),
        });
        for (const message of document.warnings) diagnose('warning', url, message);
      } else if (file.endsWith('.css')) {
        const style = readStylesheet((await read(file)).toString());
        await addReferences(url, style.references);
        stylesheetData.set(url, await resolveStyle(style, url));
      } else if (/\.[cm]?js$/.test(file) && !chunks.has(url)) {
        const module = await readModuleReferences((await read(file)).toString());
        await addReferences(url, module.references);
        if (module.unresolved)
          diagnose('warning', url, 'Some module imports cannot be resolved statically.');
      } else if (file.endsWith('.webmanifest')) {
        const data = JSON.parse((await read(file)).toString());
        await addReferences(
          url,
          (data.icons ?? []).map((icon) => icon.src),
        );
      }
    } catch (error) {
      diagnose('error', url, `Resource analysis failed: ${error.message}`);
    }
  }

  function canonicalUrl(url) {
    const file = resources.get(url)?.file;
    return file ? new URL(publicPath(file), site).href : url;
  }
  /** @type {Record<string, string[]>} */
  const pageResources = {};
  for (const page of pages.sort((a, b) => a.url.localeCompare(b.url))) {
    const data = pageData.get(page.url);
    function collectResources(roots) {
      const reached = new Set();
      const pending = [...roots];
      while (pending.length) {
        const url = pending.pop();
        if (reached.has(url)) continue;
        reached.add(url);
        // Query variants remain distinct requests for the same physical file.
        for (const target of graph.get(canonicalUrl(url)) ?? []) {
          if (data?.excludedResources.has(target) && !graph.get(page.url)?.has(target)) continue;
          pending.push(target);
        }
      }
      return reached;
    }
    const reached = collectResources([page.url]);
    if (data) {
      try {
        const styles = [...reached]
          .map((url) => stylesheetData.get(canonicalUrl(url)))
          .filter(Boolean)
          .concat(data.styles);
        const extraText = [data.document.body.textContent];
        // Include fixed island props and version bodies, not linked destination pages.
        for (const island of data.islands) if (island.props) extraText.push(island.props);
        const islandResources = collectResources(
          data.islands
            .map((island) => resolveReference(island.componentUrl, data.base))
            .filter(Boolean),
        );
        for (const url of islandResources) {
          const resource = resources.get(url);
          if (resource?.type !== 'js' || !resource.file) continue;
          if (!moduleTexts.has(resource.file)) {
            moduleTexts.set(resource.file, readModuleText((await read(resource.file)).toString()));
          }
          extraText.push(moduleTexts.get(resource.file));
        }
        for (const url of reached) {
          if (data.textResources.has(url) && resources.get(url)?.file) {
            extraText.push((await read(resources.get(url).file)).toString());
          }
        }
        const fonts = fontResourceUrls({
          document: data.document,
          styles,
          extraText: extraText.join(' '),
          unrestrictedInput: data.unrestrictedInput,
        });
        for (const url of fonts) {
          await register(url);
          reached.add(url);
        }
      } catch (error) {
        diagnose('error', page.url, `Font ownership analysis failed: ${error.message}`);
      }
    }
    pageResources[page.url] = [...reached].sort();
  }
  /** @type {Record<string, string[]>} */
  const resourcePages = Object.fromEntries([...resources.keys()].sort().map((url) => [url, []]));
  for (const [page, urls] of Object.entries(pageResources)) {
    for (const url of urls) resourcePages[url].push(page);
  }
  // Site adapters account for known computed imports and unused bundled interfaces.
  const relevantDiagnostics = diagnostics.filter(
    (item) =>
      !(
        item.level === 'warning' &&
        item.message === 'Some module imports cannot be resolved statically.' &&
        siteRules.handlesUnresolvedModule(item.url, Boolean(resourcePages[item.url]?.length))
      ),
  );
  return {
    buildId,
    mode,
    site,
    scope:
      'Resources associated with each page and its in-page features, independent of loading time.',
    limitations: [
      'Associated resources need not all be requested on every visit. Cache measurements are not part of this report.',
      'Runtime fetches are not generally enumerable. Random wallpaper images and third-party iframe contents are not included.',
      'Font subsets follow the site font rules and known page text. Free-text search inputs include the full coverage of their declared font families.',
      'Font analysis includes declared fallback faces and fixed island script text; some font or UI-language alternatives may not be requested in one visit.',
      'Search includes the selected language index and result data, not destination article assets or unused search interfaces.',
      'Resources with no page references are not necessarily unused.',
      'The local output file list and SHA-256 hashes match the final recorded build; this does not verify a remote deployment.',
    ],
    pages,
    resources: [...resources.values()].sort((a, b) => a.url.localeCompare(b.url)),
    pageResources,
    resourcePages,
    compression: compressionPolicy,
    sizeTotals: sumFileSizes(resources.values()),
    pageSizeTotals: Object.fromEntries(
      Object.entries(pageResources).map(([page, urls]) => [
        page,
        sumFileSizes(urls.map((url) => resources.get(url))),
      ]),
    ),
    diagnostics: relevantDiagnostics.sort(
      (a, b) => a.url.localeCompare(b.url) || a.message.localeCompare(b.message),
    ),
  };
}
