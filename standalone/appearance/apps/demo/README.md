# Appearance Lab: independent consumer

This demo imports only @sshawn9/appearance/theme,
@sshawn9/appearance/wallpaper and their public stylesheet exports. It has no
source alias, main-site import, production API, login or private credentials.
It belongs to the new standalone project; the existing website is not connected
to this package.

## Commands

Run from standalone/appearance, inside the project's functioning devenv:

    npm ci
    npm run build -w @sshawn9/appearance
    npm run check -w appearance-demo
    npm run build -w appearance-demo
    npm run dev -w appearance-demo

The development URL is http://127.0.0.1:4477. For the built demo:

    npm run preview -w appearance-demo -- --host 127.0.0.1 --port 4477

Stop only the server you started. The package must be built before Vite resolves
its public exports. All commands and dependencies are scoped to the standalone
subproject, not the existing repository root.

Browser tests use the default Playwright Chromium and Firefox:

    npx playwright install chromium firefox
    npx playwright test --config playwright.config.ts

The browser configuration refuses to reuse an existing service on its port.
APPEARANCE_PORT changes the port; APPEARANCE_DEMO_ROOT changes the demo working
directory for the clean tarball consumer check; APPEARANCE_RESULTS changes the
artifact output directory. The default is .results/browser.

## Real independent assets

- Three original geometric SVG landscapes are served as separate 1920×1080
  files in public/wallpapers. They were made specifically for this demo and
  are dedicated under CC0 1.0; see public/wallpapers/LICENSE.txt.
- Their visible attribution is paired with each image, and the downloaded SVG
  retains its title and descriptive attribution.
- The consumer declares @fontsource-variable/source-sans-3 version 5.3.0 as
  its own npm dependency. Vite resolves its Latin WOFF2 through the package
  name and emits a separate local resource; assetsInlineLimit is zero.
  No font binary, copied font-license file, or download script is committed.
  The first npm ci downloads normal package dependencies; the font package
  carries its license. The production appearance package contains no font
  dependency and receives font readiness from its host.
- The UI uses English to remain within this font's intended tested glyph set.
  No font bytes are embedded in HTML, JavaScript or a data URL.

AppearanceDemo is an actual FontFace instance. The demo waits for that
instance's load() promise, verifies status === "loaded", and registers that
same instance. document.fonts.ready, check() or an empty-match load() are
not accepted as proof. There is no timeout that treats failure as success.
Cold font failure leaves text gated; a later failed preparation retains the
already displayed image, attribution and previously loaded font.

## Manual examination

1. Open normal mode and use Light, Dark and System. Change the OS/browser color
   scheme while System is selected. Check headings, controls, reading text,
   palette chips and image credit at desktop and narrow/mobile widths.
2. Toggle wallpaper, select Next, enable automatic rotation, and Download.
   Confirm the filename and embedded SVG attribution belong to the displayed
   scene. The default rotation interval is 12 seconds.
3. Add image/font delays, then select Next repeatedly. The previous complete
   image and its credit must remain until both preparations succeed. While
   preparing another scene, Download must still return the current scene.
4. Select image-request, image-decode or font failure. Select Next; the old pair
   must remain, with an error. Return to Normal and retry.
5. During a delayed operation, select Cancel or Destroy, then wait beyond the
   delay. Late work must not reappear. Initialize again uses the same controller
   instance. Changing the rotation interval intentionally reconstructs it
   because the interval is a public construction option.
6. Destroy, write damaged cache, and reload. This writes genuinely invalid
   image blobs through the public IndexedDB adapter; it does not know private
   object-store names. A bounded fresh load should recover.
7. Refresh normally and repeatedly under light/dark themes, with populated
   cache. Inspect the complete navigation sequence, including initial loading,
   not only the final screen.
8. Use ?mode=theme-only to verify no wallpaper controller, view or cache starts.
   Use ?scenario=font-failure for a cold font failure. Query options also
   support imageDelay, fontDelay and rotationMs.

Use a fresh ?namespace=review-name to isolate a run. Storage keys and databases
are prefixed appearance-demo:v1; they do not use the main site's preferences.
The query scenarios, lifecycle log and window.__appearanceDemo harness are
defined only in demo code. They are not exported by the production package.
Scenarios that fail the source may need Destroy/Clear cache/Initialize to force
source access when an already prepared next image is available.

The Vite demo server returns real HTTP 503 responses at the two deliberately
missing image/font paths. A separate HTTP-200 text fixture exercises actual
image decoding failure. These local fixtures are demo middleware, not a
production API or a production-package test switch.

## Browser evidence and honest limits

The suite retains video, trace, desktop/mobile screenshots, and sequential PNGs
captured before refresh/transition is invoked. Every attempted sample is
recorded in a JSON manifest. Missing images, missing text, navigation context
errors and capture failures are not filtered out. PNG raster statistics are
computed from the actual screenshots, in addition to same-document DOM/font
invariants.

The manifest reports all missing-content frames and approximate missing-content
durations. Screenshot sampling is periodic, not a capture of every compositor
frame; DOM observations precede the associated screenshot and are not perfectly
synchronized. Initial cross-document loading can be visible and is reported as
a limitation, not relabeled as zero-flash. Same-document waiting/failure must
retain a complete existing pair. Final ready flags or CSS properties alone are
not accepted as refresh evidence.

Automated invariants do not replace a person's examination of the PNG sequences,
video, mobile layout and credit legibility. Automated tests, manual visual
review, clean npm-tarball consumption, and untested environments must be reported
separately.

Status at authoring: these browser tests have not been executed. The current
environment could not install a functioning Nix/devenv because /nix creation
requires unavailable elevation. Do not present static source preparation as a
successful build, browser run or actual-consumer acceptance check.
