import { defineConfig } from 'astro/config';
import { createSiteConfig } from './config/create-site-config.mjs';
import contentHealthToolbar from './devtools/content-health/integration.ts';

const wallpaperApiOrigin = new URL(process.env.SITE_WALLPAPER_API_ORIGIN ?? 'https://sshawn9.com')
  .origin;

export default defineConfig({
  ...createSiteConfig({
    integrations: [contentHealthToolbar()],
    viteServer: {
      strictPort: true,
      // Vite preview inherits this proxy and strictPort from server options.
      proxy: {
        '^/api/wallpapers(?:/download)?(?:\\?.*)?$': {
          target: wallpaperApiOrigin,
          changeOrigin: true,
          // The Worker requires same-origin download reports; this hop targets its origin.
          headers: { Origin: wallpaperApiOrigin },
        },
      },
    },
  }),
  // Astro checks trailing slashes before the proxy in both dev and preview.
  // Only local servers relax that guard; builds retain the shared `always` policy.
  trailingSlash: 'ignore',
});
