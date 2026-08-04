import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';

const media = window.matchMedia('(prefers-color-scheme: dark)');

function getStoredTheme(): 'light' | 'dark' | null {
  const theme = localStorage.getItem('theme');
  return theme === 'light' || theme === 'dark' ? theme : null;
}

function isDarkTheme() {
  return getStoredTheme() === 'dark' || (getStoredTheme() === null && media.matches);
}

function setDocumentTheme(target: Document, dark: boolean) {
  target.documentElement.classList.toggle('dark', dark);
  target.documentElement.dataset.theme = dark ? 'github-dark' : 'github-light';
  target
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#070a12' : '#f7f8fb');
}

function syncThemeControls(dark: boolean) {
  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => {
    const label = dark ? button.dataset.labelLight : button.dataset.labelDark;
    if (!label) return;
    button.ariaLabel = label;
    button.title = label;
  });
}

function applyTheme(dark: boolean, persist = true) {
  setDocumentTheme(document, dark);
  syncThemeControls(dark);
  if (persist) localStorage.setItem('theme', dark ? 'dark' : 'light');
}

document.addEventListener('click', (event) => {
  const target = event.target;
  const button = target instanceof Element ? target.closest('[data-theme-toggle]') : null;
  if (button) applyTheme(!document.documentElement.classList.contains('dark'));
});

document.addEventListener('astro:before-swap', (event) => {
  setDocumentTheme((event as TransitionBeforeSwapEvent).newDocument, isDarkTheme());
});

document.addEventListener('astro:page-load', () => {
  applyTheme(isDarkTheme(), false);
});

media.addEventListener('change', ({ matches }) => {
  if (getStoredTheme() === null) applyTheme(matches, false);
});

applyTheme(isDarkTheme(), false);
