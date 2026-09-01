import type { AstroIntegration } from 'astro';
import { analyzeArticleEntries } from './diagnostics.ts';
import {
  DRAFTS_APP_ID,
  DRAFTS_DATA_EVENT,
  SINGLE_LANGUAGE_APP_ID,
  SINGLE_LANGUAGE_DATA_EVENT,
  type ContentHealthMessage,
} from './contract.ts';

const draftsIcon = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 3.75h7.5L18 8.25v12H6V3.75Z" stroke="white" stroke-width="1.75" stroke-linejoin="round"/>
    <path d="M13.5 3.75v4.5H18M9 12h6M9 15.5h4" stroke="white" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

const singleLanguageIcon = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8.25" stroke="white" stroke-width="1.75"/>
    <path d="M3.75 12h16.5M12 3.75c2.1 2.25 3.25 5.1 3.25 8.25S14.1 18 12 20.25C9.9 18 8.75 15.15 8.75 12S9.9 6 12 3.75Z" stroke="white" stroke-width="1.75" stroke-linecap="round"/>
  </svg>
`;

const toolbarApps = [
  {
    id: DRAFTS_APP_ID,
    name: 'Drafts',
    icon: draftsIcon,
    entrypoint: new URL('./drafts-app.ts', import.meta.url),
    dataEvent: DRAFTS_DATA_EVENT,
  },
  {
    id: SINGLE_LANGUAGE_APP_ID,
    name: 'Single-language',
    icon: singleLanguageIcon,
    entrypoint: new URL('./single-language-app.ts', import.meta.url),
    dataEvent: SINGLE_LANGUAGE_DATA_EVENT,
  },
] as const;

export default function contentHealthToolbar(): AstroIntegration {
  return {
    name: 'sshawn9:content-health-toolbar',
    hooks: {
      'astro:config:setup': ({ command, addDevToolbarApp }) => {
        if (command !== 'dev') return;

        for (const { id, name, icon, entrypoint } of toolbarApps) {
          addDevToolbarApp({ id, name, icon, entrypoint });
        }
      },
      'astro:server:setup': ({ server, toolbar, logger }) => {
        for (const { id, dataEvent } of toolbarApps) {
          toolbar.onAppToggled(id, ({ state }) => {
            if (!state) return;

            void (async () => {
              try {
                const { loadArticleEntries } = (await server.ssrLoadModule(
                  '/src/content/article-source.ts',
                )) as typeof import('../../src/content/article-source.ts');
                const report = analyzeArticleEntries(await loadArticleEntries());
                toolbar.send<ContentHealthMessage>(dataEvent, {
                  status: 'ready',
                  report,
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`Unable to inspect article content: ${message}`);
                toolbar.send<ContentHealthMessage>(dataEvent, {
                  status: 'error',
                  message: 'Unable to inspect article content.',
                });
              }
            })();
          });
        }
      },
    },
  };
}
