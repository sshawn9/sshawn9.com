import type { WallpaperPhoto } from '@sshawn9/site-domain/wallpaper';
import { wallpaperImageUrl } from './document-preferences';

const IMAGE_WIDTHS = [960, 1600, 2400] as const;
const IMAGE_TRANSITION_MS = 1400;
const IMAGE_DECODE_TIMEOUT_MS = 8_000;

type BackdropElements = {
  boot: HTMLElement;
  media: HTMLElement;
  frames: [HTMLElement, HTMLElement];
  loaders: [HTMLImageElement, HTMLImageElement];
  credit: HTMLElement;
  photographer: HTMLAnchorElement;
  photo: HTMLAnchorElement;
};

export type PresentedBackdrop = {
  imageUrl: string;
  bootImageDataUrl?: string;
};

type PrepareBootImage = (imageUrl: string) => Promise<string | undefined>;

function findBackdropElements(target: Document): BackdropElements | undefined {
  const surface = target.querySelector<HTMLElement>('[data-backdrop-surface]');
  const boot = surface?.querySelector<HTMLElement>('[data-wallpaper-boot]');
  const media = surface?.querySelector<HTMLElement>('[data-wallpaper-media]');
  const frames = surface?.querySelectorAll<HTMLElement>('[data-wallpaper-image]');
  const loaders = surface?.querySelectorAll<HTMLImageElement>('[data-wallpaper-loader]');
  const credit = surface?.querySelector<HTMLElement>('[data-wallpaper-credit]');
  const photographer = surface?.querySelector<HTMLAnchorElement>(
    '[data-wallpaper-credit-photographer]',
  );
  const photo = surface?.querySelector<HTMLAnchorElement>('[data-wallpaper-credit-photo]');
  if (
    !boot ||
    !media ||
    !frames ||
    frames.length !== 2 ||
    !loaders ||
    loaders.length !== 2 ||
    !credit ||
    !photographer ||
    !photo
  ) {
    return undefined;
  }
  return {
    boot,
    media,
    frames: [frames[0]!, frames[1]!],
    loaders: [loaders[0]!, loaders[1]!],
    credit,
    photographer,
    photo,
  };
}

function configureImage(image: HTMLImageElement, photo: WallpaperPhoto): void {
  image.crossOrigin = 'anonymous';
  image.srcset = IMAGE_WIDTHS.map(
    (width) => `${wallpaperImageUrl(photo.rawUrl, width)} ${width}w`,
  ).join(', ');
  image.sizes = '100vw';
  image.src = wallpaperImageUrl(photo.rawUrl);
  image.dataset.wallpaperPhotoId = photo.id;
}

async function decodeImage(image: HTMLImageElement, sourceWindow: Window): Promise<boolean> {
  if (image.complete && image.naturalWidth > 0) return true;
  let timeout: number | undefined;
  const decoded = image
    .decode()
    .then(() => true)
    .catch(() => image.complete && image.naturalWidth > 0);
  const expired = new Promise<false>((resolve) => {
    timeout = sourceWindow.setTimeout(() => resolve(false), IMAGE_DECODE_TIMEOUT_MS);
  });
  const result = await Promise.race([decoded, expired]);
  if (timeout !== undefined) sourceWindow.clearTimeout(timeout);
  return result && image.naturalWidth > 0;
}

function clearImage(image: HTMLImageElement): void {
  delete image.dataset.wallpaperInitialCandidate;
  image.removeAttribute('src');
  image.removeAttribute('srcset');
  image.removeAttribute('sizes');
  image.decoding = 'async';
  image.fetchPriority = 'low';
  delete image.dataset.wallpaperPhotoId;
}

function clearFrame(frame: HTMLElement): void {
  frame.classList.remove('is-active');
  frame.style.removeProperty('background-image');
  delete frame.dataset.wallpaperPhotoId;
  delete frame.dataset.wallpaperImageUrl;
}

/** Owns the persistent backdrop DOM and all visual photo transitions. */
export class BackdropPresenter {
  readonly #target: Document;
  readonly #window: Window;
  readonly #elements: BackdropElements;
  readonly #cleanupTimers = new Set<number>();
  readonly #bootPhotoId?: string;
  #activeIndex: number;
  #presentationRevision = 0;

  private constructor(target: Document, sourceWindow: Window, elements: BackdropElements) {
    this.#target = target;
    this.#window = sourceWindow;
    this.#elements = elements;
    this.#activeIndex = elements.frames.findIndex((frame) => frame.classList.contains('is-active'));
    const root = target.documentElement;
    this.#bootPhotoId = root.dataset.wallpaperBootPhotoId;
    elements.media.dataset.wallpaperOwner = this.#activeIndex >= 0 ? 'runtime' : 'boot';
  }

  static connect(target: Document, sourceWindow: Window): BackdropPresenter | undefined {
    const elements = findBackdropElements(target);
    return elements ? new BackdropPresenter(target, sourceWindow, elements) : undefined;
  }

  get ready(): boolean {
    return this.#activeIndex >= 0 || Boolean(this.#bootPhotoId);
  }

  get activePhotoId(): string | undefined {
    return this.#activeFrame()?.dataset.wallpaperPhotoId ?? this.#bootPhotoId;
  }

  get activeImageUrl(): string | undefined {
    return this.#activeFrame()?.dataset.wallpaperImageUrl;
  }

