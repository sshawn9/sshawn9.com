---
title: 'From Page Transitions to a Persistent Shell: Governing the Client Lifecycle of My Website'
description: 'Documents how my personal website evolved from scattered page scripts into a persistent site shell, and how it governs lifecycle and visual-continuity problems across overlays, navigation, first-frame state, font readiness, page enhancements, and Pagefind search.'
---

My personal website is still a set of static pages built with Astro, but “open the HTML, read it, leave” is no longer its only mode of operation. Themes, scenic wallpapers, mobile navigation, article tables of contents, interactive figures, image viewers, and site search all need client-side state, and pages hand off to one another through partial navigation. It is not a traditional single-page application, yet it now has a long-running client runtime.

This round of work began with a handful of very small symptoms: a popover kept its position after its trigger disappeared at a breakpoint, global controllers reinitialized on every navigation, body text shifted once more after a page swap had already completed, the mouse cursor blinked when hovering a navigation link, and search results vanished and returned on every keystroke. They looked like defects in five unrelated components. They all pointed at the same question: **who owns a piece of DOM, who owns its state, how long should it live, and who cleans it up.**

Rather than listing changes in commit order, this article records the architectural boundaries that survived, the directions that turned out to be wrong, and why these problems kept reaching into one another. The wallpaper's own data path, randomized queue, and first-frame layers remain in [Rotating Scenic Backgrounds for My Website](/en/blog/rotating-scenic-backgrounds-for-my-website/).

## Overlays exposed the ownership problem first

Wallpaper settings, version comparison, and mobile navigation are all transient interfaces. The early implementation wrote dismissal, positioning, focus, and navigation cleanup separately into each component. Any single scenario usually worked; the combinations did not:

- narrowing the window after opening the desktop wallpaper menu hid the trigger button while the overlay stayed on screen;
- an overlay from the old page could survive into the content swap after navigation began;
- the native Popover API and the fallback implementation synchronized `aria-expanded` at different moments;
- after an entry script ran a second time, the old listeners still responded to events;
- when one overlay opened, another had no idea it was supposed to close.

Instead of adding more local conditions to each popover, the fix was a single site-wide contract for transient interfaces:

- express open, light-dismiss, and Escape semantics through the native Popover API, loading a polyfill where it is unsupported;
- allow at most one transient overlay to be active at a time;
- close them all when navigation begins;
- re-verify that an overlay still has a visible trigger after any viewport size or orientation change;
- close the overlay when its trigger is hidden, disconnected, or no longer suitable as a positioning anchor, rather than guessing at a new position;
- on mobile, place wallpaper settings directly inside the navigation panel instead of making one desktop popover serve two layouts.

What mattered here was not the Popover API. It was defining “transient interface” as a concept the whole site understands. A component only declares that it is a transient overlay; a shared controller owns mutual exclusion, validation, and cleanup.

## Global scripts need exactly one instance

Partial navigation re-executes the scripts in each new page, and dev-server reloads or a deployment version change can run the same entry again. Module-scoped variables and component unmount callbacks cannot guarantee that the previous instance has actually exited. Duplicate scroll listeners, media-query listeners, and timers then produce the kind of intermittent behavior that is very hard to explain.

The site therefore gained a very small client-runtime registry. A controller claims ownership by name; when a controller of the same name starts again, the registry disposes the previous instance before letting the new one register. Listeners, timers, observers, and any other cleanup all hang off the same disposal handle.

```text
claimClientRuntime('navigation')
  ├─ register event listeners
  ├─ register additional cleanup
  └─ claiming again disposes the previous instance first
```

Theme, navigation, wallpaper, reveal, the table of contents, and transient overlays all follow this contract. It does not fix one particular memory leak; it fixes the structural problem of a long-running static site having no explicit runtime ownership at all.

## The site shell should not be rebuilt with the article

The site originally used document-level page transitions. They are an easy way to get a whole-page effect, but the header, wallpaper, and global controllers fall inside the scope of the swap or the transition snapshot too. Even when nothing moves visually, real nodes can still be relocated, rebuilt, or briefly lose their hit-testing relationship.

