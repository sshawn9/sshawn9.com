import { describe, expect, it } from 'vitest';
import {
  createDocumentPreferenceScript,
  isWallpaperSessionSnapshot,
  readAppearancePreferences,
  readWallpaperSession,
  resolveThemePreference,
  wallpaperImageUrl,
  writeWallpaperSession,
  type WallpaperSessionSnapshot,
} from '../../apps/site-v2/src/features/appearance/runtime/document-preferences';

class MemoryStorage {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const photo = {
  id: 'photo-1',
  createdAt: '2026-08-29T00:00:00.000Z',
  blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  rawUrl: 'https://images.unsplash.com/photo-1?ixid=one',
  photographerName: 'Photographer',
  photographerUrl: 'https://unsplash.com/@photographer?utm_source=sshawn9.com',
  photoUrl: 'https://unsplash.com/photos/photo-1?utm_source=sshawn9.com',
};
const bootImageDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWMISq8iCTGMakgfDKEEALF9rLGZ8m0AAAAAAElFTkSuQmCC';

describe('v2 document preferences', () => {
  it('uses a valid stored theme before the system preference', () => {
    expect(resolveThemePreference('light', true)).toBe('light');
    expect(resolveThemePreference('dark', false)).toBe('dark');
  });

  it('falls back to the system preference for missing or corrupt storage', () => {
    expect(resolveThemePreference(null, true)).toBe('dark');
    expect(resolveThemePreference('unexpected', false)).toBe('light');
  });

  it('keeps the selected image and its synchronous boot copy in one session snapshot', () => {
    const storage = new MemoryStorage();
    const snapshot: WallpaperSessionSnapshot = {
      version: 2,
      photo,
      imageUrl: wallpaperImageUrl(photo.rawUrl),
      bootImageDataUrl,
      queueIds: ['photo-2', 'photo-3'],
    };

    writeWallpaperSession(storage, snapshot);

    expect(readWallpaperSession(storage)).toEqual(snapshot);
    expect(storage.getItem('wallpaper-session-v2')).toContain(bootImageDataUrl);
    expect(
      isWallpaperSessionSnapshot({ ...snapshot, imageUrl: 'data:image/webp;base64,abc' }),
    ).toBe(false);
  });

  it('migrates a valid legacy poster into the boot image slot', () => {
    const storage = new MemoryStorage();
    storage.setItem('wallpaper-current-photo', JSON.stringify(photo));
    storage.setItem(
      'wallpaper-current-background',
      JSON.stringify({ photoId: photo.id, kind: 'poster', url: bootImageDataUrl }),
    );
    storage.setItem('wallpaper-photo-queue', JSON.stringify(['photo-2', 'photo-2', photo.id]));

    expect(readWallpaperSession(storage)).toEqual({
      version: 2,
      photo,
      imageUrl: wallpaperImageUrl(photo.rawUrl),
      bootImageDataUrl,
      queueIds: ['photo-2'],
    });
  });

  it('keeps theme, wallpaper mode and auto rotation as independent preferences', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem('theme', 'dark');
    local.setItem('wallpaper-enabled', 'false');
    local.setItem('wallpaper-auto-rotation', 'true');

    expect(readAppearancePreferences(local, session, false)).toEqual({
      theme: 'dark',
      wallpaperEnabled: false,
      wallpaperAutoRotation: true,
      wallpaperSession: undefined,
    });
  });

  it('emits browser-only prepaint source after Vite transforms the server module', () => {
    const source = createDocumentPreferenceScript();

    expect(source).not.toMatch(/__vite_ssr_(?:import|export)/);
    expect(() => new Function(source)).not.toThrow();
  });

  it('executes the generated prepaint source through a valid saved-wallpaper branch', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    const classes = new Set<string>();
    const styles = new Map<string, string>();
    const appended: Array<Record<string, unknown>> = [];
    const themeColor = new Map<string, string>();
    const root = {
      dataset: {} as Record<string, string>,
      classList: {
        toggle(name: string, active: boolean) {
          if (active) classes.add(name);
          else classes.delete(name);
        },
      },
      style: {
        colorScheme: '',
        setProperty(name: string, value: string) {
          styles.set(name, value);
        },
      },
    };
    const targetDocument = {
      documentElement: root,
      head: {
        append(node: Record<string, unknown>) {
          appended.push(node);
        },
      },
      querySelector(selector: string) {
        if (selector !== 'meta[name="theme-color"]') return null;
        return {
          setAttribute(name: string, value: string) {
            themeColor.set(name, value);
          },
        };
      },
      createElement() {
        return {
          dataset: {} as Record<string, string>,
          textContent: '',
          type: '',
          rel: '',
          as: '',
          crossOrigin: '',
          href: '',
        };
      },
    };
    const snapshot: WallpaperSessionSnapshot = {
      version: 2,
      photo,
      imageUrl: wallpaperImageUrl(photo.rawUrl),
      bootImageDataUrl,
      queueIds: ['photo-2'],
    };
    local.setItem('theme', 'dark');
    local.setItem('wallpaper-enabled', 'true');
    local.setItem('wallpaper-auto-rotation', 'false');
    writeWallpaperSession(session, snapshot);

    const execute = new Function(
      'document',
      'localStorage',
      'sessionStorage',
      'matchMedia',
      createDocumentPreferenceScript(),
    );
    execute(targetDocument, local, session, () => ({ matches: false }));

    expect(root.dataset).toMatchObject({
      theme: 'dark',
      wallpaperMode: 'scenic',
      wallpaperPhotoId: photo.id,
      wallpaperBootPhotoId: photo.id,
      wallpaperInitial: 'ready',
      appearanceScript: 'enabled',
    });
    expect(classes).toContain('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(styles.get('--wallpaper-boot-image')).toBe(
      'url(' + JSON.stringify(bootImageDataUrl) + ')',
    );
    expect(themeColor.get('content')).toBe('#070a12');
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      type: 'application/json',
      dataset: { wallpaperBootSeed: '' },
    });
    expect(JSON.parse(String(appended[0]?.textContent))).toEqual({
      version: 1,
      photo: {
        id: photo.id,
        photographerName: photo.photographerName,
        photographerUrl: photo.photographerUrl,
        photoUrl: photo.photoUrl,
      },
    });
  });
});
