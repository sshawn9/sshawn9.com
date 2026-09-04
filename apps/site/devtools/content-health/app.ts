import { defineToolbarApp } from 'astro/toolbar';
import {
  type ContentHealthItem,
  type ContentHealthMessage,
  type ContentLocale,
  type ContentHealthReport,
} from './contract.ts';

type Placement = 'bottom-left' | 'bottom-center' | 'bottom-right';
type ToolbarWindow = Window & {
  __astro_dev_toolbar__?: { placement?: Placement };
};

type ContentListAppOptions = {
  title: string;
  ariaLabel: string;
  dataEvent: string;
  emptyMessage: string;
  items: (report: ContentHealthReport) => ContentHealthItem[];
  showMissingLocales?: boolean;
};

function currentLocale(): ContentLocale {
  const documentLocale = document.documentElement.dataset.locale;
  if (documentLocale === 'en' || documentLocale === 'zh') return documentLocale;
  return window.location.pathname.startsWith('/zh/') ? 'zh' : 'en';
}

function createBadge(label: string, variant?: 'warning'): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = variant ? `badge badge--${variant}` : 'badge';
  badge.textContent = label;
  return badge;
}

function createItem(item: ContentHealthItem, showMissingLocales: boolean): HTMLLIElement {
  const locale = currentLocale();
  const titleText = item.titles[locale];
  const listItem = document.createElement('li');
  listItem.className = 'content-item';

  const title = document.createElement('a');
  title.className = 'content-item__title';
  title.href = item.routes[locale];
  title.textContent = titleText;

  const metadata = document.createElement('div');
  metadata.className = 'content-item__metadata';
  metadata.append(createBadge(`v${item.version}${item.currentVersion ? ' · current' : ''}`));
  for (const availableLocale of item.availableLocales) {
    metadata.append(createBadge(availableLocale.toUpperCase()));
  }
  if (showMissingLocales) {
    for (const missingLocale of item.missingLocales) {
      metadata.append(createBadge(`missing ${missingLocale.toUpperCase()}`, 'warning'));
    }
  }

  const routes = document.createElement('nav');
  routes.className = 'content-item__routes';
  routes.setAttribute('aria-label', `Open ${titleText}`);
  for (const routeLocale of ['en', 'zh'] as const) {
    const link = document.createElement('a');
    link.href = item.routes[routeLocale];
    link.lang = routeLocale === 'zh' ? 'zh-CN' : 'en';
    link.textContent = routeLocale.toUpperCase();
    routes.append(link);
  }

  listItem.append(title, metadata, routes);
  return listItem;
}

function createList(items: ContentHealthItem[], showMissingLocales: boolean): HTMLUListElement {
  const list = document.createElement('ul');
  for (const item of items) list.append(createItem(item, showMissingLocales));
  return list;
}

export function createContentListApp(options: ContentListAppOptions) {
  return defineToolbarApp({
    init(canvas, app, server) {
      const toolbarWindow = document.createElement('astro-dev-toolbar-window');
      toolbarWindow.placement =
        (window as ToolbarWindow).__astro_dev_toolbar__?.placement ?? 'bottom-center';
      toolbarWindow.setAttribute('aria-label', options.ariaLabel);

      const style = document.createElement('style');
      style.textContent = `
      astro-dev-toolbar-window {
        width: min(36rem, calc(100vw - 2rem));
        max-height: min(42rem, calc(100vh - 5rem));
        overflow-y: auto;
      }

      h2, p, ul {
        margin: 0;
      }

      h2 {
        color: white;
        font-size: 1rem;
      }

      .status, .empty-state {
        margin-top: 0.65rem;
        color: rgb(145 152 173);
        font-size: 0.8rem;
      }

      ul {
        display: grid;
        gap: 0.5rem;
        margin-top: 0.65rem;
        padding: 0;
        list-style: none;
      }

      .content-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 0.45rem 0.75rem;
        border: 1px solid rgb(52 56 65);
        border-radius: 0.6rem;
        padding: 0.7rem 0.8rem;
      }

      .content-item__title {
        min-width: 0;
        overflow: hidden;
        color: white;
        font-size: 0.85rem;
        font-weight: 600;
        text-decoration: none;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .content-item__title:hover,
      .content-item__title:focus-visible,
      .content-item__routes a:hover,
      .content-item__routes a:focus-visible {
        color: rgb(255 191 0);
        text-decoration: underline;
      }

      .content-item__metadata {
        display: flex;
        grid-column: 1;
        flex-wrap: wrap;
        gap: 0.3rem;
      }

      .badge {
        border-radius: 999px;
        background: rgb(42 46 57);
        padding: 0.16rem 0.42rem;
        color: rgb(178 184 202);
        font-size: 0.68rem;
      }

      .badge--warning {
        background: rgb(120 53 15 / 0.5);
        color: rgb(253 186 116);
      }

      .content-item__routes {
        display: flex;
        grid-column: 2;
        grid-row: 1 / span 2;
        align-self: center;
        gap: 0.5rem;
      }

      .content-item__routes a {
        color: rgb(178 184 202);
        font-size: 0.72rem;
        text-decoration: none;
      }
    `;

      const heading = document.createElement('h2');
      heading.textContent = options.title;
      const content = document.createElement('div');

      const setStatus = (message: string) => {
        const status = document.createElement('p');
        status.className = 'status';
        status.textContent = message;
        content.replaceChildren(status);
      };
      setStatus('Loading…');

      toolbarWindow.append(heading, content);
      canvas.append(style, toolbarWindow);

      server.on<ContentHealthMessage>(options.dataEvent, (message) => {
        if (message.status === 'error') {
          heading.textContent = options.title;
          setStatus(message.message);
          return;
        }

        const items = options.items(message.report);
        heading.textContent = `${options.title} (${items.length})`;
        if (items.length === 0) {
          setStatus(options.emptyMessage);
          return;
        }
        content.replaceChildren(createList(items, options.showMissingLocales ?? false));
      });

      app.onToggled(({ state }) => {
        if (!state) return;
        heading.textContent = options.title;
        setStatus('Loading…');
      });

      app.onToolbarPlacementUpdated(({ placement }) => {
        toolbarWindow.placement = placement;
      });
    },
  });
}
