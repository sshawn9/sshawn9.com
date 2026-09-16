import type { WallpaperPhoto } from '@sshawn9/site-domain/wallpaper';
import {
  IMAGE_FADE_MS,
  IMAGE_TRANSITION_SETTLE_WATCHDOG_MS,
  IMAGE_TRANSITION_START_WATCHDOG_MS,
  MODE_TRANSITION_MS,
  THEME_TRANSITION_MS,
  type AppearancePreferences,
  type SlotName,
  type Theme,
  type WallpaperAsset,
} from './model';

const INITIAL_IMAGE_PROPERTY = '--wallpaper-initial-image';
type PresentationResult = 'shown' | 'discarded';
type SurfaceBinding = { surface: HTMLElement; visual: HTMLElement; images: HTMLElement };

export interface WallpaperControls {
  preferences: AppearancePreferences;
  hasCurrent: boolean;
  canAdvance: boolean;
  advancing: boolean;
  downloading: boolean;
}

export interface WallpaperAdvancePresentation {
  started: Promise<void>;
  finished: Promise<PresentationResult>;
}

function cssImage(dataUrl: string): string {
  return `url(${JSON.stringify(dataUrl)})`;
}

function updateThemeColor(target: Document, theme: Theme): void {
  target
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#070a12' : '#f7f8fb');
}

function projectTheme(target: Document, theme: Theme): void {
  const root = target.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  updateThemeColor(target, theme);
}

function projectMode(target: Document, enabled: boolean): void {
  const mode = enabled ? 'scenic' : 'default';
  if (target.documentElement.dataset.wallpaperMode !== mode) {
    target.documentElement.dataset.wallpaperMode = mode;
  }
}

function projectIdentity(
  target: Document,
  slot: SlotName | null,
  asset: WallpaperAsset | undefined,
): void {
  const root = target.documentElement;
  if (!slot || !asset) {
    delete root.dataset.wallpaperActiveSlot;
    delete root.dataset.wallpaperPhotoId;
    delete root.dataset.wallpaperHasCurrent;
    return;
  }
  root.dataset.wallpaperActiveSlot = slot;
  root.dataset.wallpaperPhotoId = asset.photo.id;
  root.dataset.wallpaperHasCurrent = 'true';
}

function projectSurfaceIdentity(
  surface: HTMLElement,
  slot: SlotName | null,
  asset: WallpaperAsset | undefined,
): void {
  if (!slot || !asset) {
    delete surface.dataset.wallpaperActiveSlot;
    delete surface.dataset.wallpaperPhotoId;
    delete surface.dataset.wallpaperHasCurrent;
    return;
  }
  surface.dataset.wallpaperActiveSlot = slot;
  surface.dataset.wallpaperPhotoId = asset.photo.id;
  surface.dataset.wallpaperHasCurrent = 'true';
}

function projectCredit(target: Document, photo: WallpaperPhoto | undefined): void {
  const surface = target.querySelector<HTMLElement>('[data-backdrop-surface]');
  if (!surface) return;
  const credit = surface.querySelector<HTMLElement>('[data-wallpaper-credit]');
  const photographer = surface.querySelector<HTMLAnchorElement>(
    '[data-wallpaper-credit-photographer]',
  );
  const photoLink = surface.querySelector<HTMLAnchorElement>('[data-wallpaper-credit-photo]');
  if (!credit || !photographer || !photoLink) return;

  if (photo) {
    photographer.textContent = photo.photographerName;
    photographer.href = photo.photographerUrl;
    photoLink.href = photo.photoUrl;
    credit.dataset.wallpaperPhotoId = photo.id;
  }
  credit.hidden = !photo || target.documentElement.dataset.wallpaperMode !== 'scenic';
}

