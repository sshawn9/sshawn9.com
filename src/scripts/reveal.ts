import { animate } from 'motion/mini';
import { inView } from 'motion';
import { claimClientRuntime } from './client-runtime';
import { whenTypographyReady } from './typography-controller';

let stopObservers: Array<() => void> = [];
let setupRevision = 0;
let initialDocument = true;
const runtime = claimClientRuntime('reveal');

function cleanupReveal() {
  setupRevision += 1;
  stopObservers.forEach((stop) => stop());
  stopObservers = [];
}

async function setupReveal() {
  cleanupReveal();
  const revision = setupRevision;
  await whenTypographyReady();
  if (revision !== setupRevision) return;

  const navigation = performance.getEntriesByType('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  const restoresExistingDocument =
    initialDocument && (navigation?.type === 'reload' || navigation?.type === 'back_forward');
  initialDocument = false;
  if (restoresExistingDocument) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((element) => {
    const isBelowInitialViewport = element.getBoundingClientRect().top >= window.innerHeight;
    if (!isBelowInitialViewport) return;

    element.style.opacity = '0';
    element.style.transform = 'translateY(12px)';

    stopObservers.push(
      inView(
        element,
        () => {
          animate(
            element,
            { opacity: 1, transform: 'translateY(0)' },
            { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
          );
        },
        { amount: 0.15 },
      ),
    );
  });
}

runtime.listen(document, 'site:before-swap', () => {
  initialDocument = false;
  cleanupReveal();
});
runtime.listen(document, 'site:page-load', () => void setupReveal());
runtime.onDispose(cleanupReveal);
void setupReveal();
