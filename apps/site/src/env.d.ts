/// <reference types="astro/client" />

declare const __SITE_BUILD_ID__: string;

declare module 'virtual:site-initial-document-script' {
  const source: string;
  export default source;
}

declare module 'virtual:site-locale-entry-script' {
  const source: string;
  export default source;
}

declare module 'virtual:site-fallback-locale-script' {
  const source: string;
  export default source;
}