The site moved to [Swup](https://swup.js.org/), but the point was never “switching router libraries.” It was tightening the replacement boundary:

```text
body
├─ SiteChrome                persists
│  ├─ navigation bar and progress feedback
│  ├─ theme controls
│  ├─ wallpaper layers, settings, and photo credit
│  └─ mobile navigation and accessibility state
│
└─ #swup                     page outlet
   ├─ main                   replaced on every navigation
   └─ footer                 replaced on every navigation
```

Swup's `containers` holds only `#swup`, and `animationScope` is set to `containers`. Content crossfades therefore affect only the page outlet, animation classes are no longer written to `<html>`, and neither the shell nor its ancestors participate in transition state. [Swup's options documentation](https://swup.js.org/options/) draws the same distinction between “the containers being replaced” and “the scope that receives animation state”; here the two are deliberately collapsed onto one boundary.

The shell itself is a product of this work. Theme toggle, locale switcher, and wallpaper controls used to be separate Astro components that were re-executed in bulk on every page change; they are now consolidated into a single persistent Solid component with exactly one instance across the whole session. Incoming HTML still carries complete site header data, but the router never replaces the existing `SiteChrome`. It reads one validated context block out of the already-parsed new document and updates only language, links, copy, and state such as `aria-current`. The navigation bar, wallpaper layers, timers, and global controls remain the same Solid instance throughout.

Animated objects need the same boundary treatment. Theme switching uses a View Transition on the root element, and it has to cover the whole document — a palette is site-wide by definition. Content switching uses a crossfade inside the page outlet. Early on the two shared a single transition, and the result was that changing the theme dragged the entire page into the content animation and exposed a frame of the old light palette on the way through. Splitting them into two unrelated animated objects is what removed that intermediate state for good. **What owns a visual effect is determined by the scope it acts on, not by the moment that triggers it.**

Script execution scope had to tighten as well. Swup's Scripts plugin re-executes scripts across the whole document by default, which breaks the premise that the shell is permanent. The current setup scopes it to `#swup`: page-specific interactive figures and enhancement scripts can run again, while the bootstrap scripts sitting next to the shell are never replaced.

## Persistent state and page state must be layered

With a persistent shell, the page lifecycle splits cleanly in two:

| Layer      | Typical state                                                                  | Lifetime                                  |
| ---------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| Site-level | Theme, wallpaper, navigation progress, mobile menu                             | Persists across pages                     |
| Page-level | Table of contents, image viewer, interactive figures, reveal, search instances | Released before a swap, rebuilt afterward |

The router emits one set of pre-swap, post-swap, and page-ready events. Page-level controllers no longer guess individually at when Astro, Solid, or a third-party library has finished; they clean up and initialize around the same boundaries.

The table of contents is the clearest example. Its links are rendered by the server, and the client only observes scroll position and updates `aria-current` in place. It no longer emits an empty shell for a TOC library to tear down and rebuild into a fresh DOM tree. Without JavaScript the table of contents is still complete; with JavaScript it merely gains section tracking and restoration across reloads.

First-frame state sits earlier still than hydration. A synchronous bootstrap script in `<head>` reads the persisted theme, font revision, scroll position, article section, and wallpaper state before paint, producing a single snapshot. Nanostores and Solid start from that snapshot instead of re-deriving one after hydration.

Scroll restoration is the detail most easily taken too far here. The browser's own `scrollRestoration` behaves well in most cases. Only for reloads and back/forward navigations does the site genuinely hold a more accurate position, and only there does it switch to `manual` and restore the position itself; every other navigation hands control back to `auto`, and page unload restores `auto` as well. The precondition for taking over a browser default is actually knowing more than the browser does. Otherwise the best implementation is not to take it over.

This produces a clear flow of data:

```text
persisted state
  ↓
pre-paint snapshot
  ↓
complete SSR structure
  ↓
client takes over and enhances
```

First frame, refresh, and client-side navigation stay consistent only when each stage takes over from the one before it, rather than constructing another version of the truth.

## Font readiness is a third lifecycle

After site-level and page-level were separated, one category of state still fit in neither: fonts. They do not travel with the page, and they do not fully belong to the shell either. They are asynchronous, cross-cutting, and **everything that measures text geometry is waiting on them.**

The persistent shell made this more conspicuous, not less. The site uses local variable fonts, with separate faces for body, display, code, and CJK, plus an extra batch of KaTeX glyphs for mathematics. If content swaps first and fonts arrive second, the visitor sees one layout composed in fallback fonts and then watches the whole thing shift. The old full-page transition could at least hide that shift inside an animation. Once only the content outlet is replaced and the surrounding shell holds perfectly still, reflowing body text becomes glaring.

### Deriving font requirements from the page's actual content

The obvious approach — wait for every font — means a short English-only article pays for the entire CJK library. The current implementation derives requirements from the document itself instead. It scans the target page's text and asks for the CJK family only when CJK characters actually appear; for italics only when there is an `em` or `i`; for the monospace family only when there is code; and for math glyphs only when there is a `.katex`, narrowing further by class names such as `mathcal`, `mathfrak`, `mathsf`, and `mathtt` rather than pulling down every KaTeX face.

More importantly, a requirement does not just name a family. It hands **the characters that actually appear on the page** to `document.fonts.load(descriptor, text)`, so the browser only has to guarantee that particular set of glyphs. For a CJK library running to thousands of characters, “the characters this page uses” and “the whole font” are not the same order of magnitude.

### Preparing the target page's fonts before the swap

The input to that derivation is `visit.to.document` — the new document Swup has already parsed but not yet put on screen. Font preparation hooks in ahead of `content:replace`: the glyphs the incoming page genuinely needs become ready, and only then does the swap run.

That ordering is the whole point of the design. Load after the swap and, however fast the load is, the visitor necessarily sees one incorrect layout first. Complete it before the swap and the layout is final from the first frame it exists. The persistent shell made “navigation does not reflow” true for the shell; font preparation extends the same guarantee to the article.

### A readiness state needs a failure terminal

Font loading has no guarantee of success. The network can fail, a font file can be missing, a visitor can be on a very slow connection. Readiness is therefore modeled as an explicit state machine: `cold` is a first cold start, `warm` means this font set has been ready before, `revealing` is the brief reveal on a first visit, `ready` is the normal terminal, and `degraded` is the failure terminal.

`degraded` matters more than the other four. After a timeout the answer is not to keep waiting but to declare “use the fallback fonts” and release every waiter immediately. The pre-paint script also arms a backstop timer, so even if the controller script never loads at all, the state on the root element still flips itself from `cold` to `degraded` once the timeout elapses. **A state that everything downstream is waiting on must be guaranteed to reach some terminal.**

### Fingerprinting “already ready” with a font revision

A first visit should get the reveal; a return visit should not, or every arrival replays the same fade. So “this font set has been ready before” is recorded in local storage.

But that record starts lying the moment it goes stale. After a font package upgrade the browser cache holds no such font, while local storage still claims readiness — so returning visitors skip the reveal and watch a real font swap instead. The fix is to give the record a fingerprint, hashed from the versions of every font dependency and baked into the build output. Upgrade a font package and the fingerprint changes, every visitor's old record is invalidated automatically, and stale keys are swept from storage on the way past.

The record is only ever an optimization. If storage is disabled or the write fails, the code merely loses one opportunity to skip a reveal; the font-loading contract itself is unaffected. **A cache may make a process faster, but it must never become a precondition for that process being correct.**

### Let downstream wait instead of guess

The table of contents measures section offsets. Plotly figures lay out against container dimensions. Code comparison panels compute monospace character widths. Reveal animations need correct geometry before they start. Every one of them depends on the final size of text.

Previously each of these waited with its own timeout or a few frames of delay — which is really just guessing when fonts might be done. They now `await` the same readiness promise: anything that measures text starts after it resolves. This is the same move as the overlay and controller work earlier. Implicit timing assumptions scattered across a codebase get collapsed into one explicit contract that can actually be waited on.

## What a flickering mouse cursor taught me about diagnosis

The most misleading problem in this whole effort was that clicking a persistent navigation link made the system's pointing-hand cursor flip briefly back to an arrow. I suspected full-page transitions, Swup's animation scope, HeadPlugin's style synchronization, Solid node updates, and focus migration in turn. Several of those were worth fixing on their own merits. None of them explained the very short pulse that remained.

Ordinary in-page testing consistently showed:

- `elementFromPoint()` hitting the same navigation link;
- the link's DOM instance unchanged;
- position and dimensions unchanged;
- `getComputedStyle(...).cursor` reporting `pointer` throughout.

The real Wayland `cursor-shape` protocol and a Chrome performance trace finally located the residue in the browser process: on the Linux/Wayland plus Chromium (Ozone/Aura backend) combination I tested, `history.replaceState()` and `history.pushState()` briefly enter a same-document loading state, during which the native UI layer commits the system cursor as the default arrow before restoring the pointer the page asked for. The whole window is roughly one to two milliseconds, usually falling between two `requestAnimationFrame` callbacks, so it never appears in DOM state and cannot be captured in a Playwright screenshot.

That conclusion drew two boundaries:

1. the persistent shell, container-scoped animation, and stable hit regions still have independent value — they eliminated the node replacement, full-page overlays, and repeated initialization the application was causing itself;
2. as long as client-side navigation must still update the URL and the back/forward record correctly, site code cannot promise the absence of a native cursor pulse on that platform combination. It is browser-process behavior, outside the page's jurisdiction.

Partway through the investigation, a plausible-sounding explanation attributed the problem to HeadPlugin and recommended persisting all stylesheets and deferring cleanup until navigation ended. A controlled experiment showed otherwise: keeping HeadPlugin, the content swap, and the animations fully intact while suppressing only the History API left the system cursor unchanged, and calling the History API alone reproduced it. The wrong fix would have missed the root cause and accumulated page-specific styles indefinitely.

That experience changed how the site is tested. Automated tests still guard DOM identity, hit regions, focus, and computed style; anything involving the system cursor or the compositor requires a headed browser, a native protocol, or a performance trace. **A passing test only proves the layer it actually observed. It is not a substitute for what the user sees.**

## Waiting is not disabling

Slow navigation needs feedback, but a waiting state must not casually break interaction along the way. The navigation controller records the destination when a visit starts and shows an indeterminate progress bar only past a short threshold; once shown, it guarantees a minimum visible duration before easing out. The bar sits on the edge of the navigation bar without changing its height, and the main content exposes its state through `aria-busy`.

Repeated clicks on the same destination are merged in logic, rather than by disabling the original link or replacing it with a loading node. Asynchronous wallpaper actions such as refresh and download follow the same rule: as long as the action still makes sense, the trigger keeps its original node and hit region. Controls become genuinely unavailable only when there is no next photograph, or scenic mode is already off.

This matters more than adding `cursor: pointer` globally. A cursor style can only describe “this is interactive.” It cannot compensate for a node being removed, a hit region being captured by an overlay, or a control being disabled by application code when it should not be.

## The search page tested every boundary at once

Once the shell was stable, Pagefind search turned out to be the best possible exercise for page-level lifecycles. It involves external component registration, asynchronous results, URL state, browser history, keyboard behavior, a no-JavaScript fallback, and restoration after a client-side round trip — all at the same time.

### Keep the search engine, rebuild the product layer

Pagefind continues to own indexing, ranking, tokenization, arrow-key handling, and accessibility announcements. The site only adds “page, article, project” type metadata for indexable pages and rebuilds result cards, excerpts, section matches, and the empty and loading states. The search page itself stays out of the index, while the homepage, project list, About page, articles, and project details remain within site-wide search.

An oversized hero heading, an explanation of the technology, and a keyboard tutorial were all deleted. Opening the search page now lands directly on the feature. Escape blurs the input without clearing the query; clearing belongs to the explicit clear button.

### The URL belongs to both the browser and the router

The first version updated the query with a plain `history.replaceState()`. The address bar did change to `?q=search`, but Swup's own `history.state.url` and current location still held the query-less address. Clicking a result and then going back made the router restore `/search/`, losing both the query and the results.

Query updates now go through Swup's history helper and synchronize its current location. Direct visits, client-side entry, returning after clicking a result, and browser back/forward all restore from the same URL. Restoration only fires after Pagefind's input and result components have finished registering, so the event cannot be emitted before the new components exist.

There was also a well-hidden HTML parsing difference here. A `<style>` inside `<noscript>` serves only the no-JavaScript state when a page is loaded directly, because the parser treats the element's contents as raw text while scripting is enabled. When Swup parses the returned HTML with `DOMParser`, scripting is disabled, so the same `<style>` can be treated as an ordinary style node — which hid the search interface for visitors who did have JavaScript. The no-JavaScript fallback now keeps its structure and copy, but no longer relies on inline styles whose meaning depends on which parser reads them.

### Result transitions need a buffer, not stacked translucent layers

Pagefind's Component UI clears the old list on every search, inserts skeletons, and then swaps in real results one at a time. Going from `gi` to `git`, the visitor does not see a natural update; they see the entire candidate list blink empty.

The current implementation takes over only the handoff from old results to new ones:

1. the existing results are cloned into a non-interactive front buffer;
2. the snapshot is marked `aria-hidden`, `inert`, and unclickable;
3. Pagefind generates the new list in the original results container;
4. once the skeletons in the viewport disappear, the new list is shown and the snapshot removed in the same frame.

That buffer did not work at all at first, and the reason was style ownership. The snapshot is a clone of the entire result list, so it carries Pagefind's `pf-results` class along with it — which is exactly what keeps it looking like the list. But Pagefind's own base styles apply a high-specificity `all: revert` to any element carrying a `pf-` prefixed class, wiping out the grid placement and opacity set on the snapshot. The snapshot fell out of its overlay position into normal document flow below the live results, so every keystroke looked like the list blanking. Only re-declaring those two properties with `!important` was strong enough to hold. **Reusing a third-party component's class names means inheriting its reset rules too**: either build the list appearance under your own class names, or be prepared to fight it on specificity.

Only once the snapshot actually overlaid correctly did the second defect surface: crossfading made the list read as dimming and brightening. Result cards use a translucent glass background that lets the scenic wallpaper through, and during a fade two translucent surfaces briefly overlap, so the proportion of wallpaper coming through differs from the resting state. No easing curve and no backdrop patched in behind it can change that. The crossfade was replaced with a synchronous swap: the snapshot is removed in the same frame the live results reappear, so exactly one translucent surface is ever on screen. The `transitionend` listener, the fallback removal timer, and the intermediate state class that existed only to coordinate the fade were all deleted with it.

Smooth does not mean animating everything. For compositing translucent layers, an atomic handoff is more stable than a transition — and it removes an entire machine built to coordinate that transition.

After a query is restored, two more asynchronous steps push the caret back to the start of the text: Pagefind reassigns the input's value after the site does, and Chromium adjusts the selection again when focusing a `type="search"` input. The fix reasserts the caret at the end of the restored query once on first focus and once more on the `selectionchange` that follows, leaving ordinary mid-text edits afterward untouched.

### Releasing the instance without losing the cache

Releasing the Pagefind instance when leaving the search page avoids accumulating stale component references, and returning creates a new one. But Pagefind's component library busts its own `pagefind-entry.json` fetch with a timestamp query parameter on every instance init, which means every return to the search page produces a URL the browser has never seen and cannot serve from cache.

The site now generates a stable `meta-cache-tag` for each build: every page in one deployment shares it, and it changes only on the next build. The now-versioned entry file can therefore use a long immutable cache, while the JavaScript modules, WASM, and actual index fragments continue to load through Pagefind's existing mechanisms. The principle is the same one behind hashed static assets: **make the URL express the content version first, and only then talk about long-lived caching.**

## Visual continuity has to be written as invariants

After this round of fixes, the tests no longer just check that the final page “looks right.” They check invariants that must hold during the transition:

- a persistent link remains the same DOM node during navigation, with unchanged position and hit region;
- no Swup animation class appears outside the page outlet;
- overlays never lose a visible trigger across navigation or breakpoint changes;
- the SSR table of contents is never rebuilt by the client, only its current section updated;
- the first frame after a refresh restores scroll, fonts, theme, and wallpaper state directly;
- body geometry is identical before and after a content swap, and fonts are never replaced after the swap completes;
- query, URL, results, and caret position all agree when returning to search;
- the old result list stays visible while results update, without producing a second set of focusable content;
- exactly one translucent result layer exists in any given frame.

Some invariants can only be verified in the right environment. The dimming and brightening in search results was located by sampling per-frame brightness and recording video, and it had to run against the real wallpaper-backed preview — the local static fallback grid cannot reproduce it at all, because the defect is precisely about what shows through a translucent layer. The cursor pulse likewise needed a headed browser and a native protocol as evidence. **Choose the wrong verification environment and even the strictest assertion is testing a different system.**

That is also why the CI job's time limit moved out to 30 minutes. Font preparation, a production build, and real-browser regressions are no longer a handful of lightweight assertions, and too tight a limit turns normal verification into a reported failure. Relaxing the timeout is not lowering the bar; it is letting a complete verification run long enough to reach a conclusion.

## Conclusion

Static generation and a long-running client are not in conflict, but the boundary between them has to be explicit:

- the server emits complete, readable structure;
- the pre-paint script restores only the state the first frame must know;
- the persistent shell owns cross-page state;
- the page outlet owns replaceable content;
- page-level controllers clean up and rebuild at swap boundaries;
- cross-cutting asynchronous readiness, such as fonts, has an explicit contract and a failure terminal it is guaranteed to reach;
- native browser behavior, DOM behavior, and user perception are each evidenced separately, and none substitutes for another.

What I first saw was a few flickers in a popover, a cursor, and a search list. What actually got fixed was state ownership across the entire website. A genuinely stable experience does not come from making animations faster. It comes from not manufacturing the intermediate states the user was never supposed to see.