function projectControls(target: Document, options: WallpaperControls): void {
  const { preferences, hasCurrent, canAdvance, advancing, downloading } = options;
  for (const input of target.querySelectorAll<HTMLInputElement>('[data-wallpaper-enabled]')) {
    input.checked = preferences.enabled;
  }
  for (const input of target.querySelectorAll<HTMLInputElement>('[data-wallpaper-auto-rotation]')) {
    input.checked = preferences.autoRotation;
    input.disabled = !preferences.enabled || !hasCurrent;
    input
      .closest<HTMLElement>('[data-wallpaper-auto-rotation-control]')
      ?.toggleAttribute('data-disabled', input.disabled);
  }
  for (const button of target.querySelectorAll<HTMLButtonElement>('[data-wallpaper-next]')) {
    button.disabled = !preferences.enabled || !canAdvance || advancing;
    button.ariaBusy = String(advancing);
  }
  for (const button of target.querySelectorAll<HTMLButtonElement>('[data-wallpaper-download]')) {
    button.disabled = !preferences.enabled || !hasCurrent || downloading;
    button.ariaBusy = String(downloading);
  }
  for (const button of target.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
    const label =
      preferences.theme === 'dark'
        ? button.dataset.themeToLightLabel
        : button.dataset.themeToDarkLabel;
    if (label) {
      button.ariaLabel = label;
      button.title = label;
    }
    button.setAttribute('aria-pressed', String(preferences.theme === 'dark'));
  }
}

/**
 * Projects wallpaper state into the DOM. It never selects, downloads or stores
 * a photo; the system owns those decisions and passes complete values in.
 */
export class WallpaperView {
  private binding?: SurfaceBinding;
  private currentLayer?: HTMLElement;
  private controls?: WallpaperControls;
  private surfaceObserver?: MutationObserver;
  private themeTimer?: number;
  private modeTimer?: number;
  private readonly fades = new Map<HTMLElement, (result: PresentationResult) => void>();
  private activeSlot: SlotName | null = null;
  private activeAsset?: WallpaperAsset;

  constructor(
    private readonly target: Document,
    private readonly sourceWindow: Window,
  ) {}

  get ready(): boolean {
    return Boolean(
      this.binding?.surface.isConnected &&
      this.binding.visual.isConnected &&
      this.currentLayer?.parentElement === this.binding.images,
    );
  }

  /** Applies persisted state during the single synchronous startup flow. */
  boot(
    preferences: AppearancePreferences,
    currentSlot: SlotName | null,
    current: WallpaperAsset | undefined,
  ): void {
    this.activeSlot = currentSlot;
    this.activeAsset = current;
    const root = this.target.documentElement;
    root.dataset.wallpaperSystemStarted = 'true';
    root.dataset.appearanceScript = 'enabled';
    root.dataset.appearanceReady = 'true';
    projectTheme(this.target, preferences.theme);
    projectMode(this.target, preferences.enabled);
    projectIdentity(this.target, currentSlot, current);
    if (currentSlot && current) {
      root.style.setProperty(INITIAL_IMAGE_PROPERTY, cssImage(current.dataUrl));
    }
    this.connectSurface();
    if (!this.ready) {
      const MutationObserverConstructor = (this.sourceWindow as Window & typeof globalThis)
        .MutationObserver;
      const observer = new MutationObserverConstructor(() => {
        this.connectSurface();
      });
      this.surfaceObserver = observer;
      observer.observe(root, { childList: true, subtree: true });
    }
  }

  /** Projects current appearance into Astro's target document before its atomic swap. */
  projectTargetDocument(
    target: Document,
    preferences: AppearancePreferences,
    currentSlot: SlotName | null,
    current: WallpaperAsset | undefined,
    controls: WallpaperControls,
  ): void {
    target.documentElement.dataset.wallpaperSystemStarted = 'true';
    target.documentElement.dataset.appearanceScript = 'enabled';
    target.documentElement.dataset.appearanceReady = 'true';
    projectTheme(target, preferences.theme);
    projectMode(target, preferences.enabled);
    projectIdentity(target, currentSlot, current);
    const surface = target.querySelector<HTMLElement>('[data-backdrop-surface]');
    if (surface) projectSurfaceIdentity(surface, currentSlot, current);
    projectCredit(target, current?.photo);
    projectControls(target, controls);
  }

  connectSurface(): boolean {
    if (this.ready) return true;
    const candidate = this.target.querySelector<HTMLElement>('[data-backdrop-surface]');
    const visual = candidate?.querySelector<HTMLElement>('[data-wallpaper-visual]');
    const images = visual?.querySelector<HTMLElement>('.wallpaper__images');
    const initial = images?.querySelector<HTMLElement>('[data-wallpaper-initial]');
    const persisted = this.currentLayer?.parentElement === images ? this.currentLayer : undefined;
    // Do not publish a partial parser-created subtree or stop observing it.
    if (
      !candidate ||
      !visual ||
      !images ||
      (!persisted && !initial) ||
      !visual.querySelector('.wallpaper__scrim') ||
      !candidate.querySelector('[data-wallpaper-credit-photographer]') ||
      !candidate.querySelector('[data-wallpaper-credit-photo]')
    )
      return false;

    if (!persisted) {
      this.discardFades();
      this.currentLayer = initial!;
      this.setCurrentImage(this.activeAsset);
    }
    this.binding = { surface: candidate, visual, images };
    projectSurfaceIdentity(candidate, this.activeSlot, this.activeAsset);
    this.target.documentElement.style.removeProperty(INITIAL_IMAGE_PROPERTY);
    this.updateCredit(this.activeAsset?.photo);
    this.surfaceObserver?.disconnect();
    this.surfaceObserver = undefined;
    if (this.controls) this.renderControls(this.controls);
    return true;
  }