  updateCredit(photo: WallpaperPhoto, visible = true): void {
    const { credit, photographer, photo: photoLink } = this.#elements;
    if (photographer.textContent !== photo.photographerName) {
      photographer.textContent = photo.photographerName;
    }
    if (photographer.getAttribute('href') !== photo.photographerUrl) {
      photographer.href = photo.photographerUrl;
    }
    if (photoLink.getAttribute('href') !== photo.photoUrl) {
      photoLink.href = photo.photoUrl;
    }
    if (credit.dataset.wallpaperPhotoId !== photo.id) {
      credit.dataset.wallpaperPhotoId = photo.id;
    }
    if (credit.hidden === visible) credit.hidden = !visible;
  }

  setCreditVisible(visible: boolean): void {
    this.#elements.credit.hidden = !visible;
  }

  enableTransitions(): void {
    this.#elements.boot.dataset.wallpaperTransitions = 'enabled';
    this.#elements.media.dataset.wallpaperTransitions = 'enabled';
  }

  /**
   * Presents one photo after decode. Re-presenting the active identity is an
   * adoption, not a transition; only a real identity change touches layers.
   */
  async present(
    photo: WallpaperPhoto,
    canCommit: () => boolean,
    prepareBootImage: PrepareBootImage,
  ): Promise<PresentedBackdrop | undefined> {
    const revision = ++this.#presentationRevision;
    if (this.activePhotoId === photo.id) {
      if (!canCommit()) return undefined;
      const imageUrl = this.activeImageUrl;
      if (!imageUrl) return undefined;
      let bootImageDataUrl: string | undefined;
      try {
        bootImageDataUrl = await prepareBootImage(imageUrl);
      } catch {
        return undefined;
      }
      if (!bootImageDataUrl || revision !== this.#presentationRevision || !canCommit()) {
        return undefined;
      }
      if (this.#activeIndex >= 0) this.#reflectReady(photo);
      else this.updateCredit(photo);
      return { imageUrl, bootImageDataUrl };
    }

    let nextIndex = this.#activeIndex === 0 ? 1 : 0;
    const preparedIndex = this.#elements.loaders.findIndex(
      (loader, index) =>
        index !== this.#activeIndex && loader.dataset.wallpaperPhotoId === photo.id,
    );
    if (preparedIndex >= 0) nextIndex = preparedIndex;
    const nextLoader = this.#elements.loaders[nextIndex]!;
    const nextFrame = this.#elements.frames[nextIndex]!;
    if (nextLoader.dataset.wallpaperPhotoId !== photo.id) configureImage(nextLoader, photo);

    const decoded = await decodeImage(nextLoader, this.#window);
    if (revision !== this.#presentationRevision) return undefined;
    if (!decoded || !canCommit()) {
      clearImage(nextLoader);
      return undefined;
    }

    const imageUrl = nextLoader.currentSrc || nextLoader.src;
    if (!imageUrl) return undefined;
    let bootImageDataUrl: string | undefined;
    try {
      bootImageDataUrl = await prepareBootImage(imageUrl);
    } catch {
      clearImage(nextLoader);
      return undefined;
    }
    if (!bootImageDataUrl || revision !== this.#presentationRevision || !canCommit()) {
      clearImage(nextLoader);
      return undefined;
    }

    const previousFrame = this.#activeFrame();
    if (this.#elements.media.dataset.wallpaperFirstFrame !== 'pending') {
      this.enableTransitions();
    }
    nextFrame.style.setProperty('background-image', `url(${JSON.stringify(bootImageDataUrl)})`);
    nextFrame.dataset.wallpaperPhotoId = photo.id;
    nextFrame.dataset.wallpaperImageUrl = imageUrl;
    nextFrame.classList.add('is-active');
    previousFrame?.classList.remove('is-active');
    for (const loader of this.#elements.loaders) {
      delete loader.dataset.wallpaperInitialCandidate;
    }
    delete this.#elements.media.dataset.wallpaperCandidate;
    this.#activeIndex = nextIndex;
    this.#reflectReady(photo);
    clearImage(nextLoader);

    if (previousFrame) {
      const timer = this.#window.setTimeout(() => {
        this.#cleanupTimers.delete(timer);
        if (!previousFrame.classList.contains('is-active')) clearFrame(previousFrame);
      }, IMAGE_TRANSITION_MS);
      this.#cleanupTimers.add(timer);
    }
    return { imageUrl, bootImageDataUrl };
  }

  dispose(): void {
    this.#presentationRevision += 1;
    for (const timer of this.#cleanupTimers) this.#window.clearTimeout(timer);
    this.#cleanupTimers.clear();
  }

  #activeFrame(): HTMLElement | undefined {
    return this.#activeIndex >= 0 ? this.#elements.frames[this.#activeIndex] : undefined;
  }

  #reflectReady(photo: WallpaperPhoto): void {
    this.#elements.media.dataset.wallpaperReady = photo.id;
    this.#elements.media.dataset.wallpaperOwner = 'runtime';
    const root = this.#target.documentElement;
    root.dataset.wallpaperPhotoId = photo.id;
    root.dataset.wallpaperCompositor = 'ready';
    root.dataset.wallpaperInitial = 'ready';
    this.updateCredit(photo);
  }
}
