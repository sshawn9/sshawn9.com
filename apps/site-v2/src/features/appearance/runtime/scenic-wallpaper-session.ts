import {
  WALLPAPER_ENDPOINT,
  isWallpaperManifest,
  type WallpaperManifest,
  type WallpaperPhoto,
} from '@sshawn9/site-domain/wallpaper';
import { BackdropPresenter } from './backdrop-presenter';
import {
  readAppearancePreferences,
  WALLPAPER_AUTO_ROTATION_STORAGE_KEY,
  WALLPAPER_ENABLED_STORAGE_KEY,
  WALLPAPER_LEGACY_ROTATION_STORAGE_KEY,
  wallpaperImageUrl,
  writeWallpaperSession,
  type WallpaperSessionSnapshot,
} from './document-preferences';
import { captureWallpaperBootImage } from './wallpaper-boot-image';
import { downloadWallpaperPhoto } from './wallpaper-download';
import {
  reconcileWallpaperQueue,
  replenishWallpaperQueue,
  restoreWallpaperQueue,
} from './wallpaper-queue';

const MIN_ROTATION_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ROTATION_INTERVAL_MS = 9 * 60 * 1000;
const MANIFEST_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const MANIFEST_RETRY_INTERVAL_MS = 30 * 1000;
const ADVANCE_TRANSACTION_TIMEOUT_MS = 10_000;

type ScenicWallpaperDependencies = {
  target: Document;
  sourceWindow: Window;
  shell: HTMLElement;
  backdrop: BackdropPresenter;
};

type WallpaperAdvanceTransaction = {
  readonly promise: Promise<void>;
  cancel: () => void;
};

/** Owns scenic-photo state, remote data, controls, persistence and scheduling. */
export class ScenicWallpaperSession {
  readonly #target: Document;
  readonly #window: Window;
  readonly #shell: HTMLElement;
  readonly #backdrop: BackdropPresenter;
  readonly #reducedMotion: MediaQueryList;
  #manifest?: WallpaperManifest;
  #manifestPromise?: Promise<WallpaperManifest | undefined>;
  #currentPhoto?: WallpaperPhoto;
  #currentImageUrl?: string;
  #bootImageDataUrl?: string;
  #queueIds: string[] = [];
  #rotationTimer?: number;
  #manifestTimer?: number;
  #enabled = true;
  #autoRotation = true;
  #ready = false;
  #initializing = false;
  #advanceTransaction?: WallpaperAdvanceTransaction;
  #downloading = false;
  #revision = 0;

  constructor({ target, sourceWindow, shell, backdrop }: ScenicWallpaperDependencies) {
    this.#target = target;
    this.#window = sourceWindow;
    this.#shell = shell;
    this.#backdrop = backdrop;
    this.#reducedMotion = sourceWindow.matchMedia('(prefers-reduced-motion: reduce)');

    try {
      const preferences = readAppearancePreferences(
        sourceWindow.localStorage,
        sourceWindow.sessionStorage,
        sourceWindow.matchMedia('(prefers-color-scheme: dark)').matches,
      );
      this.#enabled = preferences.wallpaperEnabled;
      this.#autoRotation = preferences.wallpaperAutoRotation;
      this.#restoreSession(preferences.wallpaperSession);
    } catch {
      this.#restoreSession(undefined);
    }
  }

