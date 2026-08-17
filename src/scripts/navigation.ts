import type {
  TransitionBeforePreparationEvent,
  TransitionBeforeSwapEvent,
} from 'astro:transitions/client';
import { claimClientRuntime } from './client-runtime';

const SHOW_DELAY_MS = 120;
const MIN_VISIBLE_MS = 240;
const FADE_MS = 120;

let revision = 0;
let pendingHref: string | null = null;
let pendingSource: HTMLElement | null = null;
let shownAt = 0;
let showTimer: number | undefined;
let finishTimer: number | undefined;
const runtime = claimClientRuntime('navigation');

function clearTimers() {
  window.clearTimeout(showTimer);
  window.clearTimeout(finishTimer);
  showTimer = undefined;
  finishTimer = undefined;
}

function statusElement(target: ParentNode = document) {
  return target.querySelector<HTMLElement>('[data-navigation-status]');
}

function setStatus(target: ParentNode = document, loading: boolean) {
  const status = statusElement(target);
  if (status) status.textContent = loading ? (status.dataset.loadingLabel ?? '') : '';
}

function clearSource() {
  pendingSource?.removeAttribute('data-navigation-pending');
  pendingSource?.removeAttribute('aria-busy');
  pendingSource = null;
}

function resetNavigation(targetRevision: number) {
  if (targetRevision !== revision) return;

  clearTimers();
  clearSource();
  pendingHref = null;
  shownAt = 0;
  document.documentElement.removeAttribute('data-navigation-pending');
  document.documentElement.removeAttribute('data-navigation-progress');
  document.querySelector('main')?.removeAttribute('aria-busy');
  setStatus(document, false);
}

function beginNavigation(event: TransitionBeforePreparationEvent) {
  const navigationRevision = ++revision;
  const root = document.documentElement;
  const progressIsVisible = root.dataset.navigationProgress !== undefined;

  clearTimers();
  clearSource();
  pendingHref = event.to.href;
  pendingSource = event.sourceElement instanceof HTMLElement ? event.sourceElement : null;
  pendingSource?.setAttribute('data-navigation-pending', '');
  pendingSource?.setAttribute('aria-busy', 'true');
  root.setAttribute('data-navigation-pending', '');
  document.querySelector('main')?.setAttribute('aria-busy', 'true');
  setStatus(document, true);

  if (progressIsVisible) {
    root.dataset.navigationProgress = 'active';
  } else {
    showTimer = window.setTimeout(() => {
      if (navigationRevision !== revision) return;
      shownAt = performance.now();
      root.dataset.navigationProgress = 'active';
    }, SHOW_DELAY_MS);
  }

  const load = event.loader;
  event.loader = async () => {
    try {
      await load();
    } catch (error) {
      resetNavigation(navigationRevision);
      throw error;
    }
  };

  event.signal.addEventListener(
    'abort',
    () => {
      queueMicrotask(() => resetNavigation(navigationRevision));
    },
    { once: true },
  );
}

function carryNavigationState(event: TransitionBeforeSwapEvent) {
  const currentRoot = document.documentElement;
  const nextRoot = event.newDocument.documentElement;

  if (currentRoot.hasAttribute('data-navigation-pending')) {
    nextRoot.setAttribute('data-navigation-pending', '');
    event.newDocument.querySelector('main')?.setAttribute('aria-busy', 'true');
  }

  const progress = currentRoot.dataset.navigationProgress;
  if (progress) nextRoot.dataset.navigationProgress = progress;
}

function finishNavigation() {
  if (pendingHref === null) return;

  const navigationRevision = revision;
  const root = document.documentElement;
  const progressWasShown = root.dataset.navigationProgress === 'active';

  clearSource();
  pendingHref = null;
  root.removeAttribute('data-navigation-pending');
  document.querySelector('main')?.removeAttribute('aria-busy');
  setStatus(document, false);
  window.clearTimeout(showTimer);
  showTimer = undefined;

  if (!progressWasShown) {
    resetNavigation(navigationRevision);
    return;
  }

  const remaining = Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt));
  finishTimer = window.setTimeout(() => {
    if (navigationRevision !== revision) return;
    root.dataset.navigationProgress = 'finishing';
    finishTimer = window.setTimeout(() => resetNavigation(navigationRevision), FADE_MS);
  }, remaining);
}

function navigationHref(event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return null;
  }

  const source = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
  if (!(source instanceof HTMLAnchorElement)) return null;
  if (source.target && source.target !== '_self') return null;
  if (source.hasAttribute('download') || source.hasAttribute('data-astro-reload')) return null;

  const url = new URL(source.href, location.href);
  return url.origin === location.origin ? url.href : null;
}

runtime.listen(
  document,
  'click',
  (event) => {
    const href = navigationHref(event as MouseEvent);
    if (href !== null && href === pendingHref) event.preventDefault();
  },
  { capture: true },
);
runtime.listen(document, 'astro:before-preparation', (event) => {
  beginNavigation(event as TransitionBeforePreparationEvent);
});
runtime.listen(document, 'astro:before-swap', (event) => {
  carryNavigationState(event as TransitionBeforeSwapEvent);
});
runtime.listen(document, 'astro:page-load', finishNavigation);
runtime.onDispose(() => resetNavigation(revision));
