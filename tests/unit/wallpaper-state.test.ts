import { describe, expect, it } from 'vitest';
import {
  reconcileQueue,
  resolveImagePolicy,
  type WallpaperAsset,
} from '../../apps/site/src/features/appearance/wallpaper/model';
import { TabWallpaperStore } from '../../apps/site/src/features/appearance/wallpaper/tab-store';

const photos = ['one', 'two', 'three', 'four'].map((id) => ({
  id,
  createdAt: '2026-08-29T00:00:00.000Z',
  blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  rawUrl: `https://images.unsplash.com/${id}`,
  photographerName: `Photographer ${id}`,
  photographerUrl: `https://unsplash.com/@${id}`,
  photoUrl: `https://unsplash.com/photos/${id}`,
}));

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  keys(): string[] {
    return [...this.values.keys()].sort();
  }
}

function asset(index: number): WallpaperAsset {
  const photo = photos[index]!;
  return {
    version: 1,
    photo,
    policyKey: 'v1-w1600-q80-auto',
    imageUrl: `${photo.rawUrl}?auto=format&fit=max&q=80&w=1600`,
    byteSize: 3,
    dataUrl: 'data:image/png;base64,YWJj',
  };
}

describe('wallpaper state', () => {
  it('chooses one bounded image policy for a full-document viewport', () => {
    expect(resolveImagePolicy(720, 1).width).toBe(960);
    expect(resolveImagePolicy(1000, 1.5).width).toBe(1600);
    expect(resolveImagePolicy(1600, 2).width).toBe(2400);
  });

  it('preserves queue order while excluding the current and prepared next photos', () => {
    expect(reconcileQueue(['three', 'one', 'three'], photos, ['one', 'two'], () => 0)).toEqual([
      'three',
      'four',
    ]);
  });

  it('persists only fixed A/B assets plus one current pointer', () => {
    const storage = new MemoryStorage();
    const store = new TabWallpaperStore(storage);

    expect(store.writeAsset('a', asset(0))).toBe(true);
    expect(store.writeAsset('b', asset(1))).toBe(true);
    expect(store.writeState({ version: 3, currentSlot: 'a', queueIds: ['three'] })).toBe(true);
    expect(store.writeAsset('b', asset(2))).toBe(true);

    expect(store.readAsset('a')?.photo.id).toBe('one');
    expect(store.readAsset('b')?.photo.id).toBe('three');
    expect(store.readState()).toEqual({ version: 3, currentSlot: 'a', queueIds: ['three'] });
    expect(storage.keys()).toEqual([
      'wallpaper-slot-a-data-v3',
      'wallpaper-slot-a-meta-v3',
      'wallpaper-slot-b-data-v3',
      'wallpaper-slot-b-meta-v3',
      'wallpaper-tab-state-v3',
    ]);
  });
});
