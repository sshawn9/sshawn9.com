export type SearchResultItem = {
  url: string;
  title: string;
  type: string;
  published: string;
  excerpt: string;
  sections: Array<{ url: string; title: string; excerpt: string }>;
};

export type SearchResultsView = {
  readonly element: HTMLElement;
  readonly query: string | undefined;
  readonly count: number;
  prepare(items: SearchResultItem[]): DocumentFragment;
  commit(
    query: string,
    total: number,
    prepared: DocumentFragment,
    summary: string,
    append?: boolean,
  ): void;
  pending(): void;
  showLoading(message: string): void;
  fail(message: string): void;
  clear(): void;
  destroy(): void;
};

function required<ElementType extends Element>(root: HTMLElement, selector: string): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Search results is missing ${selector}`);
  return element;
}

function safeUrl(value: string, baseUrl: string): string {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

function setHref(anchor: HTMLAnchorElement, value: string, baseUrl: string): void {
  const href = safeUrl(value, baseUrl);
  if (href) anchor.setAttribute('href', href);
}

function visibleLinks(list: HTMLOListElement): HTMLAnchorElement[] {
  return Array.from(list.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(
    (anchor) => anchor.getClientRects().length > 0,
  );
}

export function createSearchResultsView(
  root: HTMLElement,
  input: HTMLInputElement,
  options: { announce: (text: string) => void; loadMore: () => Promise<void> },
): SearchResultsView {
  const element = required<HTMLElement>(root, '[data-search-results]');
  const list = required<HTMLOListElement>(element, '[data-search-list]');
  const placeholder = required<HTMLOListElement>(element, '[data-search-placeholder]');
  const more = required<HTMLElement>(element, '[data-search-more]');
  const summaryElement = required<HTMLElement>(root, '[data-search-summary]');
  const statusElement = required<HTMLElement>(root, '[data-search-status]');
  const emptyState = required<HTMLElement>(root, '[data-search-empty]');
  const cardTemplate = required<HTMLTemplateElement>(root, '[data-search-card-template]');
  const sectionTemplate = required<HTMLTemplateElement>(root, '[data-search-section-template]');
  const sourceDocument = root.ownerDocument;
  const sourceWindow = sourceDocument.defaultView;
  const baseUrl = sourceDocument.baseURI;
  const listeners = new AbortController();
  let destroyed = false;
  let observer: IntersectionObserver | undefined;

  const setStatus = (message: string) => {
    statusElement.textContent = message;
    statusElement.toggleAttribute('hidden', !message);
  };
  const updateMore = (total: number) => {
    more.toggleAttribute('hidden', list.children.length >= total);
  };
  const snapshotFocus = (): string | undefined => {
    const active = sourceDocument.activeElement;
    if (!(active instanceof HTMLAnchorElement) || !list.contains(active)) return undefined;
    return active.href;
  };
  const restoreFocus = (href: string | undefined) => {
    if (!href) return;
    const replacement = Array.from(list.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
      (anchor) => anchor.href === href,
    );
    (replacement ?? input).focus({ preventScroll: true });
  };

  const cloneItem = (template: HTMLTemplateElement): HTMLLIElement => {
    const item = template.content.firstElementChild?.cloneNode(true);
    if (!(item instanceof HTMLLIElement)) throw new Error('Search template must contain an li');
    return item;
  };
  const createCard = (item: SearchResultItem): HTMLLIElement => {
    const card = cloneItem(cardTemplate);
    const type = required<HTMLElement>(card, '[data-result-type]');
    const published = required<HTMLElement>(card, '[data-result-published]');
    const link = required<HTMLAnchorElement>(card, '.site-search-result__link');
    const excerpt = required<HTMLElement>(card, '.site-search-result__excerpt');
    type.textContent = item.type;
    type.toggleAttribute('hidden', !item.type);
    published.textContent = item.published;
    published.toggleAttribute('hidden', !item.published);
    setHref(link, item.url, baseUrl);
    link.textContent = item.title;
    // Pagefind supplies entity-encoded excerpts with generated <mark> tags.
    excerpt.innerHTML = item.excerpt;
    excerpt.toggleAttribute('hidden', !item.excerpt);
    const sections = required<HTMLUListElement>(card, '.site-search-result__sections');
    for (const section of item.sections) {
      const row = cloneItem(sectionTemplate);
      const sectionLink = required<HTMLAnchorElement>(row, '.site-search-result__section-link');
      setHref(sectionLink, section.url, baseUrl);
      sectionLink.textContent = section.title;
      required<HTMLElement>(row, '.site-search-result__section-excerpt').innerHTML =
        section.excerpt;
      sections.append(row);
    }
    sections.toggleAttribute('hidden', item.sections.length === 0);
    return card;
  };

  const view: SearchResultsView = {
    element,
    get query() {
      return element.dataset.query;
    },
    get count() {
      return list.children.length;
    },
    prepare(items) {
      const fragment = sourceDocument.createDocumentFragment();
      for (const item of items) fragment.append(createCard(item));
      return fragment;
    },
    commit(query, total, prepared, summary, append = false) {
      if (destroyed) return;
      const appendToCurrent = append && element.dataset.query === query;
      const focus = appendToCurrent ? undefined : snapshotFocus();
      // Content and fonts are ready. No empty list is painted between these snapshots.
      if (appendToCurrent) list.append(prepared);
      else list.replaceChildren(prepared);
      summaryElement.textContent = summary;
      element.dataset.query = query;
      element.removeAttribute('aria-busy');
      placeholder.setAttribute('hidden', '');
      setStatus('');
      emptyState.setAttribute('hidden', '');
      updateMore(total);
      restoreFocus(focus);
      if (!appendToCurrent) options.announce(summary);
    },
    pending() {
      if (destroyed) return;
      element.setAttribute('aria-busy', 'true');
      setStatus('');
      emptyState.setAttribute('hidden', '');
    },
    showLoading(message) {
      if (destroyed) return;
      setStatus(message);
      if (element.dataset.query === undefined || element.dataset.query === '') {
        placeholder.removeAttribute('hidden');
      }
    },
    fail(message) {
      if (destroyed) return;
      element.removeAttribute('aria-busy');
      placeholder.setAttribute('hidden', '');
      more.setAttribute('hidden', '');
      setStatus(message);
    },
    clear() {
      if (destroyed) return;
      const focused = list.contains(sourceDocument.activeElement);
      list.replaceChildren();
      summaryElement.textContent = '';
      element.dataset.query = '';
      element.removeAttribute('aria-busy');
      placeholder.setAttribute('hidden', '');
      more.setAttribute('hidden', '');
      setStatus('');
      emptyState.removeAttribute('hidden');
      if (focused) input.focus({ preventScroll: true });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.abort();
      observer?.disconnect();
    },
  };

  const moveToInput = (event: KeyboardEvent) => {
    event.preventDefault();
    if (event.key === 'Backspace') input.value = input.value.slice(0, -1);
    else if (event.key.length === 1 && event.key !== '/') input.value += event.key;
    input.focus();
    if (event.key !== '/') {
      input.dispatchEvent(new (sourceWindow?.Event ?? Event)('input', { bubbles: true }));
    }
  };
  list.addEventListener(
    'keydown',
    (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const target = event.target;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (event.key === '/' || event.key === 'Backspace' || event.key.length === 1) {
        moveToInput(event);
        return;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const links = visibleLinks(list);
      const index = links.indexOf(target);
      if (index < 0) return;
      event.preventDefault();
      if (event.key === 'ArrowUp') {
        if (index === 0) input.focus();
        else links[index - 1]?.focus();
        return;
      }
      if (links[index + 1]) {
        links[index + 1].focus();
        return;
      }
      const focusedAnchor = target;
      const initialCount = links.length;
      void options
        .loadMore()
        .then(() => {
          if (sourceDocument.activeElement !== focusedAnchor) return;
          const nextLinks = visibleLinks(list);
          if (nextLinks.length > initialCount) nextLinks[index + 1]?.focus();
        })
        .catch(() => undefined);
    },
    { signal: listeners.signal },
  );
  observer = !sourceWindow?.IntersectionObserver
    ? undefined
    : new sourceWindow.IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting) && !more.hidden) {
            void options.loadMore().catch(() => undefined);
          }
        },
        { rootMargin: '320px' },
      );
  observer?.observe(more);

  return view;
}
