import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { Index, Show, createSignal, onCleanup, onMount, type ParentProps } from 'solid-js';
import type { ReadableAtom } from 'nanostores';
import { localStorageKey } from '@sshawn9/site-i18n/runtime';
import { startThemeController, toggleTheme } from '../scripts/theme-controller';
import { startWallpaperController, wallpaperActions } from '../scripts/wallpaper';
import { $navigation, $theme, $wallpaper, SSR_WALLPAPER_STATE } from '../stores/site-state';
import '../styles/site-chrome.css';

type IconProps = {
  class?: string;
  classList?: Record<string, boolean>;
};

function Icon(props: ParentProps<IconProps>) {
  return (
    <svg
      class={props.class}
      classList={props.classList}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
    </Icon>
  );
}

function ImageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </Icon>
  );
}

function LanguagesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </Icon>
  );
}

function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h16" />
    </Icon>
  );
}

function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    </Icon>
  );
}

function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Icon>
  );
}

function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </Icon>
  );
}

function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </Icon>
  );
}

function XIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

function useStoreValue<Value>(store: ReadableAtom<Value>, hydrationValue = store.get()) {
  const [value, setValue] = createSignal(hydrationValue);

  onMount(() => {
    // Begin with the value used by SSR, then reconcile client-only preferences after hydration.
    setValue(() => store.get());
    const unsubscribe = store.listen((nextValue) => setValue(() => nextValue));
    onCleanup(unsubscribe);
  });

  return value;
}

function anchorPopover(trigger: HTMLElement, popover: HTMLElement) {
  let stopAutoUpdate: (() => void) | undefined;
  let updateVersion = 0;

  const stopPositioning = () => {
    updateVersion += 1;
    stopAutoUpdate?.();
    stopAutoUpdate = undefined;
    popover.removeAttribute('data-positioning');
  };

  const updatePosition = async () => {
    const version = updateVersion;
    const { x, y } = await computePosition(trigger, popover, {
      strategy: 'fixed',
      placement: 'bottom-end',
      middleware: [offset(8), flip(), shift({ padding: 16 })],
    });
    if (version !== updateVersion || !popover.matches(':popover-open')) return;

    Object.assign(popover.style, {
      left: `${x}px`,
      top: `${y}px`,
      right: 'auto',
      bottom: 'auto',
    });
    popover.removeAttribute('data-positioning');
  };

  const startPositioning = () => {
    stopPositioning();
    popover.setAttribute('data-positioning', '');
    stopAutoUpdate = autoUpdate(trigger, popover, updatePosition);
  };

  const handleBeforeToggle = (event: Event) => {
    if ((event as Event & { newState?: string }).newState === 'open') {
      popover.setAttribute('data-positioning', '');
    }
  };
  const handleToggle = () => {
    if (popover.matches(':popover-open')) startPositioning();
    else stopPositioning();
  };

  popover.addEventListener('beforetoggle', handleBeforeToggle);
  popover.addEventListener('toggle', handleToggle);

  return () => {
    stopPositioning();
    popover.removeEventListener('beforetoggle', handleBeforeToggle);
    popover.removeEventListener('toggle', handleToggle);
  };
}

export type SiteChromeNavItem = {
  id: string;
  href: string;
  label: string;
  active: boolean;
};

export type SiteChromeLabels = {
  skipToContent: string;
  mainNavigation: string;
  mobileNavigation: string;
  home: string;
  search: string;
  openNavigation: string;
  closeNavigation: string;
  navigationLoading: string;
  githubProfile: string;
  themeToggle: string;
  themeToLight: string;
  themeToDark: string;
  wallpaperControls: string;
  wallpaperUseRandom: string;
  wallpaperAutoRotation: string;
  wallpaperRefresh: string;
  wallpaperDownload: string;
  wallpaperPhotoBy: string;
  wallpaperOn: string;
};

export type SiteChromeProps = {
  locale: 'en' | 'zh';
  languageTag: string;
  pathname: string;
  homeHref: string;
  homeActive: boolean;
  searchHref: string;
  searchActive: boolean;
  localeHref: string;
  targetLocale: 'en' | 'zh';
  localeLabel: string;
  githubHref: string;
  navItems: SiteChromeNavItem[];
  labels: SiteChromeLabels;
};

