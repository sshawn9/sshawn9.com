import type { AstroIntegration } from 'astro';

const APP_ID = 'sshawn9:drafts-only';
const DATA_EVENT = `${APP_ID}:data`;
const LOCALES = ['en', 'zh'] as const;

const icon = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 3.75h7.5L18 8.25v12H6v-16.5Z" stroke="white" stroke-width="1.75" stroke-linejoin="round"/>
    <path d="M13.5 3.75v4.5H18M9 12h6M9 15.5h4" stroke="white" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

export default function draftToolbar(): AstroIntegration {
  return {
    name: 'sshawn9:draft-toolbar',
    hooks: {
      'astro:config:setup': ({ command, addDevToolbarApp }) => {
        if (command !== 'dev') return;

        addDevToolbarApp({
          id: APP_ID,
          name: 'Drafts',
          icon,
          entrypoint: new URL('./app.ts', import.meta.url),
        });
      },
      'astro:server:setup': ({ server, toolbar, logger }) => {
        toolbar.onAppToggled(APP_ID, ({ state }) => {
          if (!state) return;

          void (async () => {
            try {
              const { getVisibleArticles } = (await server.ssrLoadModule(
                '/src/lib/articles.ts',
              )) as typeof import('../../lib/articles');
              const groups = await Promise.all(
                LOCALES.map(async (locale) => ({
                  locale,
                  drafts: (await getVisibleArticles(locale))
                    .filter(({ current }) => current.entry.data.draft)
                    .map(({ id, current }) => ({
                      title: current.entry.data.title,
                      href: `/${locale}/blog/${id}/`,
                    })),
                })),
              );

              toolbar.send(DATA_EVENT, { groups });
            } catch (error) {
              logger.error(
                `Unable to load draft articles: ${error instanceof Error ? error.message : String(error)}`,
              );
              toolbar.send(DATA_EVENT, { error: 'Unable to load draft articles.' });
            }
          })();
        });
      },
    },
  };
}
