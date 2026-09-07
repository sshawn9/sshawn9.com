---
title: 'Rotating Scenic Backgrounds for My Website'
description: 'Documents the complete implementation of rotating scenic backgrounds for my personal website, from technology choices, the wallpaper pool, and client-side rotation to first-frame restoration, layer compositing, and the handoff to a persistent site shell.'
---

I wanted to replace the website's original grid background with a continuously updated collection of scenic photographs, so that visitors would see different backgrounds and the image could rotate as they browsed. That intent turned into a complete path from content acquisition to presentation, covering photo retrieval and updates, client-side state, page navigation and refreshes, and the adaptation of the existing interface to dynamic imagery.

The work first established the content path from Unsplash to the browser, then refined user controls, state persistence, the dynamic wallpaper pool, first-frame restoration, and the site-wide visual system. Testing the completed feature exposed finer boundaries: the restored first frame could still be replaced briefly during the handoff to runtime layers, the image and its overlay could leave scenic mode at different times, changes in filtered results could disturb adjacent layout, and slow page navigation provided no clear feedback. This article records the decisions and diagnoses worth keeping rather than recounting every code change.

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

These requirements span content acquisition, server-side caching, client-side state, the browser lifecycle, and visual design. Treating them as one system is what prevents the result from becoming a decorative effect that fails easily.

## Architecture and technology choices

### Unsplash provides photographs, not application state

