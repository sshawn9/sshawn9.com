/**
 * Resolve the Pagefind files owned by one search page from its generated entry.
 * This intentionally follows Pagefind 1.5.2's documented/generated contract,
 * rather than treating every file under the bundle directory as search data.
 */

export const unusedSearchModules = ['pagefind-ui.js', 'pagefind-modular-ui.js'];

function fail(message) {
  throw new Error(`Resource inventory: Pagefind ${message}`);
}

function bundleDirectory(bundlePath) {
  if (typeof bundlePath !== 'string' || !bundlePath.startsWith('/')) {
    fail('bundle-path must be an absolute site path.');
  }
  const url = new URL(bundlePath, 'https://inventory.invalid');
  if (url.search || url.hash || url.pathname.includes('..')) {
    fail('bundle-path must not contain a query, hash, or parent segment.');
  }
  return url.pathname.replace(/^\/+|\/+$/g, '');
}

function requireFile(files, file) {
  if (!files.has(file)) fail(`output is missing: /${file}`);
  return file;
}

function selectLanguage(languages, language) {
  if (!languages || typeof languages !== 'object' || Array.isArray(languages)) {
    fail('entry does not contain a languages object.');
  }
  const exact = [language, languages[language]];
  const primaryKey = language.split('-', 1)[0];
  const primary = [primaryKey, languages[primaryKey]];
  const candidates = Object.entries(languages).filter(
    ([, entry]) => entry && typeof entry === 'object' && Number.isFinite(entry.page_count),
  );
  // This is Pagefind 1.5.2's findIndex order: exact language, primary
  // language, then the largest index. Keep the selected language key: shard
  // result IDs use that key, while entry.hash only names the metadata file.
  const selected =
    exact[1] !== undefined
      ? exact
      : primary[1] !== undefined
        ? primary
        : candidates.sort(([, a], [, b]) => b.page_count - a.page_count)[0];
  const [key, index] = selected ?? [];
  if (
    typeof key !== 'string' ||
    !/^[A-Za-z0-9-]+$/.test(key) ||
    !index ||
    typeof index !== 'object' ||
    typeof index.hash !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(index.hash) ||
    !Number.isInteger(index.page_count) ||
    index.page_count < 0
  ) {
    fail(`entry has no usable language index for ${JSON.stringify(language)}.`);
  }
  if (index.wasm !== null && typeof index.wasm !== 'string') {
    fail(`language index ${JSON.stringify(language)} has an invalid wasm value.`);
  }
  return { key, index };
}

/**
 * Returns Pagefind resources associated with a specific search page. `files`
 * are the already verified final build paths; `read` returns their final bytes.
 * The inventory validates the complete file list and hashes before calling adapters.
 */
export async function searchResourceUrls({ config, files, read }) {
  const { bundlePath, language, cacheTag } = config ?? {};
  if (typeof language !== 'string' || !language) fail('config language is required.');
  if (cacheTag !== null && cacheTag !== undefined && typeof cacheTag !== 'string') {
    fail('config cache tag must be a string or null.');
  }
  if (typeof read !== 'function') fail('requires a read(file) function.');

  const directory = bundleDirectory(bundlePath);
  if (!directory) fail('bundle-path must name a directory.');
  const knownFiles = new Set(files);
  const entryFile = requireFile(knownFiles, `${directory}/pagefind-entry.json`);
  let entry;
  try {
    entry = JSON.parse((await read(entryFile)).toString('utf8'));
  } catch (error) {
    fail(`entry cannot be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    fail('entry must be a JSON object.');
  }
  const selected = selectLanguage(entry.languages, language);
  const { key: languageKey, index } = selected;
  const hash = index.hash;

  // These are the runtime files shipped by the selected Pagefind component UI.
  // Their ownership does not depend on minification, variable names or spacing.
  const runtime = ['pagefind-component-ui.js', 'pagefind.js', 'pagefind-worker.js'].map((file) =>
    requireFile(knownFiles, `${directory}/${file}`),
  );

  const meta = requireFile(knownFiles, `${directory}/pagefind.${hash}.pf_meta`);
  const indexPrefix = `${directory}/index/${languageKey}_`;
  const fragmentPrefix = `${directory}/fragment/${languageKey}_`;
  const indexes = [...knownFiles].filter(
    (file) => file.startsWith(indexPrefix) && file.endsWith('.pf_index'),
  );
  const fragments = [...knownFiles].filter(
    (file) => file.startsWith(fragmentPrefix) && file.endsWith('.pf_fragment'),
  );
  if (index.page_count > 0 && (!indexes.length || !fragments.length)) {
    fail(`language index ${JSON.stringify(language)} is missing index or fragment data.`);
  }
  const wasm = requireFile(knownFiles, `${directory}/wasm.${index.wasm ?? 'unknown'}.pagefind`);
  const entryUrl = `/${entryFile}${cacheTag ? `?ts=${encodeURIComponent(cacheTag)}` : ''}`;
  return [entryUrl, ...runtime, meta, wasm, ...indexes.sort(), ...fragments.sort()].map((file) =>
    file.startsWith('/') ? file : `/${file}`,
  );
}
