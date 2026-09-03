import { isWallpaperPhoto, type WallpaperPhoto } from '@sshawn9/site-domain/wallpaper';
import {
  LEGACY_BACKGROUND_KEY,
  LEGACY_PHOTO_KEY,
  LEGACY_QUEUE_KEY,
  LEGACY_SESSION_KEYS,
  TAB_STATE_KEY,
  createImageUrl,
  defaultTabState,
  isRecord,
  isSlotMeta,
  isTabState,
  isWallpaperDataUrl,
  isWallpaperImageUrl,
  parseJson,
  slotDataKey,
  slotMetaKey,
  type SlotName,
  type WallpaperAsset,
  type WallpaperAssetMeta,
  type WallpaperTabState,
} from './model';

type LegacyAsset = {
  photo: WallpaperPhoto;
  imageUrl: string;
  dataUrl: string;
  queueIds: string[];
};

/** Owns the bounded, per-tab two-slot persistence format. */
export class TabWallpaperStore {
  constructor(private readonly session: Storage | undefined) {}

  get available(): boolean {
    return Boolean(this.session);
  }

  readState(): WallpaperTabState {
    if (!this.session) return defaultTabState();
    try {
      const value = parseJson(this.session.getItem(TAB_STATE_KEY));
      return isTabState(value) ? value : defaultTabState();
    } catch {
      return defaultTabState();
    }
  }

  writeState(state: WallpaperTabState): boolean {
    if (!this.session) return false;
    try {
      this.session.setItem(TAB_STATE_KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  readMeta(slot: SlotName): WallpaperAssetMeta | undefined {
    if (!this.session) return undefined;
    try {
      const value = parseJson(this.session.getItem(slotMetaKey(slot)));
      return isSlotMeta(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  readAsset(slot: SlotName, allowLegacySize = false): WallpaperAsset | undefined {
    const meta = this.readMeta(slot);
    if (!meta || !this.session) return undefined;
    try {
      const dataUrl = this.session.getItem(slotDataKey(slot));
      return isWallpaperDataUrl(dataUrl, allowLegacySize) ? { ...meta, dataUrl } : undefined;
    } catch {
      return undefined;
    }
  }

  /** Replaces one slot without exposing partially written metadata. */
  writeAsset(slot: SlotName, asset: WallpaperAsset): boolean {
    if (!this.session) return false;
    const dataKey = slotDataKey(slot);
    const metaKey = slotMetaKey(slot);
    let previousData: string | null = null;
    let previousMeta: string | null = null;
    try {
      previousData = this.session.getItem(dataKey);
      previousMeta = this.session.getItem(metaKey);
      this.session.setItem(dataKey, asset.dataUrl);
      this.session.setItem(
        metaKey,
        JSON.stringify({
          version: 1,
          photo: asset.photo,
          policyKey: asset.policyKey,
          imageUrl: asset.imageUrl,
          byteSize: asset.byteSize,
        } satisfies WallpaperAssetMeta),
      );
      return true;
    } catch {
      this.restoreValue(dataKey, previousData);
      this.restoreValue(metaKey, previousMeta);
      return false;
    }
  }

  clearAsset(slot: SlotName): void {
    if (!this.session) return;
    try {
      this.session.removeItem(slotMetaKey(slot));
      this.session.removeItem(slotDataKey(slot));
    } catch {}
  }

  /** Migrates the currently displayed v1/v2 image without downloading it again. */
  migrateLegacyState(): void {
    if (!this.session || this.readState().currentSlot) return;
    const legacy = this.readLegacyAsset();
    if (!legacy) return;

    const legacyKeys = [
      ...LEGACY_SESSION_KEYS,
      LEGACY_PHOTO_KEY,
      LEGACY_BACKGROUND_KEY,
      LEGACY_QUEUE_KEY,
    ];
    const backups = new Map<string, string | null>();
    try {
      for (const key of legacyKeys) {
        backups.set(key, this.session.getItem(key));
        this.session.removeItem(key);
      }
      const stored = this.writeAsset('a', {
        version: 1,
        photo: legacy.photo,
        imageUrl: legacy.imageUrl,
        policyKey: 'legacy',
        byteSize: Math.floor((legacy.dataUrl.length * 3) / 4),
        dataUrl: legacy.dataUrl,
      });
      const state: WallpaperTabState = {
        version: 3,
        currentSlot: 'a',
        queueIds: [...new Set(legacy.queueIds.filter((id) => id !== legacy.photo.id))],
      };
      if (stored && this.writeState(state)) return;

      this.clearAsset('a');
      this.session.removeItem(TAB_STATE_KEY);
      for (const [key, value] of backups) this.restoreValue(key, value);
    } catch {
      for (const [key, value] of backups) this.restoreValue(key, value);
    }
  }

  private readLegacyAsset(): LegacyAsset | undefined {
    if (!this.session) return undefined;
    try {
      for (const key of LEGACY_SESSION_KEYS) {
        const value = parseJson(this.session.getItem(key));
        if (
          isRecord(value) &&
          isWallpaperPhoto(value.photo) &&
          isWallpaperImageUrl(value.imageUrl) &&
          isWallpaperDataUrl(value.bootImageDataUrl, true)
        ) {
          return {
            photo: value.photo,
            imageUrl: value.imageUrl,
            dataUrl: value.bootImageDataUrl,
            queueIds: Array.isArray(value.queueIds)
              ? value.queueIds.filter((id): id is string => typeof id === 'string')
              : [],
          };
        }
      }

      const photo = parseJson(this.session.getItem(LEGACY_PHOTO_KEY));
      const background = parseJson(this.session.getItem(LEGACY_BACKGROUND_KEY));
      if (
        !isWallpaperPhoto(photo) ||
        !isRecord(background) ||
        background.photoId !== photo.id ||
        background.kind !== 'poster' ||
        !isWallpaperDataUrl(background.url, true)
      ) {
        return undefined;
      }
      const queue = parseJson(this.session.getItem(LEGACY_QUEUE_KEY));
      return {
        photo,
        imageUrl: createImageUrl(photo.rawUrl, { width: 1600, quality: 80 }),
        dataUrl: background.url,
        queueIds: Array.isArray(queue)
          ? queue.filter((id): id is string => typeof id === 'string')
          : [],
      };
    } catch {
      return undefined;
    }
  }

  private restoreValue(key: string, value: string | null): void {
    if (!this.session) return;
    try {
      if (value === null) this.session.removeItem(key);
      else this.session.setItem(key, value);
    } catch {}
  }
}
