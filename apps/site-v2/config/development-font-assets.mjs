import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CONTENT_ADDRESSED_FONT_PATH = /^\/_astro\/fonts\/.+-[a-f0-9]{16}\.(?:woff2?|ttf|otf)$/i;
const FONT_URL_IN_CSS = /url\((['"]?)([^)'"?]+\.(?:woff2?|ttf|otf))\1\)/gi;
const VERSIONED_FONT_PACKAGES = ['@fontsource-variable/noto-sans-sc', 'katex'].map((name) => ({
  name,
  pathSegment: `/node_modules/${name}/`,
  version: require(`${name}/package.json`).version,
}));

function escapeForRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isContentAddressedFontRequest(requestUrl) {
  if (!requestUrl) return false;

  try {
    return CONTENT_ADDRESSED_FONT_PATH.test(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return false;
  }
}

function fontPackageForModule(moduleId) {
  const normalizedId = moduleId.split('?', 1)[0].replaceAll('\\', '/');
  return VERSIONED_FONT_PACKAGES.find(({ pathSegment }) => normalizedId.includes(pathSegment));
}

function versionDependencyFontUrls(source, moduleId) {
  const sourcePackage = fontPackageForModule(moduleId);
  let versionedSource = sourcePackage
    ? source.replace(
        FONT_URL_IN_CSS,
        (_, quote, fontUrl) =>
          `url(${quote}${fontUrl}?v=${encodeURIComponent(sourcePackage.version)}${quote})`,
      )
    : source;

  // Vite can inline imported styles into their entry stylesheet before this
  // hook runs. Match those resolved /@fs/ URLs by package ownership as well.
  for (const fontPackage of VERSIONED_FONT_PACKAGES) {
    const resolvedFontPath = new RegExp(
      `(${escapeForRegularExpression(fontPackage.pathSegment)}[^'"()\\s?]+\\.(?:woff2|woff|ttf|otf))(?![a-z0-9]|\\?v=)`,
      'gi',
    );
    versionedSource = versionedSource.replace(
      resolvedFontPath,
      `$1?v=${encodeURIComponent(fontPackage.version)}`,
    );
  }

  return versionedSource;
}

function isVersionedDependencyFontRequest(requestUrl) {
  if (!requestUrl) return false;

  try {
    const url = new URL(requestUrl, 'http://localhost');
    return VERSIONED_FONT_PACKAGES.some(
      ({ pathSegment, version }) =>
        url.pathname.includes(pathSegment) &&
        url.searchParams.get('v') === version &&
        /\.(?:woff2?|ttf|otf)$/i.test(url.pathname),
    );
  } catch {
    return false;
  }
}

function isImmutableFontRequest(requestUrl) {
  return isContentAddressedFontRequest(requestUrl) || isVersionedDependencyFontRequest(requestUrl);
}

/**
 * Production already content-hashes all font assets. Development does not:
 * Astro disables caching for its hashed font route, while dependency fonts use
 * stable paths that Vite revalidates. Give both kinds an explicit URL identity
 * before marking only those responses immutable. Other Vite resources retain
 * their ordinary development caching and HMR semantics.
 */
export function developmentFontAssets() {
  return [
    {
      name: 'site:version-dependency-font-urls',
      apply: 'serve',
      enforce: 'post',
      transform(source, moduleId) {
        const versionedSource = versionDependencyFontUrls(source, moduleId);
        return versionedSource === source ? undefined : { code: versionedSource, map: null };
      },
    },
    {
      name: 'site:cache-immutable-font-responses',
      apply: 'serve',
      enforce: 'pre',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!isImmutableFontRequest(request.url)) {
            next();
            return;
          }

          const setHeader = response.setHeader;
          response.setHeader = function setImmutableFontHeader(name, value) {
            const normalizedName = String(name).toLowerCase();
            if (normalizedName === 'cache-control') {
              return setHeader.call(this, name, 'public, max-age=31536000, immutable');
            }
            if (normalizedName === 'pragma' || normalizedName === 'expires') {
              return this;
            }
            return setHeader.call(this, name, value);
          };
          response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          next();
        });
      },
    },
  ];
}
