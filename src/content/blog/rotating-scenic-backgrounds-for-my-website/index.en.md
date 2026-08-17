---
title: 'Rotating Scenic Backgrounds for My Website'
description: 'Documents the complete implementation of rotating scenic backgrounds for my personal website, from technology choices, the wallpaper pool, and client-side rotation to continuity across refreshes and mode changes, site-wide visual refinements, and navigation feedback.'
---

I wanted to replace the website's original grid background with a continuously updated collection of scenic photographs, so that visitors would see different backgrounds and the image could rotate as they browsed. This led me to build a complete path from content acquisition to presentation, covering photo retrieval and updates, client-side state, page navigation and refreshes, and the adaptation of the existing interface to dynamic imagery.

The work first established the content path from Unsplash to the browser, then refined user controls, state persistence, the dynamic wallpaper pool, first-frame restoration, and the site-wide visual system. Testing the completed feature exposed finer boundaries: the restored first frame could still be replaced briefly during the handoff to runtime layers, the image and its overlay could leave scenic mode at different times, changes in filtered results could disturb adjacent layout, and slow page navigation provided no clear feedback. This article records the technical decisions and problem-solving process worth retaining rather than recounting every code change.

## More than replacing a background image

The feature ultimately needed to satisfy all of the following requirements:

- scenic photographs should continue to change instead of remaining a fixed set of local files;
- each visitor should receive a random photo from the available candidates, with automatic rotation while browsing;
- users should be able to disable scenic backgrounds, disable automatic rotation, advance immediately, or download the current photo;
- the API key must never reach the browser, and ordinary page visits should not directly consume search API quota;
- new images should load on demand rather than downloading the entire wallpaper pool at once;
- client-side navigation, browser refreshes, background-mode changes, and light–dark theme changes must not produce abrupt flashes;
- the website must continue to work with its original background when an image or endpoint is unavailable;
- scenic photographs must not compromise the readability of body text, navigation, tags, or interaction states.

These requirements span content acquisition, server-side caching, client-side state, the browser lifecycle, and visual design. Treating them as parts of the same feature is what prevents the result from becoming a decorative effect that fails easily.

## Architecture and technology choices

### Unsplash provides photographs, not application state

