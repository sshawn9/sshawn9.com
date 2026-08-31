import { LOCALE_PREFERENCE_KEY, saveLocalePreference } from './locale-preference';

/**
 * Keeps the persisted static shell's locale-dependent semantics in sync with
 * the incoming server-rendered shell without replacing its interactive nodes.
 */
export function installSiteShellController(shellDocument: Document): (() => void) | undefined {
  const shellCandidate = shellDocument.querySelector<HTMLElement>('[data-site-shell]');
  if (!shellCandidate || shellCandidate.dataset.shellControllerInstalled === 'true') {
    return undefined;
  }

  const shell = shellCandidate;
  shell.dataset.shellControllerInstalled = 'true';
  const syncKeys = [
    'primary-navigation',
    'home',
    'projects',
    'blog',
    'about',
    'search',
    'locale',
    'theme-toggle',
    'wallpaper-trigger',
    'mobile-menu-trigger',
    'mobile-navigation',
    'mobile-projects',
    'mobile-blog',
    'mobile-about',
    'mobile-search',
    'mobile-search-label',
    'mobile-locale',
    'mobile-theme-toggle',
    'mobile-wallpaper-trigger',
    'wallpaper-settings',
    'wallpaper-enabled-label',
    'wallpaper-auto-label',
    'wallpaper-next-label',
    'wallpaper-download-label',
    'wallpaper-photo-by',
    'wallpaper-on',
    'mobile-wallpaper-settings',
    'mobile-wallpaper-enabled-label',
    'mobile-wallpaper-auto-label',
    'mobile-wallpaper-next-label',
    'mobile-wallpaper-download-label',
  ] as const;
  const synchronizedAttributes = [
    'href',
    'hreflang',
    'lang',
    'aria-label',
    'aria-current',
    'title',
    'data-shell-nav-prefix',
    'data-locale-switch',
    'data-theme-to-light-label',
    'data-theme-to-dark-label',
    'data-open-label',
    'data-close-label',
  ] as const;
  const mobileMenu = shell.querySelector<HTMLElement>('[data-shell-mobile-menu]');
  const mobileMenuTrigger = shell.querySelector<HTMLElement>('[data-mobile-menu-trigger]');

  function itemByKey(root: ParentNode, key: string): HTMLElement | undefined {
    return Array.from(root.querySelectorAll<HTMLElement>('[data-shell-sync-key]')).find(
      (candidate) => candidate.dataset.shellSyncKey === key,
    );
  }

  function copyAttribute(source: HTMLElement, target: HTMLElement, name: string): void {
    const value = source.getAttribute(name);
    if (value === null) target.removeAttribute(name);
    else target.setAttribute(name, value);
  }

  function synchronizeFrom(targetDocument: Document): void {
    const targetShell = targetDocument.querySelector<HTMLElement>('[data-site-shell]');
    if (!targetShell) return;

    copyAttribute(targetShell, shell, 'data-shell-locale');
    copyAttribute(targetShell, shell, 'lang');
    for (const key of syncKeys) {
      const currentItem = itemByKey(shell, key);
      const targetItem = itemByKey(targetShell, key);
      if (!currentItem || !targetItem) continue;

      for (const attribute of synchronizedAttributes) {
        copyAttribute(targetItem, currentItem, attribute);
      }
      if (targetItem.hasAttribute('data-shell-copy-text')) {
        currentItem.textContent = targetItem.textContent;
      }
    }
    synchronizeMobileMenuState();
  }

  function synchronizeMobileMenuState(rawEvent?: Event): void {
    if (!mobileMenu || !mobileMenuTrigger) return;
    const eventState = (rawEvent as (Event & { newState?: string }) | undefined)?.newState;
    let open = eventState === 'open';
    if (!eventState) {
      try {
        open = mobileMenu.matches(':popover-open');
      } catch {
        open = false;
      }
    }
    mobileMenu.toggleAttribute('data-open', open);
    const label = open ? mobileMenuTrigger.dataset.closeLabel : mobileMenuTrigger.dataset.openLabel;
    if (label) {
      mobileMenuTrigger.ariaLabel = label;
      mobileMenuTrigger.title = label;
    }
  }

  function closeMobileMenu(): void {
    if (!mobileMenu) return;
    try {
      mobileMenu.hidePopover();
    } catch {}
    synchronizeMobileMenuState();
  }

  function synchronizeCurrentItem(): void {
    const pathname = shellDocument.defaultView?.location.pathname ?? '';
    for (const link of shell.querySelectorAll<HTMLElement>('[data-shell-nav-prefix]')) {
      const prefix = link.dataset.shellNavPrefix;
      if (prefix && pathname.startsWith(prefix)) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  function prepareLocaleSwitch(rawEvent: Event): void {
    const event = rawEvent as MouseEvent;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const sourceWindow = shellDocument.defaultView;
    const Anchor = sourceWindow?.HTMLAnchorElement;
    if (!sourceWindow || !Anchor) return;

    const link = event
      .composedPath()
      .find((candidate): candidate is HTMLAnchorElement => candidate instanceof Anchor);
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;

    const targetLocale = link.dataset.localeSwitch;
    if (targetLocale !== 'en' && targetLocale !== 'zh') return;

    const target = new URL(link.href, sourceWindow.location.href);
    if (target.origin !== sourceWindow.location.origin) return;

    // Static HTML cannot see request query or fragment state. Add both before
    // ClientRouter resolves the target so the logical page state is preserved.
    target.search = sourceWindow.location.search;
    target.hash = sourceWindow.location.hash;
    link.href = target.href;
    try {
      saveLocalePreference(sourceWindow.localStorage, targetLocale);
    } catch {}
  }

  function closeMobileMenuAfterLink(rawEvent: Event): void {
    const sourceWindow = shellDocument.defaultView;
    const ElementConstructor = sourceWindow?.Element;
    if (!ElementConstructor) return;
    const source = rawEvent
      .composedPath()
      .find((candidate): candidate is Element => candidate instanceof ElementConstructor);
    if (source?.closest('[data-shell-mobile-menu] a')) closeMobileMenu();
  }

  function prepareShellSwap(rawEvent: Event): void {
    const event = rawEvent as Event & { newDocument?: Document };
    closeMobileMenu();
    if (event.newDocument) synchronizeFrom(event.newDocument);
  }

  shellDocument.addEventListener('astro:before-swap', prepareShellSwap);
  shellDocument.addEventListener('astro:page-load', closeMobileMenu);
  shellDocument.addEventListener('astro:page-load', synchronizeCurrentItem);
  shellDocument.addEventListener('click', prepareLocaleSwitch, true);
  shell.addEventListener('click', closeMobileMenuAfterLink);
  mobileMenu?.addEventListener('toggle', synchronizeMobileMenuState);
  synchronizeCurrentItem();
  synchronizeMobileMenuState();

  return () => {
    shellDocument.removeEventListener('astro:before-swap', prepareShellSwap);
    shellDocument.removeEventListener('astro:page-load', closeMobileMenu);
    shellDocument.removeEventListener('astro:page-load', synchronizeCurrentItem);
    shellDocument.removeEventListener('click', prepareLocaleSwitch, true);
    shell.removeEventListener('click', closeMobileMenuAfterLink);
    mobileMenu?.removeEventListener('toggle', synchronizeMobileMenuState);
    delete shell.dataset.shellControllerInstalled;
  };
}

/** Emits the same typed implementation as a parser-executed classic script. */
export function createSiteShellControllerScript(): string {
  return `const LOCALE_PREFERENCE_KEY = ${JSON.stringify(LOCALE_PREFERENCE_KEY)};
${saveLocalePreference.toString()}
const disposeSiteShell = (${installSiteShellController.toString()})(document);
if (disposeSiteShell) {
  window.addEventListener('pagehide', function releaseSiteShell(event) {
    if (event.persisted) return;
    window.removeEventListener('pagehide', releaseSiteShell);
    disposeSiteShell();
  });
}`;
}