The [Unsplash API](https://unsplash.com/documentation) provides photo search, landscape-orientation filtering, dynamic sizing parameters, photographer information, BlurHash values, and other data that make it suitable as a continuously updated image source. Additional width, quality, and format parameters can be appended to the returned `raw` URL, so the same photograph can produce resources appropriate for different viewports.

The browser, however, cannot request Unsplash directly with an Access Key. Doing so would expose the key and make every visitor repeat the same search. Unsplash's technical guidelines also require the Access Key to remain confidential and applications to use the image URLs returned by the API instead of rehosting the source images themselves. Within this boundary, Cloudflare caches only photo metadata, never the Unsplash image files; the browser still displays images directly from Unsplash CDN URLs.

### Responsibilities of the Worker, KV, and Cron

The website already used a Cloudflare Worker to deploy its static assets, so introducing a separate backend was unnecessary. The same Worker handles two wallpaper endpoints while passing all other requests to Static Assets:

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

[Workers KV](https://developers.cloudflare.com/kv/) stores the wallpaper manifest consumed by the browser. A [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) periodically invokes the Worker's `scheduled()` handler, which searches for new photos and updates KV. Ordinary visitors request only the site's manifest endpoint and never initiate an Unsplash search.

This arrangement separates two lifecycles: the server maintains which photographs are available, while the client decides which one to display now. If Unsplash is temporarily unavailable, the deployed site keeps rotating through any valid manifest still held in KV. If the manifest is unavailable as well, the page retains its original default background.

### Why I did not add a carousel framework

I considered existing libraries such as Vegas and Swiper, but this feature has no slide navigation, pagination, touch gestures, or complex sequencing. It needs only preloading, switching, and crossfading. A complete carousel framework would have added a dependency and another layer of state without removing any of the core logic.

The final implementation uses two native `<img>` layers. The next photograph loads and decodes in the hidden layer before crossfading with the current one. Several responsive resources are offered through `srcset`, leaving the browser to pick one for the viewport. After the transition the old layer is cleared, so the same URL can later be served from the browser's HTTP cache. Timed rotation does not run at all when the user prefers `prefers-reduced-motion`.

## From a photo snapshot to a dynamic wallpaper pool

The first iteration deliberately used a small manifest that was replaced in full. That was enough to verify that the image source, server-side cache, responsive loading, and client-side rotation formed a complete path, but it was never a viable long-term data strategy: replacing the whole manifest breaks continuity between old and new photographs, and a small candidate set makes repetition obvious.

The final implementation maintains the wallpaper pool incrementally:

1. Search for a batch of landscape-oriented candidate photographs using fixed criteria.
2. Filter out results with insufficient resolution, unsuitable aspect ratios, invalid URLs, or missing required metadata.
3. Merge new results with the existing photographs in KV and deduplicate them by ID.
4. Maintain chronological order using `created_at` from the Unsplash record.
5. Set a capacity bound for the pool and evict older records in chronological order.
6. Skip the KV write entirely when the merged result has not changed.

Here, `created_at` is the time at which the photograph was created on Unsplash, not the time at which it was taken. Although the search endpoint supports `order_by=latest`, its results should not be treated as a strictly ordered event stream. Maintaining a bounded pool of my own is what makes deduplication and eviction reliable across repeated searches.

The manifest later gained `createdAt` and `blurHash`. The upgrade did not leave behind obsolete KV data that would never be read again; it reused the existing storage key. The reader validates the complete data structure first, the old structure fails the new validation, and the next successful refresh writes the new manifest to the same location. This suits a feature still under development, where rollback support for the previous format has no value.

### Three timescales that should remain separate

The final implementation has three distinct timescales:

| Timescale                   | What it controls                                  | Decision basis                             |
| --------------------------- | ------------------------------------------------- | ------------------------------------------ |
| Server-side content updates | Discovering and merging new candidate photographs | Upstream update cadence and API quota      |
| Client-side manifest sync   | Detecting changes to the server-side pool         | Data freshness versus unnecessary requests |
| Client-side visual rotation | Changing the photograph currently on screen       | Reading stability and the pace of change   |

Upstream cadence and API quota govern server-side updates. Client-side synchronization consumes only requests to this site, while visual rotation is the only one visitors actually perceive. Keeping the three periods independent makes it possible to discover new photographs more often without making visitors query Unsplash repeatedly, and without forcing the background to change at that same rate.

## Random rotation is not independent random selection

Selecting independently from the entire pool each time is simple, but it can pick the photograph just shown, or return to it far too often. The implementation uses a randomized queue instead: after receiving a manifest it shuffles the candidates with the Fisher–Yates algorithm and takes each successive photograph from the front. Once the queue is exhausted, it excludes the current photograph and generates the next random order.

The rotation interval is not a single fixed value either. Each cycle draws a new random duration from a preset range, so the overall rate of change stays within the intended band without settling into a predictable, mechanical rhythm.

The client stores the IDs of photographs still awaiting display in `sessionStorage`. When the same tab navigates elsewhere and returns, the rotation sequence continues rather than being reshuffled on every page.

The manifest may change while a visitor is browsing. Writing a second selection algorithm specifically for manifest updates would guarantee that the two random paths eventually disagree about what counts as a repeat. Manifest updates therefore reconcile the same pending queue:

- retain the current wallpaper without triggering an immediate switch;
- remove photographs no longer present in the new manifest;
- add newly discovered photographs to the set not yet displayed;
- reshuffle the remaining queue;
- load a new photograph only when its turn arrives.

A background data update therefore never interrupts the current image, and incremental synchronization never acquires a rotation model of its own.

## Controls need unambiguous semantics

The earliest interaction design treated “Rotate automatically,” “Keep current,” and “Use default background” as three parallel modes. In practice that produced a semantic conflict: if the default background is currently visible and the user chooses “Keep current,” should the site keep the default background, or first switch to a scenic photograph and then pin it? The latter is implementable, but it contradicts what the control says.

The final control panel converges on two layers of state and two actions:

- **Use random scenic backgrounds:** the master switch; disabling it restores the original default background;
- **Rotate automatically:** an independent switch that controls only timed changes;
- **Next:** immediately take the next photograph from the same randomized queue;
- **Download:** download the current photograph.

Disabling scenic backgrounds also disables the automatic-rotation control. Automatic rotation and manual advancement share one selection and loading path; only the trigger differs.

Download is the only action that has to distinguish intent. Ordinary display and advancement are browsing, and must not be counted as downloads; the site calls Unsplash's download tracking endpoint and saves the image only when the user explicitly presses Download. That is both what the API guidelines require and what keeps rotation counts from being misreported as download counts.

Attribution turned out to be another continuity problem hiding in plain sight. The server renders the attribution structure, and a synchronous in-page script fills in the photographer and photo links from the wallpaper boot snapshot while the document is still parsing; hydration and later rotations only update the text and `href` of nodes that already exist. A refresh therefore never shows a gap where the credit should be, followed by the client injecting a block of content into it. Attribution always tracks the current photograph, but stays at the weakest text treatment on the site so it never competes with the article or navigation.

User preferences and per-tab state have different storage lifetimes:

| Storage          | Data retained                                                         | Reason                                                 |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| `localStorage`   | Scenic backgrounds on/off, automatic rotation on/off, pinned photo ID | Preserve user choices across tabs and browser restarts |
| `sessionStorage` | Current photograph, pending queue, and current background record      | Maintain continuity only within the current tab        |

This split keeps one random result from becoming permanent, without making visitors reconfigure their preferences on every new page.

## Why page navigation and refreshes caused flashes

The hardest problem here was never the crossfade parameters. It was that the browser has two fundamentally different page lifecycles, and the background has to survive both.

### Client-side navigation

The site uses [Swup](https://swup.js.org/) for client-side navigation, but the router replaces only the content container holding the main page and footer. The header, wallpaper layers, and their controllers belong to a long-lived site shell that never participates in a DOM swap, and the transition is scoped to the replaceable content instead of snapshotting the whole document.

For the wallpaper, that single boundary is sufficient. Moving to another article no longer makes the same photograph fade in again, and rotation timers, the settings popover, and attribution nodes are never destroyed and rebuilt. The one thing that still needs an explicit agreement is the theme: it changes the entire site's palette, while navigation changes only content, so the two must animate through separate objects. Sharing one would drag the content area into every theme change.

The full design of the persistent shell, script scoping, and global controllers is covered in [From Page Transitions to a Persistent Shell: Governing the Client Lifecycle of My Website](/en/blog/persistent-navigation-shell-and-client-lifecycle-for-my-website/). This article keeps only the boundary that touches wallpaper continuity.

### Hard browser refreshes

A hard refresh is different. The old document is destroyed completely, and no amount of DOM persistence crosses that boundary. The first implementation had to wait for the client script to fetch the manifest, find the previous photograph, and load it again, so the page showed the default background before the scenic photograph appeared out of nowhere.

Saving only the photo ID does not solve the first frame, because at HTML parse time nothing knows the URL to display. BlurHash can express a low-frequency placeholder, but it is the wrong tool for restoring a photograph that was already sharp on screen; making the visitor sit through “blurred to clear” again after every refresh is a visible regression, not a recovery. The browser's HTTP cache only reduces transfer — it cannot decide which layer owns the first frame, or when that layer should hand off.

The fix was to redistribute responsibility across four layers:

- the **root state** restores theme, background mode, photo ID, and the actual display URL before the first paint;
- the **SSR boot layer** reads that root state and immediately shows the photograph and overlay that were last displayed successfully;
- the **runtime media layer** holds two image layers and its own overlay, and is responsible only for genuinely moving to the next photograph;
- the **server-rendered attribution** recovers from the same current-photo state and is then updated in place by the runtime.

Once a photograph displays successfully, the client records its URL and, when conditions allow, stores a size-limited copy as a poster. On the next hard refresh, the inline script in `<head>` writes the theme, background mode, photo information, and `--wallpaper-boot-image` onto `<html>` before paint, and the boot layer the server already emitted picks up those attributes and variables. The visible background is still an SSR DOM layer — the root element is not painting a background image of its own.

When the runtime controller starts, it does not hide the boot layer, and it does not reload the same photograph into an active `<img>` just to claim ownership. If the current photo and boot background are valid, the boot layer keeps displaying while the controller restores the photo object, the rotation queue, and its timers. Only after a genuinely different photograph has been selected, loaded, decoded, and activated does the compositor state on the root element (`data-wallpaper-compositor`) let the boot layer retire. No frame in that sequence is ever without a background, and an image that was already sharp is never fetched twice.

If a poster cannot be produced because of size, storage quota, or a network failure, the boot snapshot falls back to the last recorded Unsplash URL; if the photo state itself is invalid, the page safely uses the default background.

BlurHash therefore no longer renders anything — but it was not removed from the manifest. The pre-paint script has to decide whether a wallpaper snapshot is complete and trustworthy, and `blurHash` is one of the required fields in that structural check: missing or empty means the snapshot is invalid and the page falls back to the default background. It went from being render data to being an integrity marker. The reason to keep a field can be completely different from the reason it was introduced.

### Switching background modes is not rotating photographs

Disabling scenic backgrounds once produced a flash of its own: the photograph left first and the overlay followed, briefly exposing a bare light or dark veil. Giving both changes the same duration does not make them atomic when they live on separate layers — the browser can still paint that intermediate frame. Swapping `opacity` for `visibility` avoids the fade only by converting the problem into an abrupt jump.

Rather than forcing the boot layer and the runtime image layers into one container, each became a complete compositing layer: the boot layer contains its own image and overlay, and the runtime media layer contains its active images and overlay. Switching between scenic and default backgrounds always changes the opacity of one complete compositing layer. Rotating photographs, automatically or manually, crossfades only between the two image layers inside the runtime media layer. The half-finished frame where the photo is gone but the overlay lingers cannot occur.

This also makes enabling symmetrical: if a runtime image layer already exists, the complete media layer returns; if it does not, the complete boot layer does. Disabling fades out whichever complete layer is current while retaining photo and queue state, so re-enabling does not have to pick a new random background. Control state, layer ownership, and the animated object stay aligned.

## Page continuity also requires visible waiting states

Once the background stopped flashing, navigation exposed a different kind of discontinuity. On a slow response, clicking a link leaves the old page unchanged, and a visitor will reasonably conclude the click failed and try again. Prefetching shortens some of that wait, but it cannot cover a first tap on mobile, a cache miss, or a weak connection.

Only one constraint here is really about the background: loading feedback must reuse the same navigation lifecycle rather than introducing a second link-interception mechanism. The waiting indicator is an indeterminate progress bar overlaid on the edge of the navigation bar. It occupies no layout height, so it cannot shift the page while a request is pending, and therefore cannot disturb the compositing of the background layers underneath. Its timing, duplicate-click merging, and accessibility state belong to navigation itself, and are covered in the article linked above.

Hard refreshes do not reuse this indicator. Site scripts cannot run in the new document until its HTML arrives, so an in-page bar could only represent the second half of a reload, and might add a flash of its own. The browser's native reload feedback owns that lifecycle.

## One photograph forced a redesign of the site's visual system

The colors and contrast of the original grid background were predictable, so headings, body text, and secondary information could sit at substantially different brightness levels. A scenic photograph contains sky, branches, rock, water, and shadow at once; the same gray text is legible over one region and nearly invisible over another.

The first response was to add overlays, card backgrounds, and local opacity adjustments one component at a time. Two problems appeared quickly: the pages grew darker and darker, and the components accumulated inconsistent patches. Dropping a nearly opaque panel behind every piece of text is not a visual rule — it is an admission that no rule exists.

The final design defines four explicit combinations:

|            | Default background             | Scenic background                                           |
| ---------- | ------------------------------ | ----------------------------------------------------------- |
| Light mode | Original light-mode typography | High-contrast black text with a light global overlay        |
| Dark mode  | Original dark-mode typography  | Compressed white-text brightness with a dark global overlay |

Theme and background type are separate attributes on the root element, and CSS variables select typography, surfaces, borders, and overlays for the resulting combination. The default background keeps its original palette; the scenic background uses contrast relationships designed for complex imagery.

In dark scenic mode, body text is no longer a gray-white far dimmer than its heading — it sits just slightly below it. Light scenic mode follows the same principle, with headings, body, and supporting text all close to black. Hierarchy still exists, but it can no longer be expressed by dropping text brightness. A single consistent overlay and brightness treatment makes the image recede behind the content, instead of every component patching around it.

The navigation bar, project cards, and the wallpaper settings popover share one translucent surface and border treatment, avoiding gradients that leave one edge bright and the other dim. Interaction states are simplified too: hover and keyboard focus use an underline, and the current item uses a marker on the left. Selecting an entry in the table of contents does not change its font weight, because that would change wrapping and shift layout. Photo attribution stays at the page edge with the weakest text treatment on the site.

The blog filter exposed a further gap between correct state and a stable interface. When filtering sharply reduces the result count, the height of the results column changes; if the sticky filter panel is itself that grid item, the panel moves too. A stable outer sidebar now owns the vertical layout boundary while an inner panel owns only sticky positioning, so the filter area no longer follows the number of results.

A selected filter cannot rely on text color alone either. Once the global text palette changed, the original emphasis was weakened, and the tag count could override its parent's state with a subdued color of its own. Selected items now combine an accent line on the left, a restrained translucent surface, and textual emphasis, with the count inheriting that state before reducing only its opacity. This deliberately differs from the table of contents: filter labels have a controlled width and can use weight as an extra signal, whereas table-of-contents entries wrap, so changing their weight would move the layout.

The lesson is that a dynamic background is not an isolated decorative layer. Once it enters the reading environment, the site's text hierarchy, surface system, navigation structure, and interaction feedback all have to be re-examined.

## Failure handling and test boundaries

Wallpapers are an enhancement, and no failure should keep the site itself from rendering. The server and client enforce separate boundaries:

- when KV has no valid manifest, the Worker attempts to initialize one; if initialization fails it returns `503` rather than inventing an empty manifest;
- when an Unsplash search fails, or the merged pool would fall below its minimum size, the existing wallpaper pool is not overwritten;
- manifest responses carry an ETag so the browser can revalidate without retransmitting unchanged data;
- if image loading or decoding fails, the current background stays visible while the client tries the next photograph in the queue;
- rapid consecutive actions discard stale results through a self-incrementing activation revision, and releasing the controller terminates the whole lifecycle through `AbortController`;
- rotation and manifest refresh pause while the page is hidden, and are rescheduled when it becomes visible again;
- once scenic backgrounds are disabled, rotation and manifest synchronization stop as well.

The tests check more than whether an image appears. Worker unit tests cover search-result filtering, pool merging and deduplication, capacity eviction, unchanged updates, manifest initialization, and the download endpoint. Browser tests cover control state, automatic rotation, manual advancement, page navigation, light and dark themes, the mobile menu, and failure recovery.

The hard-refresh problem needs more specific assertions than that. The first painted frame after a refresh must already contain the saved sharp background; the same photograph must not re-enter an active image layer; and controller initialization must not issue another network request for it. Mode-switching tests separately assert the opacity of the complete media layer and the retention of the active image, so the “photo gone, overlay still there” frame cannot return unnoticed.

Other parts of the page gained matching invariants. The top of the filter panel stays fixed as result height changes. A slow client-side navigation produces exactly one request for its destination, exposes a busy state on the main content, and leaves the navigation bar at precisely the same height before and after the progress bar appears. Turning perceived continuity into observable state is what stops a later change from reintroducing the same regression in a new form.

## Conclusion

The rotating scenic background ended up as three layers that are independent but cooperative:

- the server maintains a continuously updated, capacity-bounded pool of usable photographs;
- the client maintains the randomized queue and display state for the current tab;
- the visual system handles the four combinations of light and dark themes with default and scenic backgrounds.

The most useful lesson was not about any particular API or animation parameter. It was about separating problems that look alike: an API update is not client-side rotation, a browser cache is not visual-state restoration, client-side navigation is not a hard refresh, a remote URL is not ownership of the first frame, and switching background modes is not rotating photographs. Only after modeling those lifecycles separately did the background stop reappearing with a new kind of flash after every fix.

The same applies to global visual elements. Defining what each background layer owns, promoting display mode to global state, and rebuilding typography and surface hierarchy on shared variables is only the foundation; adjacent experiences such as waiting feedback, filter layout, and interaction states have to be checked as well. The experience becomes stable only when the state boundaries in the code line up with the visual boundaries the visitor actually sees.