The [Unsplash API](https://unsplash.com/documentation) provides photo search, landscape-orientation filtering, dynamic sizing parameters, photographer information, BlurHash values, and other data that make it suitable as a continuously updated image source. Additional width, quality, and format parameters can be appended to the returned `raw` URL, allowing the same photograph to produce resources appropriate for different viewports.

The browser, however, cannot request Unsplash directly with an Access Key. Doing so would expose the key and make every visitor repeat the same search. Unsplash's technical guidelines also require the Access Key to remain confidential and applications to use the image URLs returned by the API instead of storing source images in their own image repositories. Within this boundary, Cloudflare caches only photo metadata, not the Unsplash image files themselves; the browser still displays images directly from Unsplash CDN URLs.

### Responsibilities of the Worker, KV, and Cron

The website already used a Cloudflare Worker to deploy its static assets, so introducing a separate backend was unnecessary. The same Worker ultimately handles two wallpaper endpoints while continuing to pass all other requests to Static Assets:

```text
Cloudflare Cron
      │
      ▼
Worker ──────▶ Unsplash Search API
  │
  ├──────────▶ KV: wallpaper manifest
  │
  ├─ /api/wallpapers ─────────▶ browser
  ├─ /api/wallpapers/download ▶ Unsplash download tracking endpoint
  │
  └─ all other paths ─────────▶ website static assets
```

[Workers KV](https://developers.cloudflare.com/kv/) stores the wallpaper manifest consumed by the browser. A [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) periodically invokes the Worker's `scheduled()` handler, which searches for new photos and updates KV. Ordinary visitors request only the site's manifest endpoint and do not initiate another Unsplash search.

This arrangement separates two lifecycles: the server maintains which photographs are available, while the client decides which one to display now. If Unsplash is temporarily unavailable, the deployed site can continue rotating through any valid manifest still held in KV. If the manifest is unavailable as well, the page retains its original default background.

### Why I did not add a carousel framework

I initially considered existing libraries such as Vegas and Swiper, but this feature has no slide navigation, pagination, touch gestures, or complex sequencing. It needs only preloading, switching, and crossfading. Adding a complete carousel framework would have introduced another dependency and additional state layers without reducing the core logic.

The final implementation uses two native `<img>` layers. The next photograph loads and decodes in the hidden layer before crossfading with the current one. Several responsive resources are provided through `srcset`, leaving the browser to select the appropriate one for the viewport. After the transition, the old layer is cleared; if the same URL appears again, the browser can reuse its HTTP cache. Timed rotation is disabled when the user enables `prefers-reduced-motion`.

## From a photo snapshot to a dynamic wallpaper pool

The first iteration deliberately used a small manifest that was replaced in full. This was sufficient to verify that the image source, server-side cache, responsive loading, and client-side rotation formed a complete path, but it was not suitable as a long-term data strategy. Replacing the whole manifest breaks continuity between old and new photographs, while a small candidate set makes repetition more noticeable.

The final implementation maintains the wallpaper pool incrementally:

1. Fetch landscape-oriented candidate photographs in batches.
2. Filter out results with insufficient resolution, unsuitable aspect ratios, invalid URLs, or missing required metadata.
3. Merge new results with the existing photographs in KV and deduplicate them by ID.
4. Maintain chronological order using `created_at` from the Unsplash record.
5. Set a capacity bound for the pool and remove older records in chronological order.
6. Avoid writing to KV when the merged result has not changed.

Here, `created_at` is the time at which the photograph was created on Unsplash, not the time at which it was taken. Although the search endpoint supports `order_by=latest`, its results should not be treated as a strictly ordered event stream. Maintaining a bounded pool is what makes deduplication and the removal of old records reliable across multiple searches.

The manifest later gained `createdAt` and `blurHash`. The upgrade did not leave behind obsolete KV data that would never be read again. Instead, it retained the existing storage key: the reader first validates the complete data structure, the old structure fails the new validation, and the next successful refresh writes the new manifest to the same location. This approach fits a feature that is still under development and does not need rollback support for the old data format.

### Three timescales that should remain separate

The final implementation has three distinct timescales:

| Timescale                   | What it controls                                  | Decision basis                             |
| --------------------------- | ------------------------------------------------- | ------------------------------------------ |
| Server-side content updates | Discovering and merging new candidate photographs | Upstream update cadence and API quota      |
| Client-side manifest sync   | Detecting changes to the server-side pool         | Data freshness versus unnecessary requests |
| Client-side visual rotation | Changing the photograph currently on screen       | Reading stability and the pace of change   |

The upstream update cadence and API quota govern server-side updates. Client-side synchronization consumes only requests to this site, while visual rotation determines what visitors perceive. Keeping the three periods independent makes it possible to discover new photographs more often without making visitors query Unsplash repeatedly or changing the background at the same frequency.

## Random rotation is not independent random selection

Selecting independently from the entire wallpaper pool every time is simple, but it can choose the photograph just shown again, or return to it too frequently. The final implementation instead uses a randomized queue: after receiving a manifest, it shuffles the candidates with the Fisher–Yates algorithm and takes each successive photograph from the front. Once the queue is exhausted, it excludes the current photograph and creates another randomized order.

The rotation interval is not fixed to one duration either. It is resampled within a bounded range, keeping the overall rate of change predictable while avoiding the mechanical rhythm of a fixed period.

The client stores the IDs of the photographs still awaiting display in `sessionStorage`. When the same tab navigates to another page and returns, the rotation sequence continues instead of being randomized anew on every page.

The wallpaper manifest may change while the visitor is browsing. A separate selection algorithm specifically for manifest updates would eventually diverge from the repetition rules used by ordinary rotation. Manifest updates therefore reconcile the same pending queue:

- retain the current wallpaper without triggering an immediate switch;
- remove photographs from the queue if they are no longer present in the new manifest;
- add newly discovered photographs to the pool of those not yet displayed;
- reshuffle the remaining queue;
- load a new photograph only when its turn arrives.

This prevents a background data update from interrupting the current image without creating a second rotation model solely for incremental synchronization.

## Controls need unambiguous semantics

The earliest interaction design treated “Rotate automatically,” “Keep current,” and “Use default background” as three parallel modes. In practice, that arrangement introduced a semantic conflict: if the default background is currently visible and the user chooses “Keep current,” should the site keep the default background or first switch to a scenic photograph and then pin it? The latter can be implemented, but it contradicts the literal meaning of the control.

The final control panel converges on two layers of state and two actions:

- **Use random scenic backgrounds:** the master switch; disabling it restores the original default background;
- **Rotate automatically:** an independent switch that controls only automatic changes;
- **Next:** immediately take the next photograph from the same randomized queue;
- **Download:** download the current photograph.

Disabling scenic backgrounds also disables the automatic-rotation control. Automatic rotation and manual advancement share the same selection and loading logic; only their trigger differs. Ordinary display and advancement are browsing actions. The site calls the download tracking endpoint and saves the current image only when the user selects Download. The photographer and Unsplash attribution links always follow the current photograph, but remain visually subdued so they do not compete with the article or navigation.

User preferences and per-tab state have different storage lifetimes:

| Storage          | Data retained                                                    | Reason                                                 |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| `localStorage`   | Whether scenic backgrounds and automatic rotation are enabled    | Preserve user choices across tabs and browser restarts |
| `sessionStorage` | Current photograph, pending queue, and current background record | Maintain continuity only within the current tab        |

This distinction avoids making one random result permanent while also avoiding the need to restore preferences whenever the user opens another page.

## Why page navigation and refreshes caused flashes

The hardest problem in the background feature was not the crossfade parameters, but the existence of two fundamentally different page lifecycles in the browser.

### Client-side navigation

The website uses Astro's client-side router. [Astro view transitions](https://docs.astro.build/en/guides/view-transitions/) replace the main page content and dispatch events such as `astro:before-swap`, `astro:after-swap`, and `astro:page-load` in sequence. If the background component is also recreated on every page, the controller initializes again and even the same photograph runs through another fade-in.

The solution is to preserve the background media container across navigation with `transition:persist` and align controller initialization and cleanup with the Astro lifecycle. The article content retains its original transition, while the background no longer participates in every DOM swap. One regression appeared during this work: broadening the scope of a transition rule to suppress theme flashes unintentionally changed the page-navigation effect. Theme changes and page navigation ultimately need separate control rather than one global animation rule applied to both.

### Hard browser refreshes

A hard refresh is different. The old document is destroyed completely, and no DOM persistence can cross that boundary. The first implementation had to wait for the client script to fetch the manifest, find the previous photograph, and load it again, so the page showed the default background before the scenic photograph abruptly appeared.

Saving only the photo ID cannot solve the first-frame problem because the HTML parser does not yet know the URL to display. BlurHash was later added so that a newly encountered photograph could first show a low-resolution placeholder. But when a clear background had already been visible before the refresh, returning through “blurred to clear” was still an obvious regression. The browser cache can reduce network transfer, but it cannot stop the script from activating the same image as though it were new state.

The eventual solution was to redefine the responsibilities of the layers:

- the **document-root background layer** restores the stable image before the runtime code starts;
- the **runtime background layer** takes ownership of that same restored photograph and participates in mode changes together with the overlay;
- the **two image layers** handle loading and crossfading only when the site genuinely moves to another photograph.

After a photograph is displayed successfully, the client records its current URLs and, when conditions permit, produces a size-limited clear poster. On the next hard refresh, an inline script in `<head>` synchronously restores the theme, background mode, and document-root background layer before the first paint. Because this restoration layer belongs to the root element rather than to a wallpaper component parsed later, the page does not first pass through the default background.

The runtime controller must not hide the restoration layer as soon as it starts. It first establishes a bootstrap layer inside the wallpaper container from the same source, then transfers ownership of the background from the document root to the runtime container. The bootstrap layer leaves only after a later image layer is genuinely ready. Restoration, handoff, and subsequent activation therefore use the same photograph without an empty intermediate frame or a redundant reload of an image that was already clear.

A newly encountered photograph can therefore still use a BlurHash transition, while a photograph that has already appeared clearly is restored directly in its clear state after a refresh. These are different situations and should not share the same placeholder strategy.

### Switching background modes is not rotating photographs

Disabling scenic backgrounds once produced a different flash: the photograph disappeared first and the overlay left afterward, briefly exposing only a light or dark veil. Giving both changes the same duration does not make them atomic when they belong to separate layers; the browser can still render an intermediate frame. Replacing `opacity` with `visibility` avoids the fade only by turning the problem into an abrupt jump.

The photograph, bootstrap background, and overlay now belong to one runtime media container. Switching between scenic and default backgrounds changes the visibility of that complete container. Automatic rotation and manual advancement, by contrast, crossfade only between the two image layers. A mode change therefore operates on one complete scene, while photo rotation operates on two photographs; the two interactions no longer share incompatible animation semantics.

This also makes activation and deactivation symmetrical. If a runtime image already exists, the complete media layer returns directly. Otherwise, the bootstrap background restores the previous photograph until the next image takes over. Disabling scenic mode fades out the same complete unit, keeping control state, layer ownership, and the animated object aligned.

## Page continuity also requires visible waiting states

Once the background stopped flashing, page navigation exposed another continuity problem. On a slow response, clicking a blog, project, or article link left the old page unchanged while the request was pending. Prefetching can shorten some waits, but it cannot cover a first tap on mobile, a cache miss, or a weak connection. Without feedback, a visitor can reasonably assume that the click failed and try again.

The site already uses Astro's client-side router, so navigation feedback attaches directly to `astro:before-preparation`, `astro:before-swap`, and `astro:page-load` rather than introducing a second interception mechanism. Navigation start records the destination and triggering element, the state is carried into the incoming document during the swap, and completion, cancellation, and failure share one cleanup path. Repeated clicks on the same destination do not issue another request, while a different destination can still replace the pending navigation.

The visible indicator is a thin indeterminate line overlaid on the top edge of the navigation bar. It consumes no layout height and therefore cannot move the page. A short display delay avoids noise on fast navigations, while a minimum visible duration prevents the line from appearing and vanishing as a flash once shown. Primary navigation destinations use more eager prefetching; `aria-busy`, localized status text, and `prefers-reduced-motion` cover assistive technology and reduced-motion preferences.

Hard browser refreshes do not reuse this indicator. Site scripts cannot run in the new document until its HTML has arrived, so an in-page line could represent only the latter part of a full reload and might introduce another flash. The browser's own reload feedback remains responsible for that lifecycle.

## One photograph forced a redesign of the site's visual system

The colors and contrast of the original grid background were predictable, so headings, body text, and secondary information could use substantially different brightness levels. A scenic photograph can contain sky, branches, rock, water, and shadow at the same time. The same gray text may be clear in one region and almost disappear in another.

The initial response was to add overlays, card backgrounds, and local opacity adjustments one component at a time. Two problems soon emerged: the pages became increasingly dark, and the components accumulated inconsistent patches. Adding a nearly opaque panel wherever text appeared did not establish a coherent new visual rule.

The final design defines four explicit combinations:

|            | Default background             | Scenic background                                           |
| ---------- | ------------------------------ | ----------------------------------------------------------- |
| Light mode | Original light-mode typography | High-contrast black text with a light global overlay        |
| Dark mode  | Original dark-mode typography  | Compressed white-text brightness with a dark global overlay |

The theme and background type are stored as separate attributes on the root element. CSS variables then select typography, surfaces, borders, and overlays for the resulting combination. The default background can continue to use the original palette, while the scenic background uses contrast relationships designed specifically for complex imagery.

In dark scenic mode, body text no longer uses a gray-white far dimmer than the heading; it is only slightly darker. Light scenic mode follows the same principle: headings, body text, and supporting text all remain close to black. Hierarchy still exists, but it cannot depend on substantially reducing text brightness. A consistent overlay and brightness treatment makes the background itself yield to the content instead of requiring every component to apply another patch.

The navigation bar, project card, and wallpaper settings popover use consistent translucent surfaces and borders, avoiding gradients that make one side lighter than the other. Interaction states are simplified as well: hover and keyboard focus use an underline, while the current item uses a marker on the left. Selecting an item in the table of contents does not change its font weight because that would change wrapping and layout. Photo attribution remains at the edge of the page and uses the weakest text treatment across the site.

The blog filter exposed a further distinction between correct state and a stable interface. When filtering sharply reduces the result count, the height of the results column changes. If the sticky filter panel is itself the corresponding grid item, that change can also move the panel. A stable outer sidebar now provides the vertical layout boundary, while an inner panel alone owns sticky positioning, so the filter area no longer shifts with the number of results.

A selected filter cannot rely on text color alone either. Changes to the global text palette had weakened the original emphasis, and the count could override the parent state with its own subdued color. The selected item therefore combines an accent line on the left, a restrained translucent surface, and textual emphasis; the count inherits that state before reducing only its opacity. This differs deliberately from the table of contents: filter labels have a controlled width and can use weight as an additional signal, whereas changing the weight of wrapping table-of-contents text would disturb its layout.

This work demonstrates that a dynamic background is not an isolated decorative layer. Once the background becomes part of the reading environment, the site's text hierarchy, surface system, navigation structure, and interaction feedback all need to be reconsidered.

## Failure handling and test boundaries

Wallpapers are an enhancement, and no failure should prevent the main website from rendering. The server and client enforce separate boundaries:

- when KV has no valid manifest, the Worker attempts to initialize one; if initialization fails, it returns `503` instead of inventing an empty manifest;
- when an Unsplash search fails or yields too few usable candidates, it does not overwrite the existing wallpaper pool;
- manifest responses include an ETag so that the browser can revalidate without retransmitting unchanged data;
- if image loading or decoding fails, the current background remains visible while the client tries the next photograph in the queue;
- revision numbers and `AbortController` invalidate obsolete loading tasks during rapid consecutive actions;
- rotation and manifest refresh pause while the page is hidden and are scheduled again when it becomes visible;
- after scenic backgrounds are disabled, rotation and manifest synchronization stop as well.

The tests cover more than whether an image is visible. Worker unit tests cover search-result filtering, deduplication and merging in the wallpaper pool, capacity-based eviction, unchanged updates, manifest initialization, and the download endpoint. Browser tests cover control state, automatic rotation, manual advancement, page navigation, light and dark themes, the mobile menu, and failure recovery.

The hard-refresh problem also requires more specific assertions: the first rendered frame after a refresh should already contain the saved clear background, the same photograph must not re-enter an active image layer, and controller initialization must not issue another image request for it. Mode-switching tests separately verify the visibility of the complete media layer and retention of the active image, preventing the return of an intermediate state in which the photograph is gone but the overlay remains.

Other parts of the page gained corresponding invariants as well. The top of the filter panel must remain fixed as result height changes. A slow client-side navigation must produce only one request for its destination, expose a busy state on the main content, and leave the navigation bar at exactly the same height before and after the progress line appears. Translating visible continuity and stability into observable state is what prevents later changes from reintroducing the same regressions in another form.

## Conclusion

The rotating scenic backgrounds ultimately consist of three layers that are independent but coordinated:

- the server maintains a continuously updated, capacity-bounded pool of usable photographs;
- the client maintains the randomized queue and display state for the current tab;
- the visual system handles the four combinations of light and dark themes with default and scenic backgrounds.

The most important lessons from this implementation are not tied to a particular API or animation parameter, but to separating problems that look similar: API updates are not client-side rotation, browser caching is not visual-state restoration, page navigation is not a hard refresh, a BlurHash placeholder for first display is not refresh restoration, and switching background modes is not rotating photographs. Only by modeling these lifecycles separately can the background avoid returning with a different kind of flash after every fix.

Likewise, a global visual element cannot be integrated by continually patching individual components. Defining the responsibilities of each background layer, representing display modes as global state, and rebuilding typography and surface hierarchy through shared variables are only the foundation; adjacent experiences such as waiting feedback, filter layout, and interaction states must be checked as well. The result becomes stable only when the boundaries in the code match the visual boundaries experienced by the visitor.
