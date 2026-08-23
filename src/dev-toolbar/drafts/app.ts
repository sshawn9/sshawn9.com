import { defineToolbarApp } from 'astro/toolbar';

type Locale = 'en' | 'zh';
type Placement = 'bottom-left' | 'bottom-center' | 'bottom-right';
type ToolbarWindow = Window & {
  __astro_dev_toolbar__?: { placement?: Placement };
};
type DraftGroup = {
  locale: Locale;
  drafts: { title: string; href: string }[];
};
type DraftData = { groups: DraftGroup[] } | { error: string };

const DATA_EVENT = 'sshawn9:drafts-only:data';

function getLocale(): Locale {
  const documentLocale = document.documentElement.dataset.locale;
  if (documentLocale === 'en' || documentLocale === 'zh') return documentLocale;

  return window.location.pathname.startsWith('/zh/') ? 'zh' : 'en';
}

export default defineToolbarApp({
  init(canvas, app, server) {
    const toolbarWindow = document.createElement('astro-dev-toolbar-window');
    toolbarWindow.placement =
      (window as ToolbarWindow).__astro_dev_toolbar__?.placement ?? 'bottom-center';
    toolbarWindow.setAttribute('aria-label', 'Draft articles');

    const style = document.createElement('style');
    style.textContent = `
      astro-dev-toolbar-window {
        width: min(24rem, calc(100vw - 2rem));
        overflow-y: auto;
      }

      h2, p, ul {
        margin: 0;
      }

      h2 {
        color: white;
        font-size: 1rem;
      }

      p {
        margin-top: 0.75rem;
        color: rgb(145 152 173);
        font-size: 0.8rem;
      }

      ul {
        display: grid;
        gap: 0.5rem;
        margin-top: 1rem;
        padding: 0;
        list-style: none;
      }

      a {
        display: block;
        border: 1px solid rgb(52 56 65);
        border-radius: 0.5rem;
        padding: 0.7rem 0.8rem;
        color: white;
        text-decoration: none;
      }

      a:hover {
        border-color: rgb(255 191 0);
        background: rgb(255 191 0 / 0.12);
      }
    `;

    const heading = document.createElement('h2');
    heading.textContent = 'Drafts';
    const content = document.createElement('div');
    const setStatus = (message: string) => {
      const status = document.createElement('p');
      status.textContent = message;
      content.replaceChildren(status);
    };
    setStatus('Loading…');

    toolbarWindow.append(heading, content);
    canvas.append(style, toolbarWindow);

    server.on<DraftData>(DATA_EVENT, (data) => {
      if ('error' in data) {
        heading.textContent = 'Drafts';
        setStatus(data.error);
        return;
      }

      const drafts = data.groups.find(({ locale }) => locale === getLocale())?.drafts ?? [];
      heading.textContent = `Drafts (${drafts.length})`;
      if (drafts.length === 0) {
        setStatus('No draft articles.');
        return;
      }

      const list = document.createElement('ul');
      for (const draft of drafts) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = draft.href;
        link.textContent = draft.title;
        item.append(link);
        list.append(item);
      }
      content.replaceChildren(list);
    });

    app.onToggled(({ state }) => {
      if (!state) return;
      heading.textContent = 'Drafts';
      setStatus('Loading…');
    });

    app.onToolbarPlacementUpdated(({ placement }) => {
      toolbarWindow.placement = placement;
    });
  },
});
