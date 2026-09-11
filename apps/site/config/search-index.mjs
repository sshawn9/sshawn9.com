import { close, createIndex } from 'pagefind';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function throwIndexingErrors(action, { errors }) {
  if (errors.length) throw new Error(`Pagefind ${action} failed: ${errors.join('\n')}`);
}

export function pagefindBuild() {
  return {
    name: 'site-pagefind',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        try {
          const created = await createIndex();
          throwIndexingErrors('initialization', created);
          if (!created.index) throw new Error('Pagefind initialization did not return an index.');
          const index = created.index;

          const directory = fileURLToPath(dir);
          const indexed = await index.addDirectory({ path: directory });
          throwIndexingErrors('indexing', indexed);

          const written = await index.writeFiles({ outputPath: join(directory, 'pagefind') });
          throwIndexingErrors('writing files', written);
          logger.info(`Processed ${indexed.page_count} HTML files and wrote the search index.`);
        } finally {
          await close();
        }
      },
    },
  };
}
