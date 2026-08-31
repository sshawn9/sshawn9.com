import type {
  TransitionBeforePreparationEvent,
  TransitionBeforeSwapEvent,
} from 'astro:transitions/client';
import { decideBuildNavigation, readDocumentBuildId } from './build-generation';
import { CURRENT_BUILD_ID } from './build-identity';
import { prepareTargetDocumentPreferences } from './document-preferences';
import { prepareTargetFonts } from './font-coordinator';
import { persistCurrentScroll, restoreCurrentScroll } from './scroll-state';

let installed = false;
let restoring = false;
let saveFrame = 0;
let pendingNavigationType = 'push';

function setProgress(active: boolean) {
  const progress = document.querySelector<HTMLElement>('[data-navigation-progress]');
  if (progress) {
    progress.dataset.active = String(active);
  }
}

function scheduleScrollSave() {
  if (restoring || saveFrame !== 0) {
    return;
  }

  saveFrame = requestAnimationFrame(() => {
    saveFrame = 0;
    persistCurrentScroll();
  });
}

async function prepareNavigation(rawEvent: Event) {
  const event = rawEvent as TransitionBeforePreparationEvent;
  pendingNavigationType = event.navigationType;
  const isTraversal = event.navigationType === 'traverse';

  if (isTraversal) {
    restoring = true;
    if (saveFrame !== 0) {
      cancelAnimationFrame(saveFrame);
      saveFrame = 0;
    }
    event.signal.addEventListener(
      'abort',
      () => {
        restoring = false;
      },
      { once: true },
    );
  } else {
    persistCurrentScroll();
  }

  setProgress(true);
  const frameworkLoader = event.loader;
  event.loader = async () => {
    await frameworkLoader();
    if (event.defaultPrevented || event.signal.aborted) {
      restoring = false;
      return;
    }

    const generation = decideBuildNavigation(
      CURRENT_BUILD_ID,
      readDocumentBuildId(document),
      readDocumentBuildId(event.newDocument),
    );
    if (generation.mode === 'document') {
      // The pinned Astro router turns a cancelled preparation into location.href.
      // Do not allow old runtime code to swap or initialize the target document.
      event.preventDefault();
      return;
    }

    await prepareTargetFonts(event.newDocument, event.signal);
  };
}

function prepareSwap(rawEvent: Event) {
  const event = rawEvent as TransitionBeforeSwapEvent;
  prepareTargetDocumentPreferences(event.newDocument);
}

function afterSwap() {
  if (pendingNavigationType !== 'traverse') {
    return;
  }

  requestAnimationFrame(() => {
    restoreCurrentScroll();
    requestAnimationFrame(() => {
      restoring = false;
    });
  });
}

export function installNavigationCoordinator() {
  if (installed) {
    return;
  }
  installed = true;

  document.addEventListener('astro:before-preparation', prepareNavigation);
  document.addEventListener('astro:before-swap', prepareSwap);
  document.addEventListener('astro:after-swap', afterSwap);
  document.addEventListener('astro:page-load', () => setProgress(false));
  document.addEventListener('scroll', scheduleScrollSave, true);
  window.addEventListener('pagehide', persistCurrentScroll);
}