  start(): () => void {
    this.#shell.addEventListener('click', this.#handleClick);
    this.#shell.addEventListener('change', this.#handleChange);
    this.#target.addEventListener('visibilitychange', this.#handleVisibility);
    this.#target.addEventListener('astro:after-swap', this.#render);
    this.#window.addEventListener('online', this.#handleOnline);
    this.#reducedMotion.addEventListener('change', this.#scheduleRotation);
    this.#setMode();
    this.#render();
    if (this.#enabled) void this.#ensurePhoto();

    return () => {
      this.#advanceTransaction?.cancel();
      this.#revision += 1;
      this.#clearRotationTimer();
      this.#clearManifestTimer();
      this.#shell.removeEventListener('click', this.#handleClick);
      this.#shell.removeEventListener('change', this.#handleChange);
      this.#target.removeEventListener('visibilitychange', this.#handleVisibility);
      this.#target.removeEventListener('astro:after-swap', this.#render);
      this.#window.removeEventListener('online', this.#handleOnline);
      this.#reducedMotion.removeEventListener('change', this.#scheduleRotation);
    };
  }

  #restoreSession(snapshot: WallpaperSessionSnapshot | undefined): void {
    this.#currentPhoto = snapshot?.photo;
    this.#currentImageUrl = snapshot?.imageUrl;
    this.#bootImageDataUrl = snapshot?.bootImageDataUrl;
    this.#queueIds = snapshot?.queueIds ?? [];
    this.#ready = Boolean(
      snapshot?.bootImageDataUrl &&
      this.#backdrop.ready &&
      this.#backdrop.activePhotoId === snapshot.photo.id,
    );
    if (this.#ready && snapshot) this.#backdrop.updateCredit(snapshot.photo);
  }

