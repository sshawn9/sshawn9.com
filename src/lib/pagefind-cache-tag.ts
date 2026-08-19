// Pagefind's component UI busts its `pagefind-entry.json` fetch with
// `Date.now()` on every instance init unless a `metaCacheTag` is supplied,
// which defeats HTTP caching entirely: leaving the search page and
// returning to it re-creates the Pagefind instance and re-fetches that file
// with a brand new, never-before-seen URL every time. Node/Vite evaluate a
// module's top level exactly once per `astro build` run, so this constant is
// identical across every page rendered in that run and changes only on the
// next build, giving the file a stable, cacheable URL for the lifetime of a
// deployment.
export const PAGEFIND_META_CACHE_TAG = Date.now().toString(36);
