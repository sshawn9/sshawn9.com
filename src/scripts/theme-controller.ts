import { SITE_STORAGE_KEYS } from '../lib/site-preferences';
import { $theme, type ThemeMode } from '../stores/site-state';
import { claimClientRuntime } from './client-runtime';

let transitionRevision = 0;

function clearThemeTransitionState() {
  document.documentElement.classList.remove('theme-transitioning');
}

function storedTheme(): ThemeMode | undefined {
  const value = localStorage.getItem(SITE_STORAGE_KEYS.theme);
  return value === 'light' || value === 'dark' ? value : undefined;
}

function applyThemeToDocument(target: Document, theme: ThemeMode) {
  const dark = theme === 'dark';
  target.documentElement.classList.toggle('dark', dark);
  target.documentElement.dataset.theme = dark ? 'github-dark' : 'github-light';
  target.documentElement.style.colorScheme = theme;
  target
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#070a12' : '#f7f8fb');
}

function applyTheme(theme: ThemeMode, persist: boolean) {
  applyThemeToDocument(document, theme);
  $theme.set(theme);
  if (persist) localStorage.setItem(SITE_STORAGE_KEYS.theme, theme);
}

export function setTheme(theme: ThemeMode, options: { animate?: boolean; persist?: boolean } = {}) {
  const { animate = true, persist = true } = options;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!animate || reducedMotion || !document.startViewTransition) {
    clearThemeTransitionState();
    applyTheme(theme, persist);
    return;
  }

  const revision = ++transitionRevision;
  document.documentElement.classList.add('theme-transitioning');
  const transition = document.startViewTransition(() => applyTheme(theme, persist));
  const finish = () => {
    if (revision === transitionRevision) {
      clearThemeTransitionState();
    }
  };
  void transition.finished.then(finish, finish);
}

export function toggleTheme() {
  setTheme($theme.get() === 'dark' ? 'light' : 'dark');
}

export function startThemeController() {
  const runtime = claimClientRuntime('theme');

  runtime.onDispose(() => {
    transitionRevision += 1;
    clearThemeTransitionState();
  });

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const initialTheme: ThemeMode = $theme.get();
  applyTheme(initialTheme, false);

  const handleSystemTheme = (event: MediaQueryListEvent) => {
    if (storedTheme() === undefined) {
      setTheme(event.matches ? 'dark' : 'light', { persist: false });
    }
  };
  const syncTheme = () => applyThemeToDocument(document, $theme.get());

  // MediaQueryList's typed 'change' listener isn't assignable to the generic
  // EventListener signature `listen()` expects, so this pair stays manual.
  media.addEventListener('change', handleSystemTheme);
  runtime.onDispose(() => media.removeEventListener('change', handleSystemTheme));
  runtime.listen(document, 'site:after-swap', syncTheme);

  return runtime.dispose;
}