  setTheme(theme: Theme, animate: boolean): void {
    const root = this.target.documentElement;
    if (root.dataset.theme === theme) return;
    this.clearThemeTimer();
    if (animate) {
      root.dataset.themeTransition = 'active';
      this.sourceWindow.getComputedStyle(root).getPropertyValue('--page');
    } else {
      delete root.dataset.themeTransition;
    }
    projectTheme(this.target, theme);
    if (animate) {
      this.themeTimer = this.sourceWindow.setTimeout(() => {
        this.themeTimer = undefined;
        delete root.dataset.themeTransition;
      }, THEME_TRANSITION_MS);
    }
  }

  setMode(enabled: boolean, animate: boolean): void {
    const nextMode = enabled ? 'scenic' : 'default';
    if (this.target.documentElement.dataset.wallpaperMode === nextMode) return;
    this.clearModeTimer();
    const surface = this.binding?.surface;
    if (surface && animate) {
      surface.dataset.wallpaperModeTransition = 'active';
      this.sourceWindow.getComputedStyle(surface).opacity;
    } else {
      surface?.removeAttribute('data-wallpaper-mode-transition');
    }
    projectMode(this.target, enabled);
    if (surface && animate) {
      this.modeTimer = this.sourceWindow.setTimeout(() => {
        this.modeTimer = undefined;
        surface.removeAttribute('data-wallpaper-mode-transition');
      }, MODE_TRANSITION_MS);
    }
  }

  showFirstCurrent(slot: SlotName, asset: WallpaperAsset, animate: boolean): void {
    this.activeSlot = slot;
    this.activeAsset = asset;
    if (!this.connectSurface()) {
      const root = this.target.documentElement;
      root.style.setProperty(INITIAL_IMAGE_PROPERTY, cssImage(asset.dataUrl));
      projectIdentity(this.target, slot, asset);
      return;
    }
    const surface = this.binding!.surface;
    this.setCurrentImage(asset);
    surface.dataset.wallpaperActiveSlot = slot;
    if (animate) {
      surface.dataset.wallpaperModeTransition = 'active';
      this.sourceWindow.getComputedStyle(surface).opacity;
    }
    surface.dataset.wallpaperHasCurrent = 'true';
    this.reflectActive(slot, asset.photo);
    if (animate) {
      this.clearModeTimer();
      this.modeTimer = this.sourceWindow.setTimeout(() => {
        this.modeTimer = undefined;
        surface.removeAttribute('data-wallpaper-mode-transition');
      }, MODE_TRANSITION_MS);
    }
  }

  presentAdvance(
    nextSlot: SlotName,
    next: WallpaperAsset,
    animate: boolean,
  ): WallpaperAdvancePresentation {
    if (!this.connectSurface()) throw new Error('Wallpaper surface is not ready for presentation.');
    const images = this.binding!.images;
    this.activeSlot = nextSlot;
    this.activeAsset = next;
    const incomingLayer = this.target.createElement('div');
    incomingLayer.className = 'wallpaper__image';
    incomingLayer.style.backgroundImage = cssImage(next.dataUrl);
    images.append(incomingLayer);
    this.currentLayer?.removeAttribute('data-wallpaper-current');
    this.currentLayer = incomingLayer;
    incomingLayer.dataset.wallpaperCurrent = '';
    this.reflectActive(nextSlot, next.photo);

    if (!animate) {
      this.removeCoveredLayers(incomingLayer);
      return { started: Promise.resolve(), finished: Promise.resolve('shown') };
    }
    return this.fadeIn(incomingLayer);
  }

  renderControls(options: WallpaperControls): void {
    this.controls = options;
    projectControls(this.target, { ...options, canAdvance: options.canAdvance && this.ready });
    this.updateCredit(this.activeAsset?.photo);
  }

