import { animate } from 'motion/mini';
import { inView } from 'motion';
import { claimClientRuntime } from './client-runtime';

let stopObservers: Array<() => void> = [];
const runtime = claimClientRuntime('reveal');

function cleanupReveal() {
  stopObservers.forEach((stop) => stop());
  stopObservers = [];
}

function setupReveal() {
  cleanupReveal();

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

runtime.listen(document, 'astro:before-swap', cleanupReveal);
runtime.listen(document, 'astro:page-load', setupReveal);
runtime.onDispose(cleanupReveal);
