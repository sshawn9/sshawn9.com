import {
  TAB_STATE_KEY,
  defaultTabState,
  isSlotMeta,
  isTabState,
  isWallpaperDataUrl,
  parseJson,
  slotDataKey,
  slotMetaKey,
  type SlotName,
  type WallpaperAsset,
  type WallpaperAssetMeta,
  type WallpaperTabState,
} from './model';

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

  readAsset(slot: SlotName): WallpaperAsset | undefined {
    const meta = this.readMeta(slot);
    if (!meta || !this.session) return undefined;
    try {
      const dataUrl = this.session.getItem(slotDataKey(slot));
      return isWallpaperDataUrl(dataUrl) ? { ...meta, dataUrl } : undefined;
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

  private restoreValue(key: string, value: string | null): void {
    if (!this.session) return;
    try {
      if (value === null) this.session.removeItem(key);
      else this.session.setItem(key, value);
    } catch {}
  }
}
