import {
  applyThemePreference,
  resolveThemePreference,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
} from './document-preferences';

function storedTheme(storage: Pick<Storage, 'getItem'>): ResolvedTheme | undefined {
  const value = storage.getItem(THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : undefined;
}

function reflectTheme(target: Document, theme: ResolvedTheme): void {
  applyThemePreference(target.documentElement, theme);
  target
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#070a12' : '#f7f8fb');

  for (const button of target.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
    const label =
      theme === 'dark' ? button.dataset.themeToLightLabel : button.dataset.themeToDarkLabel;
    if (label) {
      button.ariaLabel = label;
      button.title = label;
    }
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}

export function installThemeController(target: Document, sourceWindow: Window): () => void {
  const media = sourceWindow.matchMedia('(prefers-color-scheme: dark)');
  let transitionTimer: number | undefined;

  const currentTheme = (): ResolvedTheme =>
    target.documentElement.classList.contains('dark') ? 'dark' : 'light';

  const commit = (theme: ResolvedTheme, persist: boolean): void => {
    reflectTheme(target, theme);
    if (!persist) return;
    try {
      sourceWindow.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {}
  };

  const setTheme = (theme: ResolvedTheme, persist = true): void => {
    const reduceMotion = sourceWindow.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = target.documentElement;
    if (transitionTimer !== undefined) sourceWindow.clearTimeout(transitionTimer);

    if (reduceMotion) {
      delete root.dataset.themeTransition;
      commit(theme, persist);
      return;
    }

    root.dataset.themeTransition = 'active';
    // Establish the transition declaration before changing registered tokens.
    // This is one bounded style read on an explicit user/system theme change.
    sourceWindow.getComputedStyle(root).getPropertyValue('--page');
    commit(theme, persist);
    transitionTimer = sourceWindow.setTimeout(() => {
      transitionTimer = undefined;
      delete root.dataset.themeTransition;
    }, 650);
  };

  const handleClick = (event: Event): void => {
    const ElementConstructor = (sourceWindow as Window & typeof globalThis).Element;
    const source = event
      .composedPath()
      .find((candidate): candidate is Element => candidate instanceof ElementConstructor);
    if (!source?.closest('[data-theme-toggle]')) return;
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  };

  const handleSystemTheme = (event: MediaQueryListEvent): void => {
    try {
      if (storedTheme(sourceWindow.localStorage)) return;
    } catch {}
    setTheme(event.matches ? 'dark' : 'light', false);
  };

  const synchronize = (): void => reflectTheme(target, currentTheme());

  target.addEventListener('click', handleClick);
  target.addEventListener('astro:after-swap', synchronize);
  media.addEventListener('change', handleSystemTheme);
  let initial = currentTheme();
  try {
    initial = resolveThemePreference(storedTheme(sourceWindow.localStorage) ?? null, media.matches);
  } catch {}
  reflectTheme(target, initial);

  return () => {
    if (transitionTimer !== undefined) sourceWindow.clearTimeout(transitionTimer);
    delete target.documentElement.dataset.themeTransition;
    target.removeEventListener('click', handleClick);
    target.removeEventListener('astro:after-swap', synchronize);
    media.removeEventListener('change', handleSystemTheme);
  };
}
