export type ArticlePopoverController = {
  destroy(): void;
};

export function createArticlePopoverController(article: HTMLElement): ArticlePopoverController {
  const listeners = new AbortController();

  for (const toggle of article.querySelectorAll<HTMLButtonElement>(
    '[data-article-popover-toggle]',
  )) {
    const popoverId = toggle.getAttribute('popovertarget');
    const popover = popoverId ? article.querySelector<HTMLElement>(`#${popoverId}`) : undefined;
    if (!popover) continue;

    const synchronize = () => {
      toggle.setAttribute('aria-expanded', String(popover.matches(':popover-open')));
    };
    popover.addEventListener('toggle', synchronize, { signal: listeners.signal });
    synchronize();
  }

  return { destroy: () => listeners.abort() };
}
