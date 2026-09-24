export const INITIAL_FRAME_READY_ID = 'initial-frame-ready';
export const INITIAL_FRAME_READY_SELECTOR = `#${INITIAL_FRAME_READY_ID}`;
export const INITIAL_SCROLL_RESTORATION_ATTRIBUTE = 'data-initial-scroll-restoration';

/**
 * Keeps automatic fragment handling from animating after state restoration.
 * The normal smooth-scroll policy resumes immediately before the first user
 * interaction, so user-initiated anchors retain their existing behavior.
 */
export function armInitialScrollRestoration(sourceDocument: Document): void {
  // Keep this literal inside the serialized function; the generated head
  // script cannot close over module constants.
  const attribute = 'data-initial-scroll-restoration';
  const events = ['pointerdown', 'keydown', 'click'] as const;
  const root = sourceDocument.documentElement;
  root.setAttribute(attribute, '');

  const release = (): void => {
    root.removeAttribute(attribute);
    for (const eventName of events) {
      sourceDocument.removeEventListener(eventName, release, true);
    }
  };
  for (const eventName of events) {
    sourceDocument.addEventListener(eventName, release, { capture: true, once: true });
  }
}

/**
 * Keeps Astro ClientRouter's existing history coordinates aligned with placement.
 * Startup restoration and same-position fragment commits may not emit scroll
 * events, so Astro cannot correct stale coordinates through its scroll listener.
 */
export function synchronizeClientRouterScrollState(
  sourceHistory: History,
  point: { x: number; y: number },
): void {
  try {
    const state = sourceHistory.state;
    if (typeof state !== 'object' || state === null || Array.isArray(state)) return;
    if (!Number.isFinite(state.scrollX) || !Number.isFinite(state.scrollY)) return;
    sourceHistory.replaceState({ ...state, scrollX: point.x, scrollY: point.y }, '');
  } catch {}
}
