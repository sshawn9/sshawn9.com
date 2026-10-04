# Validation status

Status: prepared for draft review without runtime validation. After the environment blocker was disclosed, the user instructed that a PR be created directly. Do not interpret the prepared test cases as executed or passing; no ordinary Node/browser run substitutes for the requested devenv verification.

## Environment preparation performed

- A fresh checkout of `sshawn9/sshawn9.com` was created at baseline `7d773c309f27280903e1e60d98d57f9a8483fb53`.
- `standalone/appearance` did not previously exist and is outside the root workspace globs.
- A dedicated branch `appearance/standalone-package-20261004` was created for this task's new files only.
- The demo supplies its own Source Sans 3 font through a pinned Fontsource npm dependency. No font binary, copied font-license resource, or font-download script is included in Git. The production package continues to accept a host font-readiness interface.
- `npm install --package-lock-only --ignore-scripts --workspaces` prepared this subproject's lockfile using the existing Node 24.19.0 / npm 11.9.0. This was dependency preparation, not devenv validation; no lifecycle scripts, compilation or tests ran.
- Before and after lockfile preparation, `git diff --quiet HEAD --` confirmed that all pre-existing tracked repository files, including the root lockfile and devenv configuration, remained unchanged.

## Verified environment blocker

The cloud desktop has neither Nix/devenv nor sudo/doas/Docker/Podman. Its `agent` user cannot write the root-owned `/` directory. After authorization, the official Nix 2.35.2 single-user installer downloaded successfully but failed while attempting to create `/nix`: `sudo: not found`. It requested that an administrator create `/nix` with the correct owner. No privilege workaround or substitute validation environment was used.

## Prepared, not executed

- Package TypeScript typecheck and distributable build
- Demo typecheck and production build
- Theme and wallpaper lifecycle unit tests
- Default Playwright Chromium and Firefox installation and browser suite
- Delayed/failed decode and font readiness, cancellation and late result checks
- Desktop/mobile visual inspection in both themes
- Complete ordinary/consecutive refresh frame and video evidence
- Cached current/next restoration and corrupted-cache recovery checks
- Actual npm tarball installation, build and browser execution in a clean temporary consumer
- Final add-only diff and artifact exclusion review before commit

Once a valid project devenv environment is available, run the exact commands in README, repair any failures without weakening the intended assertions, and replace this preparation record with the observed results. Capture the browser screenshots and refresh observations only from those real runs. Do not claim unobserved performance, visual stability or browser compatibility.