  finishPresentation(): void {
    if (this.currentLayer) this.fades.get(this.currentLayer)?.('shown');
  }

  dispose(): void {
    this.clearThemeTimer();
    this.clearModeTimer();
    this.discardFades();
    this.surfaceObserver?.disconnect();
    this.surfaceObserver = undefined;
  }

  private setCurrentImage(asset: WallpaperAsset | undefined): void {
    const layer = this.currentLayer!;
    layer.style.backgroundImage = asset ? cssImage(asset.dataUrl) : 'none';
    layer.removeAttribute('data-wallpaper-initial');
    layer.toggleAttribute('data-wallpaper-current', Boolean(asset));
  }

  private removeCoveredLayers(layer: HTMLElement): void {
    // Never touch newer layers above this one, even when completions arrive late.
    while (layer.previousElementSibling instanceof HTMLElement) {
      const covered = layer.previousElementSibling;
      this.fades.get(covered)?.('discarded');
      covered.remove();
    }
  }

  private fadeIn(layer: HTMLElement): WallpaperAdvancePresentation {
    let releaseStart!: () => void;
    let releaseFinish!: (result: PresentationResult) => void;
    const started = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const finished = new Promise<PresentationResult>((resolve) => {
      releaseFinish = resolve;
    });
    let animation: Animation | undefined;
    let frame: number | undefined;
    let startTimer: number | undefined;
    let endTimer: number | undefined;
    let settled = false;
    const markStarted = () => {
      if (frame !== undefined) this.sourceWindow.cancelAnimationFrame(frame);
      this.sourceWindow.clearTimeout(startTimer);
      frame = startTimer = undefined;
      releaseStart();
    };
    const settle = (result: PresentationResult) => {
      if (settled) return;
      settled = true;
      this.fades.delete(layer);
      markStarted();
      this.sourceWindow.clearTimeout(endTimer);
      layer.removeAttribute('data-wallpaper-transitioning');
      // The underlying style is fully opaque: cancel releases the animation
      // effect without leaving a filling animation or exposing the backdrop.
      animation?.cancel();
      if (result === 'shown') this.removeCoveredLayers(layer);
      releaseFinish(result);
    };
    this.fades.set(layer, settle);
    layer.dataset.wallpaperTransitioning = '';
    startTimer = this.sourceWindow.setTimeout(
      () => settle('shown'),
      IMAGE_TRANSITION_START_WATCHDOG_MS,
    );
    endTimer = this.sourceWindow.setTimeout(
      () => settle('shown'),
      IMAGE_TRANSITION_SETTLE_WATCHDOG_MS,
    );
    try {
      animation = layer.animate([{ opacity: 0 }, { opacity: 1 }], {
        id: 'wallpaper-fade',
        duration: IMAGE_FADE_MS,
        easing: 'ease',
        fill: 'both',
      });
      const confirmStart = () => {
        if (settled) return;
        if (Number(animation!.currentTime) > 0) markStarted();
        else frame = this.sourceWindow.requestAnimationFrame(confirmStart);
      };
      void animation.ready.then(confirmStart, () => settle('shown'));
      // Unexpected browser cancellation also commits the already decoded image;
      // explicit disposal/coverage settles as discarded before cancelling it.
      void animation.finished.then(
        () => settle('shown'),
        () => settle('shown'),
      );
    } catch (error) {
      settle('shown');
      this.sourceWindow.reportError(error);
    }
    return { started, finished };
  }

  private discardFades(): void {
    for (const settle of [...this.fades.values()]) settle('discarded');
  }

  private reflectActive(slot: SlotName, photo: WallpaperPhoto): void {
    const root = this.target.documentElement;
    root.dataset.wallpaperActiveSlot = slot;
    root.dataset.wallpaperPhotoId = photo.id;
    root.dataset.wallpaperHasCurrent = 'true';
    if (this.binding) {
      projectSurfaceIdentity(this.binding.surface, slot, this.activeAsset);
    }
    this.updateCredit(photo);
  }

  private updateCredit(photo: WallpaperPhoto | undefined): void {
    projectCredit(this.target, photo);
  }

  private clearThemeTimer(): void {
    if (this.themeTimer !== undefined) this.sourceWindow.clearTimeout(this.themeTimer);
    this.themeTimer = undefined;
  }

  private clearModeTimer(): void {
    if (this.modeTimer !== undefined) this.sourceWindow.clearTimeout(this.modeTimer);
    this.modeTimer = undefined;
  }
}
