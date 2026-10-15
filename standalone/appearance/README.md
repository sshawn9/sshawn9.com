# Independent appearance experiment

主站尚未接入，本 PR 不改变现有网站运行行为。

This directory is a separate npm workspace outside the existing root's `apps/*` and `packages/*`. Its package, dependencies, lockfile, build output, demo, tests, ports and storage namespace are independent. Do not run dependency installation from the repository root for this experiment.

## Scope

- `packages/appearance`: framework-independent ESM package `@sshawn9/appearance`
- `apps/demo`: an actual package-name/public-export consumer with its own build
- `tests/unit`: deterministic lifecycle, cancellation and resource-gating tests
- `tests/browser`: Playwright's downloaded Chromium and Firefox, including refresh/frame evidence
- `scripts/consumer.mjs`: real tarball installation/build/browser verification outside the source repository

The package has no runtime dependencies or bundled font resources. The development workspace uses TypeScript and Playwright. The demo supplies its own font through its pinned Fontsource npm dependency and Vite's local asset output; no font binary or font-download script is committed. The first npm install downloads dependencies normally. No production API, login or private credential is needed.

## Environment and commands

Run all following commands from this directory. Use the repository's existing devenv configuration; do not alter the root package or devenv files. Modern devenv (2.2+) searches parent directories while preserving the command's working directory. For an interactive terminal, activate the repository's existing direnv environment first.

```sh
cd standalone/appearance
devenv shell -- npm ci
devenv shell -- npm exec -- playwright install chromium firefox
devenv shell -- npm run build
devenv shell -- npm run typecheck
devenv shell -- npm run test:unit
devenv shell -- npm run test:browser
devenv shell -- npm run test:consumer
devenv shell -- npm run dev
```

The default demo uses its dedicated port 4477. Playwright owns its preview server (`reuseExistingServer: false`) and stops it after each run. The clean consumer uses port 4487. Stop a manually started development server with Ctrl+C; do not stop unrelated site servers.

The package's build emits JavaScript, declarations and styles into `packages/appearance/dist`. To create an unpublished tarball:

```sh
mkdir -p .artifacts
devenv shell -- npm run pack
```

Build outputs, node_modules, tarballs and test reports are ignored. `npm run test:consumer` packs the actual package, creates a clean temporary consumer outside this repository, installs the tarball, typechecks and builds the copied demo, resolves public JavaScript and stylesheet exports, and runs the browser suite against that consumer. It never imports the package's private source paths or copies the main site. Its summary and screenshots remain under `.results`, outside the PR.

## Public API and host responsibilities

See [the package API guide](packages/appearance/README.md). Import theme and wallpaper independently; importing either module performs no system startup. Initialize explicitly and destroy explicitly. Theme-only use does not perform image/cache work.

The host supplies the wallpaper source and a strict attribution-font readiness callback. The provided browser adapters handle image fetching/decoding, paired DOM rendering, namespaced IndexedDB snapshots and downloads. A font timeout or error is a failed operation, not permission to use fallback text. Cache adapters must honor AbortSignal on writes. Attribution is committed with its decoded image, and the prior pair remains visible while the replacement is pending or fails.

CSS scope is explicit: `data-appearance-theme` on the chosen root enables the package's prefixed tokens and inherited colors; `.appearance-wallpaper*` affects only a dedicated wallpaper container. The demo intentionally initializes theme on its document root. There is no main-site layout, navigation, routing or font bootstrap in this package.

## Manual acceptance

1. Switch light, dark and system themes. Change the OS preference while using system mode. Reload and verify the chosen preference persists in the demo namespace.
2. Toggle wallpaper off and on. Advance repeatedly, download the committed image, toggle automatic rotation, destroy the controller and initialize it again.
3. Delay image loading, then advance. The prior image and attribution must remain paired. Repeat with attribution-font delay, font failure, image request failure and decode failure. Cancel a delayed operation and confirm its late completion cannot replace the displayed pair.
4. Corrupt the demo cache and reload. Recovery must terminate, show a valid pair or report a recoverable error, and avoid an unbounded retry loop.
5. Inspect desktop and mobile layouts in both themes. Test ordinary and consecutive reloads with the network panel and the full saved frame sequences. Do not discard initialization/blank frames from evidence.

The demo's fault controls are consumer/test code only. They are not hidden production-package options.

## Validation record and boundaries

Validation has not yet run. After the Nix installation blocker was disclosed, the user chose to proceed with a draft PR. This is an unvalidated implementation for review: devenv typecheck/build/unit/browser and clean-consumer verification remain required before calling it verified or ready to merge. See VALIDATION.md for the actual preparation work and remaining checks.

Automated state assertions and screenshots are complementary. Readiness flags or CSS variables alone do not prove that refresh frames were visually complete. Browser tests retain frame samples across the navigation boundary, including missing-content frames. Same-document replacement has a strict old-pair-preservation invariant; a new document has a separate initialization lifecycle and may contain initial loading frames, which must be reported rather than filtered.

Storage eviction, blocked IndexedDB, browser scheduling, network failures and operating-system download UI can vary. The package exposes recoverable errors and cancellation; it does not control browser navigation painting or promise a zero-blank-frame full reload. The source callback decides selection policy. Font success is a host contract tested by the demo's concrete loaded FontFace.

The experimental code is currently UNLICENSED pending the maintainer's licensing decision. No npm publication, website deployment or merge is part of this task.
