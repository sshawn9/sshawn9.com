import type { WallpaperManifest, WallpaperPhoto } from '@sshawn9/site-domain/wallpaper';
import { WallpaperManifestSource, decodeDataUrl, fetchWallpaperAsset } from './assets';
import { downloadWallpaper } from './download';
import {
  AUTO_ROTATION_KEY,
  ENABLED_KEY,
  MAX_CANDIDATE_ATTEMPTS,
  MAX_ROTATION_MS,
  MIN_ROTATION_MS,
  THEME_KEY,
  defaultTabState,
  getStorage,
  otherSlot,
  readPreferences,
  reconcileQueue,
  resolveImagePolicy,
  type AppearancePreferences,
  type SlotName,
  type WallpaperAsset,
  type WallpaperTabState,
} from './model';
import { TabWallpaperStore } from './tab-store';
import { WallpaperView } from './view';

type BeforeSwapEvent = Event & { newDocument?: Document };
type PreferenceChanges = Partial<Pick<AppearancePreferences, 'theme' | 'enabled' | 'autoRotation'>>;

/**
 * The sole wallpaper application service. Page features do not call into it:
 * storage, selection, buffering, controls and presentation meet only here.
 */
export class WallpaperSystem {
  private readonly local: Storage | undefined;
  private readonly store: TabWallpaperStore;
  private readonly view: WallpaperView;
  private readonly manifestSource: WallpaperManifestSource;
  private readonly colorScheme: MediaQueryList;
  private readonly reducedMotion: MediaQueryList;
  private policy;

  private preferences: AppearancePreferences;
  private volatilePreferences: PreferenceChanges = {};
  private state: WallpaperTabState = defaultTabState();
  private current?: WallpaperAsset;
  private next?: WallpaperAsset;
  private manifest?: WallpaperManifest;
  private bufferPromise?: Promise<void>;
  private bufferDirty = false;
  private advancePromise?: Promise<void>;
  private pendingAdvance?: AbortController;
  private downloading = false;
  private slotRevision = 0;
  private rotationTimer?: number;
  private presentationPending = false;
  private manifestTimer?: number;
  private started = false;
  private disposed = false;

  constructor(
    private readonly target: Document,
    private readonly sourceWindow: Window,
  ) {
    this.local = getStorage(sourceWindow, 'localStorage');
    this.store = new TabWallpaperStore(getStorage(sourceWindow, 'sessionStorage'));
    this.view = new WallpaperView(target, sourceWindow);
    this.manifestSource = new WallpaperManifestSource(sourceWindow);
    this.colorScheme = sourceWindow.matchMedia('(prefers-color-scheme: dark)');
    this.reducedMotion = sourceWindow.matchMedia('(prefers-reduced-motion: reduce)');
    this.preferences = readPreferences(this.local, this.colorScheme.matches);
    this.policy = resolveImagePolicy(sourceWindow.innerWidth, sourceWindow.devicePixelRatio);
  }

  start(): () => void {
    this.installEvents();
    if (this.target.readyState === 'loading') {
      this.target.addEventListener('DOMContentLoaded', this.handleDocumentReady, { once: true });
    }
    this.reload();
    return () => this.dispose();
  }

  /**
   * The only configuration/reload entry. It synchronously projects persisted
   * state, then starts non-blocking maintenance of the spare image slot.
   */
  reload(changes: PreferenceChanges = {}): void {
    if (this.disposed) return;
    const previousPreferences = this.preferences;
    const previousPolicyKey = this.policy.key;
    this.persistPreferenceChanges(changes);
    const storedPreferences = readPreferences(this.local, this.colorScheme.matches);
    const preferences: AppearancePreferences = {
      ...storedPreferences,
      ...this.volatilePreferences,
      hasExplicitTheme:
        storedPreferences.hasExplicitTheme || this.volatilePreferences.theme !== undefined,
    };
    const policy = resolveImagePolicy(
      this.sourceWindow.innerWidth,
      this.sourceWindow.devicePixelRatio,
    );

    this.preferences = preferences;
    this.policy = policy;
    if (!this.started) {
      this.restoreCurrent();
      this.view.boot(preferences, this.state.currentSlot, this.current);
      this.started = true;
    } else {
      if (previousPreferences.theme !== preferences.theme) {
        this.view.setTheme(preferences.theme, !this.reducedMotion.matches);
      }
      if (previousPreferences.enabled !== preferences.enabled) {
        if (!preferences.enabled) this.cancelPendingAdvance();
        this.view.setMode(preferences.enabled, !this.reducedMotion.matches);
      }
      if (previousPolicyKey !== policy.key) this.slotRevision += 1;
    }

    this.render();
    this.syncRotationTimer();
    this.syncManifestTimer();
    // Current presentation never waits for the spare slot. This also runs
    // while scenic mode is off so the next manual enable/advance stays ready.
    void this.ensureBuffer();
  }

