import type { WallpaperPhoto } from '@sshawn9/site-domain/wallpaper';
import {
  IMAGE_TRANSITION_MS,
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

/**
 * Projects wallpaper state into the DOM. It never selects, downloads or stores
 * a photo; the system owns those decisions and passes complete values in.
 */
export class WallpaperView {
  private surface?: HTMLElement;
  private surfaceObserver?: MutationObserver;
  private themeTimer?: number;
  private modeTimer?: number;
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

  /** Keeps the persistent shell's appearance when Astro prepares a new document. */
  projectTargetDocument(
    target: Document,
    preferences: AppearancePreferences,
    currentSlot: SlotName | null,
    current: WallpaperAsset | undefined,
  ): void {
    target.documentElement.dataset.wallpaperSystemStarted = 'true';
    target.documentElement.dataset.appearanceScript = 'enabled';
    target.documentElement.dataset.appearanceReady = 'true';
    projectTheme(target, preferences.theme);
    projectMode(target, preferences.enabled);
    projectIdentity(target, currentSlot, current);
  }

  connectSurface(): void {
    if (this.surface?.isConnected) return;
    const candidate = this.target.querySelector<HTMLElement>('[data-backdrop-surface]');
    if (!candidate) return;

    this.surface = candidate;
    this.surfaceObserver?.disconnect();
    this.surfaceObserver = undefined;
    if (this.activeSlot && this.activeAsset) {
      this.setSlotImage(this.activeSlot, this.activeAsset.dataUrl);
      this.reflectActive(this.activeSlot, this.activeAsset.photo);
      candidate.dataset.wallpaperHasCurrent = 'true';
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

  async presentAdvance(
    previousSlot: SlotName,
    nextSlot: SlotName,
    next: WallpaperAsset,
    animate: boolean,
  ): Promise<void> {
    this.activeSlot = nextSlot;
    this.activeAsset = next;
    this.connectSurface();
    const surface = this.surface;
    if (!surface) {
      projectIdentity(this.target, nextSlot, next);
      return;
    }

    this.setSlotImage(nextSlot, next.dataUrl);
    if (animate) {
      surface.dataset.wallpaperImageTransition = 'active';
      this.sourceWindow.getComputedStyle(surface).opacity;
    }
    this.reflectActive(nextSlot, next.photo);
    if (animate) {
      await new Promise<void>((resolve) => {
        this.sourceWindow.setTimeout(resolve, IMAGE_TRANSITION_MS);
      });
    }
    surface.removeAttribute('data-wallpaper-image-transition');
    surface.style.removeProperty(ROOT_IMAGE_PROPERTIES[previousSlot]);
  }

  renderControls(options: {
    preferences: AppearancePreferences;
    hasCurrent: boolean;
    canAdvance: boolean;
    advancing: boolean;
    downloading: boolean;
  }): void {
    const { preferences, hasCurrent, canAdvance, advancing, downloading } = options;
    for (const input of this.target.querySelectorAll<HTMLInputElement>(
      '[data-wallpaper-enabled]',
    )) {
      input.checked = preferences.enabled;
    }
    for (const input of this.target.querySelectorAll<HTMLInputElement>(
      '[data-wallpaper-auto-rotation]',
    )) {
      input.checked = preferences.autoRotation;
      input.disabled = !preferences.enabled || !hasCurrent;
      input
        .closest<HTMLElement>('[data-wallpaper-auto-rotation-control]')
        ?.toggleAttribute('data-disabled', input.disabled);
    }
    for (const button of this.target.querySelectorAll<HTMLButtonElement>('[data-wallpaper-next]')) {
      button.disabled = !preferences.enabled || !canAdvance || advancing;
      button.ariaBusy = String(advancing);
    }
    for (const button of this.target.querySelectorAll<HTMLButtonElement>(
      '[data-wallpaper-download]',
    )) {
      button.disabled = !preferences.enabled || !hasCurrent || downloading;
      button.ariaBusy = String(downloading);
    }
    for (const button of this.target.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
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
    this.updateCredit(this.activeAsset?.photo);
  }

  dispose(): void {
    this.clearThemeTimer();
    this.clearModeTimer();
    this.surfaceObserver?.disconnect();
    this.surfaceObserver = undefined;
  }

  private setSlotImage(slot: SlotName, dataUrl: string): void {
    const owner = this.surface ?? this.target.documentElement;
    owner.style.setProperty(ROOT_IMAGE_PROPERTIES[slot], cssImage(dataUrl));
  }

  private reflectActive(slot: SlotName, photo: WallpaperPhoto): void {
    const root = this.target.documentElement;
    root.dataset.wallpaperActiveSlot = slot;
    root.dataset.wallpaperPhotoId = photo.id;
    root.dataset.wallpaperHasCurrent = 'true';
    if (this.surface) {
      this.surface.dataset.wallpaperActiveSlot = slot;
      this.surface.dataset.wallpaperPhotoId = photo.id;
      this.surface.dataset.wallpaperHasCurrent = 'true';
    }
    this.updateCredit(photo);
  }

  private updateCredit(photo: WallpaperPhoto | undefined): void {
    const surface = this.surface;
    if (!surface) return;
    const credit = surface.querySelector<HTMLElement>('[data-wallpaper-credit]');
    const photographer = surface.querySelector<HTMLAnchorElement>(
      '[data-wallpaper-credit-photographer]',
    );
    const photoLink = surface.querySelector<HTMLAnchorElement>('[data-wallpaper-credit-photo]');
    if (!credit || !photographer || !photoLink) return;

    if (photo) {
      if (photographer.textContent !== photo.photographerName) {
        photographer.textContent = photo.photographerName;
      }
      if (photographer.href !== photo.photographerUrl) photographer.href = photo.photographerUrl;
      if (photoLink.href !== photo.photoUrl) photoLink.href = photo.photoUrl;
      credit.dataset.wallpaperPhotoId = photo.id;
    }
    credit.hidden = !photo || this.target.documentElement.dataset.wallpaperMode !== 'scenic';
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
