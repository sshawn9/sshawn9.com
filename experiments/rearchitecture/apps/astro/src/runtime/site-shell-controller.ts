/** Installs the one document-lifetime owner for persistent shell controls. */
export function installSiteShellController(shellDocument: Document) {
  type Theme = 'dark' | 'light';
  type Wallpaper = 'off' | 'on';
  type ShellAction = 'theme' | 'wallpaper';

  const shellCandidate = shellDocument.querySelector<HTMLElement>('[data-site-shell]');
  const windowCandidate = shellDocument.defaultView;
  if (
    !shellCandidate ||
    !windowCandidate ||
    shellCandidate.dataset.shellControllerInstalled === 'true'
  ) {
    return;
  }
  const shell = shellCandidate;
  const shellWindow = windowCandidate;
  shell.dataset.shellControllerInstalled = 'true';

  const storageKeys = {
    theme: 'poc:theme',
    wallpaper: 'poc:wallpaper',
  } as const;
  const themeTransitionDuration = 650;
  let hasExplicitTheme = false;
  let themeTransitionTimer: number | undefined;

  function readPreference(key: keyof typeof storageKeys) {
    try {
      return shellWindow.localStorage.getItem(storageKeys[key]);
    } catch {
      return null;
    }
  }

  function writePreference(key: keyof typeof storageKeys, value: string) {
    try {
      shellWindow.localStorage.setItem(storageKeys[key], value);
    } catch {
      // The current document still owns the in-memory preference.
    }
  }

  function systemTheme(colorScheme: MediaQueryList): Theme {
    return colorScheme.matches ? 'light' : 'dark';
  }

  function storedTheme(): Theme | undefined {
    const value = readPreference('theme');
    return value === 'dark' || value === 'light' ? value : undefined;
  }

  function currentTheme(): Theme {
    return shellDocument.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  function currentWallpaper(): Wallpaper {
    return shellDocument.documentElement.dataset.wallpaper === 'off' ? 'off' : 'on';
  }

  function applyTheme(theme: Theme, animate = false) {
    const root = shellDocument.documentElement;
    if (animate) {
      shellWindow.clearTimeout(themeTransitionTimer);
      root.dataset.themeTransition = 'active';
      themeTransitionTimer = shellWindow.setTimeout(() => {
        delete root.dataset.themeTransition;
      }, themeTransitionDuration);
    }
    root.dataset.theme = theme;
  }

  function applyWallpaper(wallpaper: Wallpaper) {
    shellDocument.documentElement.dataset.wallpaper = wallpaper;
  }

  function syncShellSemantics() {
    const path = shellWindow.location.pathname;
    for (const link of shell.querySelectorAll<HTMLElement>('[data-shell-nav-prefix]')) {
      const prefix = link.dataset.shellNavPrefix;
      if (prefix && path.startsWith(prefix)) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    }

    shell
      .querySelector<HTMLElement>('[data-shell-action="wallpaper"]')
      ?.setAttribute('aria-pressed', String(currentWallpaper() === 'on'));
  }

  function toggleTheme() {
    const nextTheme: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    hasExplicitTheme = true;
    applyTheme(nextTheme, true);
    writePreference('theme', nextTheme);
  }

  function toggleWallpaper() {
    const nextWallpaper: Wallpaper = currentWallpaper() === 'on' ? 'off' : 'on';
    applyWallpaper(nextWallpaper);
    writePreference('wallpaper', nextWallpaper);
    syncShellSemantics();
  }

  function readShellAction(target: EventTarget | null): ShellAction | undefined {
    if (!(target instanceof shellWindow.Element)) {
      return undefined;
    }

    const action = target.closest<HTMLElement>('[data-shell-action]')?.dataset.shellAction;
    return action === 'theme' || action === 'wallpaper' ? action : undefined;
  }

  function handleShellClick(event: MouseEvent) {
    const action = readShellAction(event.target);
    if (action === 'theme') {
      toggleTheme();
    } else if (action === 'wallpaper') {
      toggleWallpaper();
    }
  }

  const colorScheme = shellWindow.matchMedia('(prefers-color-scheme: light)');
  const explicitTheme = storedTheme();
  hasExplicitTheme = explicitTheme !== undefined;
  applyTheme(explicitTheme ?? systemTheme(colorScheme));
  applyWallpaper(readPreference('wallpaper') === 'off' ? 'off' : 'on');
  syncShellSemantics();

  colorScheme.addEventListener('change', (event) => {
    if (!hasExplicitTheme) {
      applyTheme(event.matches ? 'light' : 'dark');
    }
  });
  shell.addEventListener('click', handleShellClick);
  shellDocument.addEventListener('astro:page-load', syncShellSemantics);
}

/** Serializes the typed controller into a parser-executed script beside the shell. */
export function createSiteShellControllerScript() {
  return `(${installSiteShellController.toString()})(document);`;
}