  private restoreCurrent(): void {
    const stored = this.store.readState();
    let currentSlot = stored.currentSlot;
    let current = currentSlot ? this.store.readAsset(currentSlot) : undefined;

    if (!current) {
      if (currentSlot) this.store.clearAsset(currentSlot);
      const fallbackSlot = (['a', 'b'] as const).find((slot) => this.store.readMeta(slot));
      const fallback = fallbackSlot ? this.store.readAsset(fallbackSlot) : undefined;
      currentSlot = fallback ? fallbackSlot! : null;
      current = fallback;
    }

    const queueIds = [...new Set(stored.queueIds)].filter((id) => id !== current?.photo.id);
    this.state = { version: 3, currentSlot, queueIds };
    this.current = current;
    if (
      stored.currentSlot !== this.state.currentSlot ||
      stored.queueIds.length !== queueIds.length ||
      stored.queueIds.some((id, index) => id !== queueIds[index])
    ) {
      this.store.writeState(this.state);
    }
  }

  private installEvents(): void {
    this.target.addEventListener('click', this.handleClick);
    this.target.addEventListener('change', this.handleChange);
    this.target.addEventListener('visibilitychange', this.handleVisibility);
    this.target.addEventListener('astro:before-swap', this.handleBeforeSwap);
    this.target.addEventListener('astro:after-swap', this.handleAfterSwap);
    this.sourceWindow.addEventListener('online', this.handleOnline);
    this.sourceWindow.addEventListener('pageshow', this.handlePageShow);
    this.sourceWindow.addEventListener('pagehide', this.handlePageHide);
    this.colorScheme.addEventListener('change', this.handleSystemTheme);
    this.reducedMotion.addEventListener('change', this.handleReducedMotion);
  }

  private handleDocumentReady = (): void => {
    this.view.connectSurface();
    this.render();
  };

  private handleClick = (event: Event): void => {
    const ElementConstructor = (this.sourceWindow as Window & typeof globalThis).Element;
    const source = event
      .composedPath()
      .find((candidate): candidate is Element => candidate instanceof ElementConstructor);
    if (source?.closest('[data-theme-toggle]')) {
      this.reload({ theme: this.preferences.theme === 'dark' ? 'light' : 'dark' });
    } else if (source?.closest('[data-wallpaper-next]')) {
      void this.advance();
    } else if (source?.closest('[data-wallpaper-download]')) {
      void this.downloadCurrent();
    }
  };

  private handleChange = (event: Event): void => {
    const input = event.target;
    const InputConstructor = (this.sourceWindow as Window & typeof globalThis).HTMLInputElement;
    if (!(input instanceof InputConstructor)) return;
    if (input.matches('[data-wallpaper-enabled]')) {
      this.reload({ enabled: input.checked });
    } else if (input.matches('[data-wallpaper-auto-rotation]')) {
      this.reload({ autoRotation: input.checked });
    }
  };

  private handleVisibility = (): void => {
    if (this.target.hidden) {
      this.clearRotationTimer();
      this.clearManifestTimer();
      return;
    }
    this.reload();
  };

  private handleOnline = (): void => {
    this.reload();
  };

  private handlePageShow = (): void => {
    this.reload();
  };

