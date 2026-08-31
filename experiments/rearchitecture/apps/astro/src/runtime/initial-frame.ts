import { FONT_TIMEOUT_MS, prepareDeclaredFonts } from './font-coordinator';
import { applyScrollSnapshot } from './scroll-state';
import { decodeSnapshot, LEDGER_KEY } from './state-ledger';

/**
 * Generates the only script allowed to delay the native document's first
 * render. The marker starts as a no-JavaScript fallback, is temporarily
 * removed while fonts prepare, then is restored after scroll state commits.
 */
export function createInitialFrameScript() {
  const decodeSource = decodeSnapshot.toString();
  const applyScrollSource = applyScrollSnapshot.toString();
  const prepareFontsSource = prepareDeclaredFonts.toString();

  return `(() => {
    const boundary = document.currentScript?.parentElement;
    if (!boundary) return;
    const releaseBoundary = () => {
      boundary.id = 'initial-frame-ready';
    };

    try {
      boundary.removeAttribute('id');

      const decodeSnapshot = ${decodeSource};
      const applyScrollSnapshot = ${applyScrollSource};
      const prepareDeclaredFonts = ${prepareFontsSource};
      const routeKey = location.pathname + location.search;
      const snapshot = decodeSnapshot(history.state, routeKey, ${JSON.stringify(LEDGER_KEY)});

      const fontPreparation = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve('timeout'), ${FONT_TIMEOUT_MS});
        prepareDeclaredFonts(document, document).then(
          (result) => {
            clearTimeout(timeout);
            resolve(result);
          },
          () => {
            clearTimeout(timeout);
            resolve('degraded');
          },
        );
      });
      const documentPreparation =
        snapshot?.page.y > 0 && document.readyState === 'loading'
          ? new Promise((resolve) =>
              document.addEventListener('DOMContentLoaded', resolve, { once: true }),
            )
          : Promise.resolve();

      Promise.all([fontPreparation, documentPreparation]).then(
        () => {
          try {
            if (snapshot) applyScrollSnapshot(snapshot);
          } finally {
            releaseBoundary();
          }
        },
        releaseBoundary,
      );
    } catch {
      releaseBoundary();
    }
  })();`;
}
