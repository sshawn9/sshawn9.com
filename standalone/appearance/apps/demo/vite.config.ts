import { defineConfig } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Deliberate local failure fixtures only. The package knows nothing about them.
// Explicit 503 responses keep the HTTP-failure case distinct from a successful
// HTTP response whose image bytes fail decoding.
function failureFixtures(request: IncomingMessage, response: ServerResponse, next: () => void) {
  const path = request.url?.split('?')[0];
  if (path === '/wallpapers/not-an-image.txt') {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'image/svg+xml');
    response.setHeader('Cache-Control', 'no-store');
    response.end('Deliberately invalid SVG bytes for Image.decode failure.');
    return;
  }
  if (
    path === '/wallpapers/deliberately-missing.svg' ||
    path === '/fonts/deliberately-missing.ttf'
  ) {
    response.statusCode = 503;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.end('Intentional Appearance demo request failure.');
    return;
  }
  next();
}

export default defineConfig({
  build: { assetsInlineLimit: 0 },
  server: { host: '127.0.0.1', port: 4477, strictPort: true },
  preview: { host: '127.0.0.1', port: 4477, strictPort: true },
  plugins: [
    {
      name: 'appearance-demo-failure-fixtures',
      configureServer(server) {
        server.middlewares.use(failureFixtures);
      },
      configurePreviewServer(server) {
        server.middlewares.use(failureFixtures);
      },
    },
  ],
});