function parseSiteChromeContext(context: string) {
  try {
    const value = JSON.parse(context) as SiteChromeProps;
    if (
      (value.locale !== 'en' && value.locale !== 'zh') ||
      typeof value.languageTag !== 'string' ||
      typeof value.pathname !== 'string' ||
      !Array.isArray(value.navItems) ||
      typeof value.labels !== 'object' ||
      value.labels === null
    ) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function GithubIcon() {
  return (
    <svg class="site-header__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297a12 12 0 0 0-3.795 23.385c.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.84 1.237 1.84 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57A12 12 0 0 0 12 .297Z" />
    </svg>
  );
}

function ThemeButton(props: { labels: SiteChromeLabels }) {
  const theme = useStoreValue($theme, 'light');
  const label = () => (theme() === 'dark' ? props.labels.themeToLight : props.labels.themeToDark);

  return (
    <button
      type="button"
      class="icon-control site-header__theme-button"
      aria-label={label() || props.labels.themeToggle}
      title={label() || props.labels.themeToggle}
      data-theme-toggle
      onClick={toggleTheme}
    >
      <SunIcon class="site-header__icon site-header__theme-light" />
      <MoonIcon class="site-header__icon site-header__theme-dark" />
    </button>
  );
}

function WallpaperSettings(props: { labels: SiteChromeLabels }) {
  const wallpaper = useStoreValue($wallpaper, SSR_WALLPAPER_STATE);

  return (
    <div class="wallpaper-settings" data-wallpaper-settings>
      <label class="wallpaper-settings__row" data-wallpaper-enabled-control>
        <span>{props.labels.wallpaperUseRandom}</span>
        <input
          type="checkbox"
          class="sr-only"
          data-wallpaper-enabled
          checked={wallpaper().enabled}
          onChange={(event) => void wallpaperActions.setEnabled(event.currentTarget.checked)}
        />
        <span class="wallpaper-switch" aria-hidden="true">
          <span />
        </span>
      </label>

      <label
        class="wallpaper-settings__row"
        data-wallpaper-auto-rotation-control
        data-disabled={!wallpaper().enabled || !wallpaper().ready ? '' : undefined}
      >
        <span>{props.labels.wallpaperAutoRotation}</span>
        <input
          type="checkbox"
          class="sr-only"
          data-wallpaper-auto-rotation
          checked={wallpaper().autoRotation}
          disabled={!wallpaper().enabled || !wallpaper().ready}
          onChange={(event) => wallpaperActions.setAutoRotation(event.currentTarget.checked)}
        />
        <span class="wallpaper-switch" aria-hidden="true">
          <span />
        </span>
      </label>

      <div class="wallpaper-settings__actions">
        <button
          type="button"
          class="interactive-supporting"
          data-wallpaper-refresh
          aria-busy={wallpaper().loading}
          disabled={!wallpaper().enabled || !wallpaper().ready || !wallpaper().canAdvance}
          onClick={() => void wallpaperActions.refresh()}
        >
          <RefreshIcon
            class="wallpaper-settings__action-icon"
            classList={{ 'wallpaper-settings__action-icon--spinning': wallpaper().loading }}
          />
          <span>{props.labels.wallpaperRefresh}</span>
        </button>
        <button
          type="button"
          class="interactive-supporting"
          data-wallpaper-download
          aria-busy={wallpaper().downloading}
          disabled={!wallpaper().enabled || !wallpaper().ready}
          onClick={() => void wallpaperActions.download()}
        >
          <DownloadIcon
            class="wallpaper-settings__action-icon"
            classList={{ 'wallpaper-settings__action-icon--pulsing': wallpaper().downloading }}
          />
          <span>{props.labels.wallpaperDownload}</span>
        </button>
      </div>
    </div>
  );
}

function WallpaperLayers(props: {
  labels: SiteChromeLabels;
  mediaRef: (element: HTMLDivElement) => void;
  firstImageRef: (element: HTMLImageElement) => void;
  secondImageRef: (element: HTMLImageElement) => void;
}) {
  const wallpaper = useStoreValue($wallpaper, SSR_WALLPAPER_STATE);
  const photo = () => wallpaper().currentPhoto;
  const creditVisible = () => wallpaper().enabled && wallpaper().ready && Boolean(photo());

  return (
    <div class="wallpaper" data-wallpaper>
      <div class="wallpaper__boot" aria-hidden="true">
        <div class="wallpaper__boot-image" />
        <div class="wallpaper__scrim" />
      </div>
      <div class="wallpaper__media" data-wallpaper-media aria-hidden="true" ref={props.mediaRef}>
        <div class="wallpaper__images">
          <img
            class="wallpaper__image"
            data-wallpaper-image
            alt=""
            decoding="async"
            fetchpriority="low"
            draggable={false}
            ref={props.firstImageRef}
          />
          <img
            class="wallpaper__image"
            data-wallpaper-image
            alt=""
            decoding="async"
            fetchpriority="low"
            draggable={false}
            ref={props.secondImageRef}
          />
        </div>
        <div class="wallpaper__scrim" />
      </div>

      <div class="wallpaper__credit" data-wallpaper-credit hidden={!creditVisible()}>
        <span>{props.labels.wallpaperPhotoBy}</span>{' '}
        <a
          href={photo()?.photographerUrl}
          target="_blank"
          rel="noreferrer"
          data-wallpaper-credit-photographer
        >
          {photo()?.photographerName}
        </a>{' '}
        <span>{props.labels.wallpaperOn}</span>{' '}
        <a href={photo()?.photoUrl} target="_blank" rel="noreferrer" data-wallpaper-credit-photo>
          Unsplash
        </a>
      </div>
    </div>
  );
}

export default function SiteChrome(props: SiteChromeProps) {
  const [chrome, setChrome] = createSignal(props);
  const navigation = useStoreValue($navigation);
  const [mobileMenuOpen, setMobileMenuOpen] = createSignal(false);
  let mobileDialog: HTMLDialogElement | undefined;
  let media: HTMLDivElement | undefined;
  let firstImage: HTMLImageElement | undefined;
  let secondImage: HTMLImageElement | undefined;
  let wallpaperTrigger: HTMLButtonElement | undefined;
  let wallpaperPopover: HTMLDivElement | undefined;

  const closeMobileMenu = () => {
    if (mobileDialog?.open) mobileDialog.close();
    setMobileMenuOpen(false);
  };
  const closeWallpaperMenu = () => {
    const menu = document.querySelector<HTMLElement>('#wallpaper-control-popover');
    if (menu?.matches(':popover-open')) menu.hidePopover();
  };
  const closeTransientChrome = () => {
    closeMobileMenu();
    closeWallpaperMenu();
  };

  const openMobileMenu = () => {
    closeWallpaperMenu();
    if (!mobileDialog?.open) mobileDialog?.showModal();
    setMobileMenuOpen(Boolean(mobileDialog?.open));
  };

  onMount(() => {
    const root = document.documentElement;
    const cleanups = [startThemeController()];
    if (media && firstImage && secondImage && wallpaperTrigger && wallpaperPopover) {
      cleanups.push(
        startWallpaperController({ media, images: [firstImage, secondImage] }),
        anchorPopover(wallpaperTrigger, wallpaperPopover),
      );
    }
    const mobileMedia = matchMedia('(max-width: 47.999rem)');

    const handleViewport = () => {
      if (!mobileMedia.matches) closeMobileMenu();
      else closeWallpaperMenu();
    };
    const handleNavigationStart = () => closeTransientChrome();
    const applyChromeContext = (context: unknown) => {
      if (typeof context !== 'string') return;
      const next = parseSiteChromeContext(context);
      if (!next) return;

      document.documentElement.lang = next.languageTag;
      document.documentElement.dataset.locale = next.locale;
      setChrome(next);
    };
    const syncChromeContext = (event: Event) => {
      applyChromeContext((event as CustomEvent<unknown>).detail);
    };
    mobileMedia.addEventListener('change', handleViewport);
    document.addEventListener('swup:visit:start', handleNavigationStart);
    document.addEventListener('site:chrome-context', syncChromeContext);
    applyChromeContext(
      document.querySelector<HTMLScriptElement>('#site-chrome-context')?.textContent,
    );
    root.dataset.siteChromeReady = 'true';

    onCleanup(() => {
      root.removeAttribute('data-site-chrome-ready');
      cleanups.forEach((cleanup) => cleanup());
      mobileMedia.removeEventListener('change', handleViewport);
      document.removeEventListener('swup:visit:start', handleNavigationStart);
      document.removeEventListener('site:chrome-context', syncChromeContext);
    });
  });

  const switchLocale = (event: MouseEvent & { currentTarget: HTMLAnchorElement }) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }

    localStorage.setItem(localStorageKey, chrome().targetLocale);
  };

  return (
    <div class="site-chrome">
      <a
        class="fixed top-3 left-3 z-[100] -translate-y-20 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white transition focus:translate-y-0 dark:bg-white dark:text-slate-950"
        href="#main-content"
        data-site-skip-link
      >
        {chrome().labels.skipToContent}
      </a>
      <WallpaperLayers
        labels={chrome().labels}
        mediaRef={(element) => (media = element)}
        firstImageRef={(element) => (firstImage = element)}
        secondImageRef={(element) => (secondImage = element)}
      />

      <header class="site-header" data-pagefind-ignore data-site-header>
        <div class="site-header__progress" aria-hidden="true" />
        <div class="site-header__inner content-shell">
          <a
            href={chrome().homeHref}
            class="site-header__identity"
            data-swup-preload
            data-site-header-sync="home"
            aria-label={`SHAWN · ${chrome().labels.home}`}
            aria-current={chrome().homeActive ? 'page' : undefined}
          >
            <span class="site-header__monogram" aria-hidden="true">
              S
            </span>
            <span>SHAWN</span>
          </a>

          <div class="site-header__desktop">
            <nav class="site-header__primary-nav" aria-label={chrome().labels.mainNavigation}>
              <Index each={chrome().navItems}>
                {(item) => (
                  <a
                    href={item().href}
                    aria-current={item().active ? 'page' : undefined}
                    class="site-header__nav-link"
                    data-swup-preload
                    data-site-header-sync={`desktop-${item().id}`}
                  >
                    {item().label}
                  </a>
                )}
              </Index>
            </nav>

            <div class="site-header__utilities">
              <a
                href={chrome().searchHref}
                class="icon-control"
                data-site-header-sync="desktop-search"
                aria-label={chrome().labels.search}
                title={chrome().labels.search}
                aria-current={chrome().searchActive ? 'page' : undefined}
              >
                <SearchIcon class="site-header__icon" />
              </a>
              <a
                href={chrome().localeHref}
                data-locale-switch={chrome().targetLocale}
                data-swup-scroll-preserve
                data-site-header-sync="desktop-locale"
                class="icon-control"
                aria-label={chrome().localeLabel}
                title={chrome().localeLabel}
                onClick={switchLocale}
              >
                <LanguagesIcon class="site-header__icon" />
              </a>
              <div class="site-header__appearance">
                <ThemeButton labels={chrome().labels} />
                <div data-wallpaper-control>
                  <button
                    type="button"
                    class="icon-control"
                    aria-label={chrome().labels.wallpaperControls}
                    title={chrome().labels.wallpaperControls}
                    aria-expanded="false"
                    popovertarget="wallpaper-control-popover"
                    data-wallpaper-menu-trigger
                    ref={(element) => (wallpaperTrigger = element)}
                  >
                    <ImageIcon class="site-header__icon" />
                  </button>
                  <div
                    id="wallpaper-control-popover"
                    popover="auto"
                    role="dialog"
                    class="wallpaper-control__popover"
                    aria-label={chrome().labels.wallpaperControls}
                    data-wallpaper-menu
                    data-transient-overlay
                    ref={(element) => (wallpaperPopover = element)}
                  >
                    <WallpaperSettings labels={chrome().labels} />
                  </div>
                </div>
              </div>
              <a
                href={chrome().githubHref}
                target="_blank"
                rel="noreferrer"
                class="icon-control"
                data-site-header-sync="desktop-github"
                aria-label={chrome().labels.githubProfile}
                title="GitHub"
              >
                <GithubIcon />
              </a>
            </div>
          </div>

          <button
            type="button"
            class="site-header__menu-button"
            aria-expanded={mobileMenuOpen()}
            aria-controls="site-navigation"
            aria-label={
              mobileMenuOpen() ? chrome().labels.closeNavigation : chrome().labels.openNavigation
            }
            data-site-menu-trigger
            onClick={() => (mobileMenuOpen() ? closeMobileMenu() : openMobileMenu())}
          >
            <Show when={!mobileMenuOpen()} fallback={<XIcon class="site-header__menu-icon" />}>
              <MenuIcon class="site-header__menu-icon" />
            </Show>
          </button>

          <details class="site-header__mobile-fallback" data-site-menu-fallback>
            <summary class="site-header__menu-button">
              <MenuIcon class="site-header__menu-icon" />
              <span class="sr-only site-header__mobile-fallback-open-label">
                {chrome().labels.openNavigation}
              </span>
              <span class="sr-only site-header__mobile-fallback-close-label">
                {chrome().labels.closeNavigation}
              </span>
            </summary>
            <div class="site-header__mobile-fallback-panel">
              <nav class="site-header__mobile-nav" aria-label={chrome().labels.mobileNavigation}>
                <Index each={chrome().navItems}>
                  {(item) => (
                    <a
                      href={item().href}
                      aria-current={item().active ? 'page' : undefined}
                      class="site-header__mobile-link"
                    >
                      {item().label}
                    </a>
                  )}
                </Index>
                <a
                  href={chrome().searchHref}
                  aria-current={chrome().searchActive ? 'page' : undefined}
                  class="site-header__mobile-link site-header__mobile-search"
                >
                  <SearchIcon class="site-header__icon" />
                  <span>{chrome().labels.search}</span>
                </a>
              </nav>
              <div class="site-header__mobile-utilities">
                <a
                  href={chrome().localeHref}
                  class="icon-control"
                  aria-label={chrome().localeLabel}
                  title={chrome().localeLabel}
                >
                  <LanguagesIcon class="site-header__icon" />
                </a>
                <a
                  href={chrome().githubHref}
                  target="_blank"
                  rel="noreferrer"
                  class="icon-control"
                  aria-label={chrome().labels.githubProfile}
                  title="GitHub"
                >
                  <GithubIcon />
                </a>
              </div>
            </div>
          </details>

          <dialog
            id="site-navigation"
            class="site-header__mobile-panel"
            aria-label={chrome().labels.mobileNavigation}
            ref={mobileDialog}
            onClose={() => setMobileMenuOpen(false)}
            onClick={(event) => {
              if (event.target === mobileDialog) closeMobileMenu();
            }}
          >
            <nav class="site-header__mobile-nav" aria-label={chrome().labels.mobileNavigation}>
              <Index each={chrome().navItems}>
                {(item) => (
                  <a
                    href={item().href}
                    aria-current={item().active ? 'page' : undefined}
                    class="site-header__mobile-link"
                    data-swup-preload
                    data-site-header-sync={`mobile-${item().id}`}
                  >
                    {item().label}
                  </a>
                )}
              </Index>
              <a
                href={chrome().searchHref}
                aria-current={chrome().searchActive ? 'page' : undefined}
                class="site-header__mobile-link site-header__mobile-search"
                data-site-header-sync="mobile-search"
              >
                <SearchIcon class="site-header__icon" />
                <span>{chrome().labels.search}</span>
              </a>
            </nav>

            <div class="site-header__mobile-wallpaper" data-wallpaper-control>
              <WallpaperSettings labels={chrome().labels} />
            </div>

            <div class="site-header__mobile-utilities">
              <a
                href={chrome().localeHref}
                data-locale-switch={chrome().targetLocale}
                data-swup-scroll-preserve
                data-site-header-sync="mobile-locale"
                class="icon-control"
                aria-label={chrome().localeLabel}
                title={chrome().localeLabel}
                onClick={switchLocale}
              >
                <LanguagesIcon class="site-header__icon" />
              </a>
              <ThemeButton labels={chrome().labels} />
              <a
                href={chrome().githubHref}
                target="_blank"
                rel="noreferrer"
                class="icon-control"
                aria-label={chrome().labels.githubProfile}
                title="GitHub"
              >
                <GithubIcon />
              </a>
            </div>
          </dialog>
        </div>
      </header>

      <span
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-navigation-status
      >
        {navigation().pending ? chrome().labels.navigationLoading : ''}
      </span>
    </div>
  );
}
