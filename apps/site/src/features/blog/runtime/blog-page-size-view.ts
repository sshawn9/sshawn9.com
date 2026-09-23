import { formatUiCopy } from '@sshawn9/site-i18n/copy';
import {
  BLOG_DISPLAY_MODES,
  readBlogDisplayMode,
  type BlogDisplayMode,
  type BlogPageSize,
} from './blog-state';

/** Keeps the menu's visible options and the displayed preference in the same mode. */
export function createBlogPageSizeView(listing: HTMLElement) {
  const trigger = listing.querySelector<HTMLButtonElement>('[data-blog-page-size]');
  const popup = listing.querySelector<HTMLElement>('[data-blog-page-size-menu]');
  const valueCopy = trigger?.querySelector<HTMLElement>('[data-blog-page-size-value]');
  if (!trigger || !popup || !valueCopy) return undefined;

  const displayTemplate = trigger.dataset.pageSizeTemplate ?? '{count}';
  const allowed = new Set<number>(
    Object.values(BLOG_DISPLAY_MODES).flatMap((config) => config.pageSizes),
  );
  const allOptions = [
    ...popup.querySelectorAll<HTMLElement>('[data-blog-page-size-option]'),
  ].flatMap((element) => {
    const value = Number(element.dataset.value);
    return allowed.has(value) ? [{ element, value: value as BlogPageSize }] : [];
  });
  let mode = readBlogDisplayMode(listing.dataset.blogDisplayMode);
  const optionsForMode = () =>
    allOptions.filter((option) =>
      BLOG_DISPLAY_MODES[mode].pageSizes.some((size) => size === option.value),
    );
  let options = optionsForMode();
  return {
    trigger,
    popup,
    get mode() {
      return mode;
    },
    get options() {
      return options;
    },
    render(value: BlogPageSize, nextMode: BlogDisplayMode) {
      mode = nextMode;
      options = optionsForMode();
      trigger.value = String(value);
      const label = formatUiCopy(displayTemplate, { count: value });
      if (valueCopy.textContent !== label) valueCopy.textContent = label;
      for (const option of allOptions) {
        option.element.hidden = !options.includes(option);
        option.element.setAttribute('aria-selected', String(option.value === value));
      }
    },
  };
}

export type BlogPageSizeView = NonNullable<ReturnType<typeof createBlogPageSizeView>>;
