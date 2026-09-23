import { autoUpdate, computePosition, flip, hide, offset, shift, size } from '@floating-ui/dom';
import { rethrowAfterCleanup, runCleanups } from '../../../runtime/cleanup';
import type { BlogPageSizeView } from './blog-page-size-view';
import type { BlogPageSize } from './blog-state';

/** Temporary exploration never writes the committed value or the URL. */
export function createBlogPageSizeController(
  view: BlogPageSizeView,
  sourceWindow: Window,
  commit: (value: BlogPageSize) => void,
): { close(): void; destroy(): void } {
  const { trigger, popup } = view;
  const sourceDocument = trigger.ownerDocument;
  const listeners = new AbortController();
  const parent = popup.parentNode!;
  const sibling = popup.nextSibling;
  const nativePopover = typeof popup.showPopover === 'function';
  const popoverAttribute = popup.getAttribute('popover');
  let opened = false;
  let disposed = false;
  let activeIndex = -1;
  let generation = 0;
  let stopPositioning: (() => void) | undefined;
  let typed = '';
  let lastTypedAt = 0;

  function clearOpenState(): boolean {
    if (!opened) return false;
    opened = false;
    generation += 1;
    stopPositioning?.();
    stopPositioning = undefined;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    popup.hidden = true;
    popup.removeAttribute('data-positioned');
    for (const { element } of view.options) element.removeAttribute('data-active');
    activeIndex = -1;
    typed = '';
    return true;
  }

  function close(restoreFocus = false): void {
    if (!clearOpenState()) return;
    if (nativePopover && popup.matches(':popover-open')) popup.hidePopover();
    if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }

  function revealActiveOption(): void {
    const option = view.options[activeIndex]?.element;
    if (!option || !popup.hasAttribute('data-positioned')) return;
    const item = option.getBoundingClientRect();
    const menu = popup.getBoundingClientRect();
    // Scroll only the menu. scrollIntoView() can also move the article page.
    if (item.top < menu.top + 5) popup.scrollTop -= menu.top + 5 - item.top;
    else if (item.bottom > menu.bottom - 5) popup.scrollTop += item.bottom - menu.bottom + 5;
  }

  function highlight(index: number): void {
    activeIndex = Math.max(0, Math.min(view.options.length - 1, index));
    for (const [position, option] of view.options.entries()) {
      option.element.toggleAttribute('data-active', position === activeIndex);
    }
    const active = view.options[activeIndex];
    if (active) trigger.setAttribute('aria-activedescendant', active.element.id);
    revealActiveOption();
  }

  function open(): void {
    if (opened || disposed || trigger.disabled) return;
    const opening = ++generation;
    opened = true;
    popup.hidden = false;
    popup.style.maxHeight = '';
    popup.scrollTop = 0;
    trigger.setAttribute('aria-expanded', 'true');
    highlight(view.options.findIndex((option) => String(option.value) === trigger.value));
    trigger.focus({ preventScroll: true });

    try {
      if (nativePopover) {
        popup.showPopover();
        if (!popup.matches(':popover-open')) {
          close();
          return;
        }
      }
      const initialRect = trigger.getBoundingClientRect();
      const position = (): void => {
        if (!opened || generation !== opening) return;
        const rect = trigger.getBoundingClientRect();
        // Ordinary scrolling follows the anchor. Resizing or zoom cancels
        // exploration; position changes alone must not discard a new choice.
        if (
          (['width', 'height'] as const).some((key) => Math.abs(rect[key] - initialRect[key]) > 0.5)
        ) {
          close();
          return;
        }
        void computePosition(trigger, popup, {
          strategy: 'fixed',
          placement: 'bottom-end',
          middleware: [
            offset(6),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            size({
              padding: 8,
              apply({ availableHeight, availableWidth, rects, elements }) {
                if (!opened || generation !== opening) return;
                elements.floating.style.width = `${rects.reference.width}px`;
                elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
                elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
              },
            }),
            hide({ strategy: 'referenceHidden' }),
          ],
        })
          .then(({ x, y, middlewareData }) => {
            if (!opened || generation !== opening) return;
            if (middlewareData.hide?.referenceHidden) {
              close();
              return;
            }
            popup.style.left = `${x}px`;
            popup.style.top = `${y}px`;
            popup.setAttribute('data-positioned', '');
            revealActiveOption();
          })
          .catch((error) => {
            if (!opened || generation !== opening) return;
            close();
            sourceWindow.reportError(error);
          });
      };
      const stop = autoUpdate(trigger, popup, position);
      if (opened && generation === opening) stopPositioning = stop;
      else stop();
    } catch (error) {
      close();
      sourceWindow.reportError(error);
    }
  }

  function choose(index: number): void {
    const option = view.options[index];
    if (!opened || !option) return;
    close(true);
    // The displayed value may lag behind a queued refresh. Always confirm the
    // choice; the preference owner decides whether the saved value changed.
    commit(option.value);
  }

  function keyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Tab') {
      close();
      return;
    }
    if (event.key === 'Escape') {
      if (!opened) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (opened) choose(activeIndex);
      else open();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!opened) open();
      else highlight(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      open();
      highlight(event.key === 'Home' ? 0 : view.options.length - 1);
      return;
    }
    if (/^\d$/.test(event.key) && !event.altKey) {
      event.preventDefault();
      open();
      const now = sourceWindow.performance.now();
      typed = now - lastTypedAt < 700 ? typed + event.key : event.key;
      lastTypedAt = now;
      let index = view.options.findIndex((option) => String(option.value).startsWith(typed));
      if (index < 0) {
        typed = event.key;
        index = view.options.findIndex((option) => String(option.value).startsWith(typed));
      }
      if (index >= 0) highlight(index);
    }
  }

  const destroy = (): void => {
    if (disposed) return;
    disposed = true;
    runCleanups(
      () => close(),
      () => listeners.abort(),
      () => {
        trigger.disabled = true;
      },
      () => parent.insertBefore(popup, sibling?.parentNode === parent ? sibling : null),
      () => {
        if (popoverAttribute !== null) popup.setAttribute('popover', popoverAttribute);
      },
    );
  };

  try {
    // Keep the fallback clear of clipping/container boundaries as well as the
    // native top-layer case. Restore ownership before a page is destroyed.
    sourceDocument.body.append(popup);
    if (!nativePopover) popup.removeAttribute('popover');
    trigger.addEventListener(
      'click',
      (event) => {
        event.preventDefault(); // The controller owns the popovertarget activation.
        if (opened) close();
        else open();
      },
      { signal: listeners.signal },
    );
    trigger.addEventListener('keydown', keyDown, { signal: listeners.signal });
    popup.addEventListener(
      'mousedown',
      (event) => {
        if (event.button === 0) event.preventDefault();
      },
      { signal: listeners.signal },
    );
    popup.addEventListener(
      'click',
      (event) => {
        const index = view.options.findIndex(({ element }) =>
          element.contains(event.target as Node),
        );
        choose(index);
      },
      { signal: listeners.signal },
    );
    popup.addEventListener(
      'pointermove',
      (event) => {
        if (!opened || event.pointerType === 'touch') return;
        const index = view.options.findIndex(({ element }) =>
          element.contains(event.target as Node),
        );
        if (index >= 0 && index !== activeIndex) highlight(index);
      },
      { signal: listeners.signal },
    );
    sourceDocument.addEventListener(
      'pointerdown',
      (event) => {
        if (!trigger.contains(event.target as Node) && !popup.contains(event.target as Node))
          close();
      },
      { capture: true, signal: listeners.signal },
    );
    sourceDocument.addEventListener(
      'focusin',
      (event) => {
        if (!trigger.contains(event.target as Node) && !popup.contains(event.target as Node))
          close();
      },
      { signal: listeners.signal },
    );
    sourceDocument.addEventListener(
      'beforetoggle',
      (event) => {
        const state = (event as Event & { newState?: string }).newState;
        if (event.target === popup && state === 'closed') clearOpenState();
        else if (event.target !== popup && state === 'open') close();
      },
      { capture: true, signal: listeners.signal },
    );
    sourceDocument.addEventListener('astro:before-preparation', () => close(), {
      signal: listeners.signal,
    });
    sourceWindow.addEventListener('resize', () => close(), { signal: listeners.signal });
    sourceWindow.visualViewport?.addEventListener('resize', () => close(), {
      signal: listeners.signal,
    });
    return { close, destroy };
  } catch (error) {
    rethrowAfterCleanup(error, destroy);
  }
}
