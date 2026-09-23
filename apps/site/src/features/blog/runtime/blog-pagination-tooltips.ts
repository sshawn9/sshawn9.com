/** CSS owns visibility and placement; Escape dismisses until hover and focus leave. */
export function bindBlogPaginationTooltips(
  listing: HTMLElement,
  sourceWindow: Window,
  signal: AbortSignal,
): void {
  const links = [...listing.querySelectorAll<HTMLElement>('[data-blog-page]')];
  if (!links.length) return;

  for (const link of links) {
    const reset = () => {
      if (!link.matches(':hover, :focus-visible')) {
        link.removeAttribute('data-tooltip-dismissed');
      }
    };
    link.addEventListener('pointerleave', reset, { signal });
    link.addEventListener('blur', reset, { signal });
  }
  sourceWindow.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      for (const link of links) {
        if (link.matches(':hover, :focus-visible')) link.setAttribute('data-tooltip-dismissed', '');
      }
    },
    { signal },
  );
}
