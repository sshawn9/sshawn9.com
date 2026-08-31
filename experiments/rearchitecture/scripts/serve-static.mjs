import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { resolveStaticFile, sendNotFound, streamStaticFile } from './static-files.mjs';

const [directory, rawPort] = process.argv.slice(2);
if (!directory || !rawPort) {
  throw new Error('Usage: node scripts/serve-static.mjs <directory> <port>');
}

const root = resolve(directory);
const port = Number(rawPort);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const file = await resolveStaticFile(root, url.pathname);
  if (!file) {
    sendNotFound(response);
    return;
  }

  streamStaticFile(file, response);
});

server.listen(port, '127.0.0.1', () => {
  console.log('Serving ' + root + ' at http://127.0.0.1:' + String(port));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
