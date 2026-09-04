import type { WallpaperPhoto } from '@sshawn9/site-domain/wallpaper';
import {
  IMAGE_TRANSITION_SETTLE_WATCHDOG_MS,
  IMAGE_TRANSITION_START_WATCHDOG_MS,
  MODE_TRANSITION_MS,
  THEME_TRANSITION_MS,
  type AppearancePreferences,
  type SlotName,
  type Theme,
  type WallpaperAsset,
} from './model';

const ROOT_IMAGE_PROPERTIES = {
  a: '--wallpaper-slot-a-image',
  b: '--wallpaper-slot-b-image',
} as const;

type OpacityTransitionEvent = 'transitionstart' | 'transitionend' | 'transitioncancel';

export interface WallpaperControls {
  preferences: AppearancePreferences;
  hasCurrent: boolean;
  canAdvance: boolean;
  advancing: boolean;
  downloading: boolean;
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
  private surface?: HTMLElement;
  private visual?: HTMLElement;
  private surfaceObserver?: MutationObserver;
  private themeTimer?: number;
  private modeTimer?: number;
  private readonly imageTransitionFinishes = new Set<() => void>();
  private activeSlot: SlotName | null = null;
  private activeAsset?: WallpaperAsset;

  constructor(
    private readonly target: Document,
    private readonly sourceWindow: Window,
  ) {}

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
      root.style.setProperty(ROOT_IMAGE_PROPERTIES[currentSlot], cssImage(current.dataUrl));
    }
    this.connectSurface();
    if (!this.surface) {
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

  connectSurface(): void {
    if (this.surface?.isConnected) return;
    this.surface = undefined;
    this.visual = undefined;
    const candidate = this.target.querySelector<HTMLElement>('[data-backdrop-surface]');
    if (!candidate) return;

    this.surface = candidate;
    this.visual = candidate.querySelector<HTMLElement>('[data-wallpaper-visual]') ?? undefined;
    this.surfaceObserver?.disconnect();
    this.surfaceObserver = undefined;
    if (this.activeSlot && this.activeAsset) {
      if (!this.currentImageLayer()) {
        this.setSlotImage(this.activeSlot, this.activeAsset.dataUrl);
        const current = this.slotImageLayer(this.activeSlot);
        if (current) current.dataset.wallpaperCurrent = '';
      }
      this.reflectActive(this.activeSlot, this.activeAsset.photo);
      // The root value existed only so the body could paint correctly before
      // this persistent surface was parsed. The surface owns it from here on.
      this.target.documentElement.style.removeProperty(ROOT_IMAGE_PROPERTIES[this.activeSlot]);
    }
    this.updateCredit(this.activeAsset?.photo);
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
    const surface = this.surface;
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
    this.connectSurface();
    const surface = this.surface;
    if (!surface) {
      const root = this.target.documentElement;
      root.style.setProperty(ROOT_IMAGE_PROPERTIES[slot], cssImage(asset.dataUrl));
      projectIdentity(this.target, slot, asset);
      return;
    }

    this.setSlotImage(slot, asset.dataUrl);
    const current = this.slotImageLayer(slot);
    if (current) current.dataset.wallpaperCurrent = '';
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
    previousSlot: SlotName,
    nextSlot: SlotName,
    next: WallpaperAsset,
    animate: boolean,
  ): Promise<void> {
    const previous = this.activeAsset;
    this.connectSurface();
    this.activeSlot = nextSlot;
    this.activeAsset = next;
    const images = this.imageContainer();
    if (!images) {
      this.setSlotImage(nextSlot, next.dataUrl);
      this.reflectActive(nextSlot, next.photo);
      this.clearSlotImage(previousSlot);
      return Promise.resolve();
    }

    const outgoingLayer = this.currentImageLayer() ?? this.slotImageLayer(previousSlot);
    // Storage slots can be reused as soon as the next presentation starts.
    // Retiring pixels therefore become independent DOM layers with no slot identity.
    for (const slotLayer of images.querySelectorAll<HTMLElement>('[data-wallpaper-slot]')) {
      if (slotLayer !== outgoingLayer) slotLayer.remove();
    }
    if (outgoingLayer) {
      if (outgoingLayer.hasAttribute('data-wallpaper-slot')) {
        if (previous) {
          outgoingLayer.style.backgroundImage = cssImage(previous.dataUrl);
        }
        outgoingLayer.removeAttribute('data-wallpaper-slot');
        this.clearSlotImage(previousSlot);
      }
    }

    const incomingLayer = this.target.createElement('div');
    incomingLayer.className = 'wallpaper__image';
    incomingLayer.style.backgroundImage = cssImage(next.dataUrl);
    if (animate) incomingLayer.dataset.wallpaperTransitioning = '';
    images.append(incomingLayer);

    let outgoingOpacity = 0;
    let transitionStarted: Promise<void> | undefined;
    if (animate) {
      if (outgoingLayer) {
        outgoingLayer.dataset.wallpaperTransitioning = '';
        outgoingOpacity = Number.parseFloat(
          this.sourceWindow.getComputedStyle(outgoingLayer).opacity,
        );
      }
      this.sourceWindow.getComputedStyle(incomingLayer).opacity;
      transitionStarted = this.waitForOpacityTransition(
        incomingLayer,
        ['transitionstart'],
        IMAGE_TRANSITION_START_WATCHDOG_MS,
      );
      void this.waitForOpacityTransition(
        incomingLayer,
        ['transitionend'],
        IMAGE_TRANSITION_SETTLE_WATCHDOG_MS,
      ).then(() => {
        if (incomingLayer.hasAttribute('data-wallpaper-current')) {
          incomingLayer.removeAttribute('data-wallpaper-transitioning');
        }
      });
      if (outgoingLayer && outgoingOpacity > 0) this.retireImageLayer(outgoingLayer);
    }
    outgoingLayer?.removeAttribute('data-wallpaper-current');
    incomingLayer.dataset.wallpaperCurrent = '';
    this.reflectActive(nextSlot, next.photo);

    if (!animate) {
      this.finishImageTransitions();
      outgoingLayer?.remove();
    } else if (!outgoingLayer || outgoingOpacity <= 0) {
      outgoingLayer?.remove();
    }
    return transitionStarted ?? Promise.resolve();
  }

  renderControls(options: WallpaperControls): void {
    projectControls(this.target, options);
    this.updateCredit(this.activeAsset?.photo);
  }

  dispose(): void {
    this.clearThemeTimer();
    this.clearModeTimer();
    this.finishImageTransitions();
    this.surfaceObserver?.disconnect();
    this.surfaceObserver = undefined;
  }

  private setSlotImage(slot: SlotName, dataUrl: string): void {
    const owner = this.visual ?? this.surface ?? this.target.documentElement;
    owner.style.setProperty(ROOT_IMAGE_PROPERTIES[slot], cssImage(dataUrl));
  }

  private clearSlotImage(slot: SlotName): void {
    const owner = this.visual ?? this.surface ?? this.target.documentElement;
    owner.style.removeProperty(ROOT_IMAGE_PROPERTIES[slot]);
  }

  private imageContainer(): HTMLElement | undefined {
    return this.visual?.querySelector<HTMLElement>('.wallpaper__images') ?? undefined;
  }

  private currentImageLayer(): HTMLElement | undefined {
    return this.visual?.querySelector<HTMLElement>('[data-wallpaper-current]') ?? undefined;
  }

  private slotImageLayer(slot: SlotName): HTMLElement | undefined {
    return (
      (this.visual ?? this.surface)?.querySelector<HTMLElement>(
        `.wallpaper__image[data-wallpaper-slot="${slot}"]`,
      ) ?? undefined
    );
  }

  private waitForOpacityTransition(
    layer: HTMLElement,
    eventNames: readonly OpacityTransitionEvent[],
    watchdogMs: number,
    accepts: (event: TransitionEvent) => boolean = () => true,
  ): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let watchdog: number | undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (watchdog !== undefined) this.sourceWindow.clearTimeout(watchdog);
        for (const eventName of eventNames) {
          layer.removeEventListener(eventName, handleTransition);
        }
        this.imageTransitionFinishes.delete(finish);
        resolve();
      };
      const handleTransition = (event: TransitionEvent): void => {
        if (event.target !== layer || event.propertyName !== 'opacity' || !accepts(event)) return;
        finish();
      };

      for (const eventName of eventNames) {
        layer.addEventListener(eventName, handleTransition);
      }
      this.imageTransitionFinishes.add(finish);
      watchdog = this.sourceWindow.setTimeout(finish, watchdogMs);
    });
  }

  private retireImageLayer(layer: HTMLElement): void {
    void this.waitForOpacityTransition(
      layer,
      ['transitionend', 'transitioncancel'],
      IMAGE_TRANSITION_SETTLE_WATCHDOG_MS,
      () => Number.parseFloat(this.sourceWindow.getComputedStyle(layer).opacity) <= 0,
    ).then(() => {
      layer.removeAttribute('data-wallpaper-transitioning');
      if (!layer.hasAttribute('data-wallpaper-current')) layer.remove();
    });
  }

  private finishImageTransitions(): void {
    for (const finish of [...this.imageTransitionFinishes]) finish();
  }

  private reflectActive(slot: SlotName, photo: WallpaperPhoto): void {
    const root = this.target.documentElement;
    root.dataset.wallpaperActiveSlot = slot;
    root.dataset.wallpaperPhotoId = photo.id;
    root.dataset.wallpaperHasCurrent = 'true';
    if (this.surface) {
      projectSurfaceIdentity(this.surface, slot, this.activeAsset);
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