  private handlePageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) this.dispose();
  };

  private handleBeforeSwap = (event: Event): void => {
    const nextDocument = (event as BeforeSwapEvent).newDocument;
    if (!nextDocument) return;
    this.view.projectTargetDocument(
      nextDocument,
      this.preferences,
      this.state.currentSlot,
      this.current,
      this.controlState(),
    );
  };

  private handleAfterSwap = (): void => {
    this.view.connectSurface();
    this.render();
  };

  private handleSystemTheme = (): void => {
    if (!this.preferences.hasExplicitTheme) this.reload();
  };

  private handleReducedMotion = (): void => {
    this.reload();
  };

  private persistPreferenceChanges(changes: PreferenceChanges): void {
    this.persistPreferenceChange('theme', THEME_KEY, changes.theme);
    this.persistPreferenceChange('enabled', ENABLED_KEY, changes.enabled);
    this.persistPreferenceChange('autoRotation', AUTO_ROTATION_KEY, changes.autoRotation);
  }

  private persistPreferenceChange<Key extends keyof PreferenceChanges>(
    field: Key,
    storageKey: string,
    value: PreferenceChanges[Key],
  ): void {
    if (value === undefined) return;
    if (!this.local) {
      this.volatilePreferences[field] = value;
      return;
    }
    try {
      this.local.setItem(storageKey, String(value));
      delete this.volatilePreferences[field];
    } catch {
      this.volatilePreferences[field] = value;
    }
  }

  private render(): void {
    this.view.renderControls(this.controlState());
  }

  private controlState() {
    const canAdvance = Boolean(
      this.current &&
      (this.next ||
        !this.manifest ||
        this.manifest.photos.some((photo) => photo.id !== this.current?.photo.id)),
    );
    return {
      preferences: this.preferences,
      hasCurrent: Boolean(this.current),
      canAdvance,
      advancing: Boolean(this.advancePromise),
      downloading: this.downloading,
    };
  }

  private async loadManifest(revalidate = false): Promise<WallpaperManifest | undefined> {
    const manifest = await this.manifestSource.load(revalidate);
    if (manifest && !this.disposed) this.acceptManifest(manifest);
    this.syncManifestTimer();
    return manifest;
  }

  private acceptManifest(manifest: WallpaperManifest): void {
    this.manifest = manifest;
    const nextId = this.next?.photo.id ?? this.readNextMeta()?.photo.id;
    this.state = {
      ...this.state,
      queueIds: reconcileQueue(this.state.queueIds, manifest.photos, [
        this.current?.photo.id,
        nextId,
      ]),
    };
    this.store.writeState(this.state);
  }

  private readNextMeta() {
    return this.state.currentSlot
      ? this.store.readMeta(otherSlot(this.state.currentSlot))
      : undefined;
  }

  private readNextAsset(): WallpaperAsset | undefined {
    if (!this.state.currentSlot) return undefined;
    const next = this.store.readAsset(otherSlot(this.state.currentSlot));
    return next?.photo.id === this.current?.photo.id ? undefined : next;
  }

  private takeCandidate(excludedIds: readonly (string | undefined)[]): WallpaperPhoto | undefined {
    const manifest = this.manifest;
    if (!manifest) return undefined;
    const excluded = new Set(excludedIds.filter((id): id is string => Boolean(id)));
    let queueIds = this.state.queueIds;
    if (queueIds.length === 0) {
      queueIds = reconcileQueue([], manifest.photos, [...excluded]);
    }

    while (queueIds.length > 0) {
      const [id, ...remaining] = queueIds;
      queueIds = remaining;
      const photo = manifest.photos.find((candidate) => candidate.id === id);
      this.state = { ...this.state, queueIds };
      this.store.writeState(this.state);
      if (photo && !excluded.has(photo.id)) return photo;
    }
    return undefined;
  }

  private async prepareFromQueue(
    excludedIds: readonly (string | undefined)[],
    revision: number,
  ): Promise<WallpaperAsset | undefined> {
    const attempted = new Set<string>();
    while (
      attempted.size < MAX_CANDIDATE_ATTEMPTS &&
      revision === this.slotRevision &&
      !this.disposed
    ) {
      const photo = this.takeCandidate([...excludedIds, ...attempted]);
      if (!photo) return undefined;
      attempted.add(photo.id);
      const asset = await fetchWallpaperAsset(this.sourceWindow, photo, this.policy);
      if (asset) return asset;
    }
    return undefined;
  }

  private ensureBuffer(): Promise<void> {
    if (this.disposed || !this.store.available) return Promise.resolve();
    this.bufferDirty = true;
    if (this.bufferPromise) return this.bufferPromise;

    this.bufferPromise = this.drainBuffer().finally(() => {
      this.bufferPromise = undefined;
      this.render();
    });
    return this.bufferPromise;
  }

  private async drainBuffer(): Promise<void> {
    while (this.bufferDirty && !this.disposed) {
      this.bufferDirty = false;
      await this.reconcileBuffer().catch(() => undefined);
    }
  }

  private async reconcileBuffer(): Promise<void> {
    let revision = this.slotRevision;

    // Hydrate the already prepared next slot before any network work. This
    // keeps manual/automatic advance available offline and during revalidation.
    if (this.current && this.state.currentSlot) {
      this.next = this.readNextAsset();
      this.render();
    }

    const manifest = await this.loadManifest();
    if (!manifest || this.disposed || revision !== this.slotRevision) return;

    if (!this.current) {
      const first = await this.prepareFromQueue([], revision);
      if (!first || this.disposed || revision !== this.slotRevision || !this.commitFirst(first)) {
        return;
      }
      revision = this.slotRevision;
    }

    const currentSlot = this.state.currentSlot;
    const currentId = this.current?.photo.id;
    if (!currentSlot || !currentId) return;
    const nextSlot = otherSlot(currentSlot);
    const storedNext = this.readNextAsset();
    this.next = storedNext;
    this.render();
    if (storedNext?.policyKey === this.policy.key) return;

    const manifestVersion = storedNext
      ? manifest.photos.find((photo) => photo.id === storedNext.photo.id)
      : undefined;
    let prepared = manifestVersion
      ? await fetchWallpaperAsset(this.sourceWindow, manifestVersion, this.policy)
      : undefined;
    if (!prepared && revision === this.slotRevision) {
      prepared = await this.prepareFromQueue([currentId, storedNext?.photo.id], revision);
    }
    if (!prepared || this.disposed || revision !== this.slotRevision) return;
    if (this.state.currentSlot !== currentSlot || this.current?.photo.id !== currentId) return;

    const slotStillContains = this.store.readMeta(nextSlot)?.photo.id;
    if (slotStillContains !== storedNext?.photo.id) return;
    if (this.store.writeAsset(nextSlot, prepared)) this.next = prepared;
  }

  private commitFirst(asset: WallpaperAsset): boolean {
    const slot: SlotName = this.state.currentSlot ?? 'a';
    if (!this.store.writeAsset(slot, asset)) return false;
    const nextState: WallpaperTabState = { ...this.state, currentSlot: slot };
    if (!this.store.writeState(nextState)) {
      this.store.clearAsset(slot);
      return false;
    }

    this.state = nextState;
    this.current = asset;
    this.slotRevision += 1;
    this.view.showFirstCurrent(
      slot,
      asset,
      this.preferences.enabled && !this.reducedMotion.matches,
    );
    this.render();
    this.syncRotationTimer();
    return true;
  }

  /**
   * The only photo-change entry. Its promise covers candidate readiness and
   * the commit that starts presentation; retiring visual layers do not lock it.
   */
  advance(): Promise<void> {
    if (this.advancePromise) return this.advancePromise;
    if (!this.preferences.enabled || !this.current || !this.state.currentSlot) {
      return Promise.resolve();
    }

    const AbortControllerConstructor = (this.sourceWindow as Window & typeof globalThis)
      .AbortController;
    const controller = new AbortControllerConstructor();
    this.pendingAdvance = controller;
    const task = this.runAdvance(controller.signal)
      .catch(() => undefined)
      .finally(() => {
        if (this.advancePromise !== task) return;
        this.advancePromise = undefined;
        this.pendingAdvance = undefined;
        this.render();
        this.syncRotationTimer();
        void this.ensureBuffer();
      });
    this.advancePromise = task;
    this.render();
    return this.advancePromise;
  }

  private cancelPendingAdvance(): void {
    if (!this.pendingAdvance) return;
    this.pendingAdvance.abort();
    this.pendingAdvance = undefined;
    this.advancePromise = undefined;
  }

  private async runAdvance(signal: AbortSignal): Promise<void> {
    let next = this.next ?? this.readNextAsset();
    if (!next) {
      await this.ensureBuffer();
      if (this.disposed || signal.aborted || !this.preferences.enabled) return;
      next = this.next ?? this.readNextAsset();
    }
    if (!next || !this.current || !this.state.currentSlot) return;

    const revision = ++this.slotRevision;
    await this.commitAdvance(next, revision, signal);
  }

  private async commitAdvance(
    candidate: WallpaperAsset,
    revision: number,
    signal: AbortSignal,
  ): Promise<void> {
    const previousSlot = this.state.currentSlot;
    if (!previousSlot) return;
    const nextSlot = otherSlot(previousSlot);
    const stored = this.store.readAsset(nextSlot);
    if (!stored || stored.photo.id !== candidate.photo.id) return;
    if (!(await decodeDataUrl(this.sourceWindow, stored.dataUrl, signal))) return;
    if (
      this.disposed ||
      signal.aborted ||
      !this.preferences.enabled ||
      revision !== this.slotRevision ||
      this.state.currentSlot !== previousSlot
    ) {
      return;
    }
    if (this.store.readMeta(nextSlot)?.photo.id !== stored.photo.id) return;

    const nextState: WallpaperTabState = { ...this.state, currentSlot: nextSlot };
    if (!this.store.writeState(nextState)) return;
    // From this point the photo is current, not a cancellable candidate. Keep
    // advancePromise locked until presentation starts and the old slot retires.
    this.pendingAdvance = undefined;
    this.clearRotationTimer();
    this.state = nextState;
    this.current = stored;
    this.next = undefined;
    const presentation = this.view.presentAdvance(
      previousSlot,
      nextSlot,
      stored,
      !this.reducedMotion.matches,
    );
    this.presentationPending = true;
    void presentation.finished.then(() => {
      // An earlier layer may finish retiring after a newer photo was committed.
      if (this.current !== stored) return;
      this.presentationPending = false;
      this.resetRotationTimer();
    });
    await presentation.started;
    this.store.clearAsset(previousSlot);
  }

  private clearRotationTimer(): void {
    if (this.rotationTimer !== undefined) this.sourceWindow.clearTimeout(this.rotationTimer);
    this.rotationTimer = undefined;
  }

  private syncRotationTimer(): void {
    if (!this.canRunRotation()) {
      this.clearRotationTimer();
      return;
    }
    if (this.rotationTimer === undefined && !this.advancePromise && !this.presentationPending) {
      this.resetRotationTimer();
    }
  }

  private resetRotationTimer(): void {
    this.clearRotationTimer();
    if (!this.canRunRotation()) return;
    const delay = MIN_ROTATION_MS + Math.random() * (MAX_ROTATION_MS - MIN_ROTATION_MS);
    this.rotationTimer = this.sourceWindow.setTimeout(() => {
      this.rotationTimer = undefined;
      void this.advance();
    }, delay);
  }

  private canRunRotation(): boolean {
    return Boolean(
      !this.disposed &&
      this.preferences.enabled &&
      this.preferences.autoRotation &&
      this.current &&
      !this.reducedMotion.matches &&
      !this.target.hidden,
    );
  }

  private clearManifestTimer(): void {
    if (this.manifestTimer !== undefined) this.sourceWindow.clearTimeout(this.manifestTimer);
    this.manifestTimer = undefined;
  }

  private syncManifestTimer(): void {
    this.clearManifestTimer();
    const refreshAt = this.manifestSource.nextRefreshAt;
    if (this.disposed || this.target.hidden || refreshAt === undefined) return;
    const delay = Math.max(0, refreshAt - Date.now());
    this.manifestTimer = this.sourceWindow.setTimeout(() => {
      this.manifestTimer = undefined;
      void this.refreshManifest();
    }, delay);
  }

  private async refreshManifest(): Promise<void> {
    await this.loadManifest(true);
    if (!this.disposed && !this.target.hidden) void this.ensureBuffer();
  }

  private async downloadCurrent(): Promise<void> {
    if (!this.preferences.enabled || !this.current || this.downloading) return;
    const photo = this.current.photo;
    this.downloading = true;
    this.render();
    try {
      await downloadWallpaper(this.target, this.sourceWindow, photo);
    } catch {
      // A decorative download failure never changes the displayed wallpaper.
    } finally {
      this.downloading = false;
      this.render();
    }
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPendingAdvance();
    this.slotRevision += 1;
    this.clearRotationTimer();
    this.clearManifestTimer();
    this.view.dispose();
    this.target.removeEventListener('DOMContentLoaded', this.handleDocumentReady);
    this.target.removeEventListener('click', this.handleClick);
    this.target.removeEventListener('change', this.handleChange);
    this.target.removeEventListener('visibilitychange', this.handleVisibility);
    this.target.removeEventListener('astro:before-swap', this.handleBeforeSwap);
    this.target.removeEventListener('astro:after-swap', this.handleAfterSwap);
    this.sourceWindow.removeEventListener('online', this.handleOnline);
    this.sourceWindow.removeEventListener('pageshow', this.handlePageShow);
    this.sourceWindow.removeEventListener('pagehide', this.handlePageHide);
    this.colorScheme.removeEventListener('change', this.handleSystemTheme);
    this.reducedMotion.removeEventListener('change', this.handleReducedMotion);
  }
}

export function startWallpaperSystem(
  target: Document = document,
  sourceWindow: Window = window,
): (() => void) | undefined {
  if (target.documentElement.dataset.wallpaperSystemStarted === 'true') return undefined;
  const system = new WallpaperSystem(target, sourceWindow);
  return system.start();
}
