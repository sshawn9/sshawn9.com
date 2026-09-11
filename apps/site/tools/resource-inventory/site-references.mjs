import { searchResourceUrls, unusedSearchModules } from './search-resources.mjs';

/** Resource ownership follows page features, not the timing of a browser request. */
export function createSiteReferences({ files, manifest, read, site }) {
  const galleryResources = new Set(
    Object.values(manifest)
      .filter((entry) => entry.src?.includes('/node_modules/photoswipe/'))
      .map((entry) => new URL('/' + entry.file, site).href),
  );
  const versionComponents = new Set(
    Object.values(manifest)
      .filter((entry) => entry.src === 'src/features/article/components/VersionComparison.tsx')
      .map((entry) => '/' + entry.file),
  );
  const handledModules = new Set();
  const unusedModules = new Set();

  // sourceHref is the site's version-data contract, not an Astro serialization tag.
  function collectSources(value, references, source = false) {
    if (typeof value === 'string') {
      if (source) references.push(value);
    } else if (Array.isArray(value)) {
      for (const child of value) collectSources(child, references, source);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value))
        collectSources(child, references, source || key === 'sourceHref');
    }
  }
  return {
    async readPage(document, base) {
      const additionalReferences = [];
      if (document.pagefind) {
        const references = await searchResourceUrls({ config: document.pagefind, files, read });
        additionalReferences.push(...references);
        for (const reference of references) {
          if (reference.endsWith('.js')) handledModules.add(new URL(reference, base).href);
        }
        const bundle = new URL(document.pagefind.bundlePath.replace(/\/+$/, '') + '/', base);
        for (const file of unusedSearchModules) unusedModules.add(new URL(file, bundle).href);
      }
      const versionSources = [];
      for (const island of document.islands) {
        if (!versionComponents.has(island.componentUrl) || !island.props) continue;
        try {
          collectSources(JSON.parse(island.props), versionSources);
        } catch (error) {
          throw new Error(
            'Cannot read version comparison sourceHref resources from island props.',
            {
              cause: error,
            },
          );
        }
      }
      additionalReferences.push(...versionSources);
      return {
        additionalReferences,
        textResources: new Set(versionSources.map((reference) => new URL(reference, base).href)),
        excludedResources: document.gallery ? new Set() : galleryResources,
        unrestrictedInput: Boolean(document.pagefind),
      };
    },
    handlesUnresolvedModule(url, referenced) {
      return (referenced && handledModules.has(url)) || (!referenced && unusedModules.has(url));
    },
  };
}
