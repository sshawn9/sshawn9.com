import { defineConfig } from 'astro/config';
import { createSiteConfig } from './config/create-site-config.mjs';
import contentHealthToolbar from './devtools/content-health/integration.ts';

export default defineConfig({
  ...createSiteConfig({
    integrations: [contentHealthToolbar()],
    viteServer: {
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
  }),
  // Astro's page-level trailing-slash guard runs before Vite's proxy middleware.
  // Development must therefore ignore that guard so extensionless Worker API paths
  // can reach the proxy. Production keeps the shared config's `always` policy.
  trailingSlash: 'ignore',
});
