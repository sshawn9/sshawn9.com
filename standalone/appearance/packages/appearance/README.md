# @sshawn9/appearance

An experimental, framework-independent package with two separately imported modules. The existing sshawn9.com site does not consume it.

## Public exports

- `@sshawn9/appearance/theme`: `createThemeController`, theme option/state types
- `@sshawn9/appearance/wallpaper`: `createWallpaperController`, `createDomWallpaperView`, `createIndexedDbWallpaperCache`, `prepareBrowserImage`, `downloadBrowserWallpaper`, wallpaper interfaces
- `@sshawn9/appearance/theme/styles.css`, `@sshawn9/appearance/wallpaper/styles.css`, or combined `@sshawn9/appearance/styles.css`

Imports perform no initialization, storage maintenance, image requests, or listener registration. Theme does not import wallpaper. Call controller `init()` explicitly, and call `destroy()` when the host no longer needs it. A destroyed controller can be initialized again. Subscription disposers remain the caller's responsibility.

## Theme

Provide a root element, an optional storage implementation and a storage key unique to your application. The controller adds `data-appearance-theme` to the chosen root, and temporarily adds `appearance-theme-changing` for transitions. It restores the previous root attribute on destruction. The CSS defines only `--appearance-*` tokens and scoped transition rules. Using the document element intentionally changes page-wide color-scheme and inherited colors; using a subtree scopes them to that subtree.

`init()` reads saved `light`, `dark`, or `system`; an absent/invalid/unavailable stored value falls back to system. `setPreference()` persists explicit choices. `subscribe()` observes applied states. Reduced motion disables transitions. `destroy()` removes owned media-query listeners and timers.

## Wallpaper host contract

The host supplies a source callback, a font readiness callback, and a view. Optional adapters cover caching, image preparation and downloading. No production API, router, credential, main-site global or font marker is assumed.

- `source({ currentId, signal })` returns an item `{ id, url, credit, creditUrl?, filename? }` or `null`.
- `fontsReady(item, signal)` must resolve only after the actual font resource needed for that item's attribution is successfully loaded. Reject on failure; never resolve a timeout or fallback font as success. For browser fonts, use a concrete `FontFace.load()` and confirm that exact face is loaded and registered. `document.fonts.ready`/`check()` alone are insufficient.
- The default image adapter fetches an image, creates a temporary object URL, and awaits successful decoding before returning. It never persists object URLs.
- The DOM view requires a dedicated container. It commits a decoded image and its attribution in one synchronous DOM operation. Optional transitions fade the entire pair together and retain the previous resource until completion. `clear()` releases all owned image resources. Attribution text uses textContent; links are restricted to HTTP(S).
- An optional cache implements `read`, `write` and `clear`, each receiving an AbortSignal. Writes must honor cancellation. The included IndexedDB adapter aborts its transaction on cancellation and requires a dedicated database name. Snapshots contain image Blobs and metadata, not transient URLs.

`init()` loads or restores the first pair and prefetches the next image. A complete two-slot cache restores without source reselection, image network requests or a change animation. Cached bytes are still decoded and attribution fonts still validated. Missing/invalid metadata is cleared; corrupt current-image bytes permit one fresh source attempt. Font failure never bypasses the display gate.

`next()` coalesces overlapping calls. `cancel()` aborts preparation/prefetch and disables automatic rotation while retaining the displayed pair. `setEnabled(false)` hides both image and attribution and cancels work. `setAutoRotate(true)` schedules one rotation at a time; errors do not create immediate retry loops. `download()` uses only the last successfully committed image. Each asynchronous operation is time-bounded; a timeout is an error that keeps the old pair, never permission to show an unready image/font.

Listen to `getState()`/`subscribe()` for errors and busy state. Initialization resolves after its attempt, even when cancelled or failed; inspect state for failure. `next()` resolves false for no change, failure or cancellation. Invalid lifecycle calls, such as selecting a theme before init or downloading before a first wallpaper exists, throw.

## Boundaries

Modern ESM browsers with image decoding, AbortController and optional IndexedDB are the target. Storage may be unavailable or evicted; the controller can still display an image but reports persistence failures. Persisted source metadata is application-owned. Automatic rotation pauses when disabled/destroyed; it does not integrate a host router or impose a visibility policy. A document reload necessarily has a separate initialization lifecycle; this package does not promise a browser-level zero-blank-frame navigation.

This draft package is UNLICENSED pending the maintainer's distribution-license decision. It is not published by this experiment.