  #setMode(): void {
    this.#target.documentElement.dataset.wallpaperMode = this.#enabled ? 'scenic' : 'default';
  }

  #render = (): void => {
    for (const input of this.#target.querySelectorAll<HTMLInputElement>(
      '[data-wallpaper-enabled]',
    )) {
      input.checked = this.#enabled;
    }
    for (const input of this.#target.querySelectorAll<HTMLInputElement>(
      '[data-wallpaper-auto-rotation]',
    )) {
      input.checked = this.#autoRotation;
      input.disabled = !this.#enabled || !this.#ready;
      input
        .closest<HTMLElement>('[data-wallpaper-auto-rotation-control]')
        ?.toggleAttribute('data-disabled', input.disabled);
    }

    const canAdvance =
      this.#enabled &&
      this.#ready &&
      Boolean(this.#manifest?.photos.some((photo) => photo.id !== this.#currentPhoto?.id));
    const advancePending = Boolean(this.#advanceTransaction);
    for (const button of this.#target.querySelectorAll<HTMLButtonElement>(
      '[data-wallpaper-next]',
    )) {
      button.disabled = !canAdvance;
      button.ariaBusy = String(this.#initializing || advancePending);
    }
    for (const button of this.#target.querySelectorAll<HTMLButtonElement>(
      '[data-wallpaper-download]',
    )) {
      button.disabled = !this.#enabled || !this.#ready || this.#downloading;
      button.ariaBusy = String(this.#downloading);
    }

    this.#backdrop.setCreditVisible(this.#enabled && this.#ready && Boolean(this.#currentPhoto));
  };

  #handleClick = (event: Event): void => {
    const ElementConstructor = (this.#window as Window & typeof globalThis).Element;
    const source = event
      .composedPath()
      .find((candidate): candidate is Element => candidate instanceof ElementConstructor);
    if (source?.closest('[data-wallpaper-next]')) void this.#advance();
    else if (source?.closest('[data-wallpaper-download]')) void this.#download();
  };

  #handleChange = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof (this.#window as Window & typeof globalThis).HTMLInputElement)) return;
    if (input.matches('[data-wallpaper-enabled]')) void this.#setEnabled(input.checked);
    else if (input.matches('[data-wallpaper-auto-rotation]')) {
      this.#setAutoRotation(input.checked);
    }
  };

  #handleVisibility = (): void => {
    if (this.#target.hidden) {
      this.#clearRotationTimer();
      this.#clearManifestTimer();
      return;
    }
    if (this.#enabled && !this.#manifest) void this.#ensurePhoto();
    this.#scheduleRotation();
    this.#scheduleManifestRefresh();
  };

  #handleOnline = (): void => {
    if (this.#enabled && !this.#manifest) void this.#ensurePhoto();
  };

  async #loadManifest(revalidate = false): Promise<WallpaperManifest | undefined> {
    if (this.#manifestPromise) return this.#manifestPromise;
    if (!revalidate && this.#manifest) return this.#manifest;

    this.#manifestPromise = this.#window
      .fetch(WALLPAPER_ENDPOINT, {
        cache: revalidate ? 'no-cache' : 'default',
        headers: { Accept: 'application/json' },
      })
      .then(async (response) => {
        if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
          return undefined;
        }
        const value: unknown = await response.json();
        return isWallpaperManifest(value) ? value : undefined;
      })
      .catch(() => undefined)
      .finally(() => {
        this.#manifestPromise = undefined;
      });
    return this.#manifestPromise;
  }

  #acceptManifest(next: WallpaperManifest): void {
    const previous = this.#manifest;
    this.#manifest = next;
    const current = this.#currentPhoto
      ? next.photos.find((photo) => photo.id === this.#currentPhoto?.id)
      : undefined;
    if (current) {
      this.#currentPhoto = current;
      if (this.#ready) this.#backdrop.updateCredit(current, this.#enabled);
    }

    const nextIds = next.photos.map((photo) => photo.id);
    if (!previous) {
      this.#queueIds = restoreWallpaperQueue(this.#queueIds, nextIds, this.#currentPhoto?.id);
    } else if (previous.updatedAt !== next.updatedAt) {
      this.#queueIds = reconcileWallpaperQueue(
        this.#queueIds,
        previous.photos.map((photo) => photo.id),
        nextIds,
        this.#currentPhoto?.id,
        Math.random,
      );
    }
    if (this.#queueIds.length === 0) {
      this.#queueIds = replenishWallpaperQueue(nextIds, this.#currentPhoto?.id, Math.random);
    }
    this.#persistSession();
    this.#render();
  }

  async #ensurePhoto(): Promise<void> {
    if (!this.#enabled || this.#initializing || this.#target.hidden) return;
    this.#initializing = true;
    this.#render();
    try {
      const restoredPhoto =
        !this.#ready && this.#currentPhoto
          ? this.#activate(this.#currentPhoto)
          : Promise.resolve(this.#ready);
      const [restored, nextManifest] = await Promise.all([restoredPhoto, this.#loadManifest()]);
      if (!this.#enabled || !nextManifest) return;

      this.#acceptManifest(nextManifest);
      const manifest = this.#manifest;
      if (!manifest) return;

      if (!restored && !this.#ready) {
        const initial = this.#currentPhoto ?? this.#takeNextPhoto() ?? manifest.photos.at(0);
        let activated = initial ? await this.#activate(initial) : false;
        const attempted = new Set(initial ? [initial.id] : []);
        while (this.#enabled && !activated && attempted.size < manifest.photos.length) {
          const candidate = this.#takeNextPhoto();
          if (!candidate || attempted.has(candidate.id)) break;
          attempted.add(candidate.id);
          activated = await this.#activate(candidate);
        }
      }
    } finally {
      this.#initializing = false;
      this.#render();
      if (this.#enabled) {
        this.#scheduleRotation();
        this.#scheduleManifestRefresh();
      }
    }
  }

  #takeNextPhoto(
    queueIds = this.#queueIds,
    manifest = this.#manifest,
    currentPhotoId = this.#currentPhoto?.id,
  ): WallpaperPhoto | undefined {
    if (!manifest) return undefined;
    if (queueIds.length === 0) {
      queueIds.push(
        ...replenishWallpaperQueue(
          manifest.photos.map((photo) => photo.id),
          currentPhotoId,
          Math.random,
        ),
      );
    }
    while (queueIds.length > 0) {
      const id = queueIds.shift();
      const photo = manifest.photos.find((candidate) => candidate.id === id);
      if (photo && photo.id !== currentPhotoId) return photo;
    }
    return undefined;
  }

  async #activate(
    photo: WallpaperPhoto,
    canContinue: () => boolean = () => true,
    queueIds: readonly string[] = this.#queueIds,
  ): Promise<boolean> {
    const revision = ++this.#revision;
    const existingBootImage =
      this.#currentPhoto?.id === photo.id ? this.#bootImageDataUrl : undefined;
    const presented = await this.#backdrop.present(
      photo,
      () => revision === this.#revision && this.#enabled && canContinue(),
      async (imageUrl) => {
        const bootImageDataUrl =
          existingBootImage ??
          (await captureWallpaperBootImage(
            this.#window,
            imageUrl,
            wallpaperImageUrl(photo.rawUrl),
          ));
        if (!bootImageDataUrl || revision !== this.#revision || !this.#enabled || !canContinue()) {
          return undefined;
        }
        return this.#persistPreparedSession(photo, imageUrl, bootImageDataUrl, queueIds)
          ? bootImageDataUrl
          : undefined;
      },
    );
    if (!presented || revision !== this.#revision || !this.#enabled || !canContinue()) {
      return false;
    }

    this.#queueIds = [...queueIds];
    this.#currentPhoto = photo;
    this.#currentImageUrl = presented.imageUrl;
    this.#bootImageDataUrl = presented.bootImageDataUrl;
    this.#ready = true;
    this.#persistSession(presented.imageUrl);
    this.#render();
    return true;
  }

  #snapshot(
    imageUrl = this.#currentImageUrl ?? this.#backdrop.activeImageUrl,
  ): WallpaperSessionSnapshot | undefined {
    if (!this.#currentPhoto || !imageUrl) return undefined;
    return {
      version: 2,
      photo: this.#currentPhoto,
      imageUrl,
      bootImageDataUrl: this.#bootImageDataUrl,
      queueIds: [...this.#queueIds],
    };
  }

  #persistPreparedSession(
    photo: WallpaperPhoto,
    imageUrl: string,
    bootImageDataUrl: string,
    queueIds: readonly string[],
  ): boolean {
    try {
      writeWallpaperSession(this.#window.sessionStorage, {
        version: 2,
        photo,
        imageUrl,
        bootImageDataUrl,
        queueIds: [...queueIds],
      });
      return true;
    } catch {
      return false;
    }
  }

  #persistSession(imageUrl?: string): void {
    const snapshot = this.#snapshot(imageUrl);
    if (!snapshot) return;
    try {
      writeWallpaperSession(this.#window.sessionStorage, snapshot);
    } catch {}
  }

  #advance(): Promise<void> {
    if (this.#advanceTransaction) return this.#advanceTransaction.promise;
    const manifest = this.#manifest;
    const currentPhoto = this.#currentPhoto;
    if (
      !this.#enabled ||
      !this.#ready ||
      !manifest ||
      !currentPhoto ||
      !manifest.photos.some((photo) => photo.id !== currentPhoto.id)
    ) {
      return Promise.resolve();
    }

    let active = true;
    let releaseCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const cancel = () => {
      if (!active) return;
      active = false;
      this.#revision += 1;
      releaseCancellation();
    };
    const workingQueueIds = [...this.#queueIds];
    const run = async (): Promise<void> => {
      const attempted = new Set<string>();
      const available = manifest.photos.filter((photo) => photo.id !== currentPhoto.id).length;
      while (active && this.#enabled && attempted.size < available) {
        const photo = this.#takeNextPhoto(workingQueueIds, manifest, currentPhoto.id);
        if (!photo || attempted.has(photo.id)) break;
        attempted.add(photo.id);
        if (await this.#activate(photo, () => active, workingQueueIds)) return;
      }
      if (
        active &&
        this.#enabled &&
        this.#manifest === manifest &&
        this.#currentPhoto?.id === currentPhoto.id
      ) {
        // Commit candidate consumption only when the transaction settles, so
        // persisted queue state never gets ahead of the visible photo mid-flight.
        this.#queueIds = workingQueueIds;
      }
    };
    const timeout = this.#window.setTimeout(cancel, ADVANCE_TRANSACTION_TIMEOUT_MS);
    let transaction!: WallpaperAdvanceTransaction;
    const promise = Promise.race([run().catch(() => undefined), cancellation]).finally(() => {
      active = false;
      this.#window.clearTimeout(timeout);
      if (this.#advanceTransaction !== transaction) return;
      this.#advanceTransaction = undefined;
      this.#persistSession();
      this.#render();
      this.#scheduleRotation();
    });
    transaction = { promise, cancel };
    this.#advanceTransaction = transaction;
    this.#render();
    return promise;
  }

  async #setEnabled(enabled: boolean): Promise<void> {
    if (this.#enabled === enabled) return;
    this.#revision += 1;
    this.#enabled = enabled;
    try {
      this.#window.localStorage.setItem(WALLPAPER_ENABLED_STORAGE_KEY, String(enabled));
    } catch {}
    this.#backdrop.enableTransitions();
    this.#setMode();
    if (!enabled) {
      this.#advanceTransaction?.cancel();
      this.#clearRotationTimer();
      this.#clearManifestTimer();
      this.#render();
      return;
    }
    this.#render();
    if (!this.#ready) await this.#ensurePhoto();
    else {
      this.#scheduleRotation();
      this.#scheduleManifestRefresh();
    }
  }

  #setAutoRotation(enabled: boolean): void {
    if (!this.#enabled || !this.#ready || this.#autoRotation === enabled) return;
    this.#autoRotation = enabled;
    try {
      this.#window.localStorage.setItem(WALLPAPER_AUTO_ROTATION_STORAGE_KEY, String(enabled));
      this.#window.localStorage.removeItem(WALLPAPER_LEGACY_ROTATION_STORAGE_KEY);
    } catch {}
    this.#render();
    this.#scheduleRotation();
  }

  #clearRotationTimer(): void {
    if (this.#rotationTimer !== undefined) this.#window.clearTimeout(this.#rotationTimer);
    this.#rotationTimer = undefined;
  }

  #scheduleRotation = (): void => {
    this.#clearRotationTimer();
    if (
      !this.#enabled ||
      !this.#ready ||
      !this.#autoRotation ||
      this.#reducedMotion.matches ||
      this.#target.hidden ||
      !this.#manifest?.photos.some((photo) => photo.id !== this.#currentPhoto?.id)
    ) {
      return;
    }
    const delay =
      MIN_ROTATION_INTERVAL_MS +
      Math.random() * (MAX_ROTATION_INTERVAL_MS - MIN_ROTATION_INTERVAL_MS);
    this.#rotationTimer = this.#window.setTimeout(() => {
      this.#rotationTimer = undefined;
      void this.#advance();
    }, delay);
  };

  #clearManifestTimer(): void {
    if (this.#manifestTimer !== undefined) this.#window.clearTimeout(this.#manifestTimer);
    this.#manifestTimer = undefined;
  }

  #scheduleManifestRefresh(): void {
    this.#clearManifestTimer();
    if (!this.#enabled || this.#target.hidden) return;
    const delay = this.#manifest ? MANIFEST_REFRESH_INTERVAL_MS : MANIFEST_RETRY_INTERVAL_MS;
    this.#manifestTimer = this.#window.setTimeout(() => {
      this.#manifestTimer = undefined;
      void this.#refreshManifest();
    }, delay);
  }

  async #refreshManifest(): Promise<void> {
    if (!this.#enabled || this.#target.hidden) return;
    const manifest = await this.#loadManifest(true);
    const advance = this.#advanceTransaction;
    if (advance) await advance.promise;
    if (manifest && this.#enabled && !this.#target.hidden) this.#acceptManifest(manifest);
    this.#scheduleManifestRefresh();
    this.#scheduleRotation();
  }

  async #download(): Promise<void> {
    if (!this.#enabled || !this.#ready || this.#downloading || !this.#currentPhoto) return;
    const photo = this.#currentPhoto;
    this.#downloading = true;
    this.#render();
    try {
      await downloadWallpaperPhoto({
        target: this.#target,
        sourceWindow: this.#window,
        photo,
      });
    } catch {
      // A decorative download failure never disables reading or other controls.
    } finally {
      this.#downloading = false;
      this.#render();
    }
  }
}
