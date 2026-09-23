import { formatUiCopy } from '@sshawn9/site-i18n/copy';
import { readBlogPageSize, type BlogPageSize } from './blog-state';

/** Displays the reading preference applied to the current listing, including its selected marker. */
export function createBlogPageSizeView(listing: HTMLElement) {
  const trigger = listing.querySelector<HTMLButtonElement>('[data-blog-page-size]');
  const popup = listing.querySelector<HTMLElement>('[data-blog-page-size-menu]');
  const valueCopy = trigger?.querySelector<HTMLElement>('[data-blog-page-size-value]');
  if (!trigger || !popup || !valueCopy) return undefined;

  const displayTemplate = trigger.dataset.pageSizeTemplate ?? '{count}';
  const options = [...popup.querySelectorAll<HTMLElement>('[data-blog-page-size-option]')].map(
    (element) => ({
      element,
      value: readBlogPageSize(element.dataset.value),
    }),
  );
  return {
    trigger,
    popup,
    options,
    render(value: BlogPageSize) {
      trigger.value = String(value);
      const label = formatUiCopy(displayTemplate, { count: value });
      if (valueCopy.textContent !== label) valueCopy.textContent = label;
      for (const option of options) {
        option.element.setAttribute('aria-selected', String(option.value === value));
      }
    },
  };
}

export type BlogPageSizeView = NonNullable<ReturnType<typeof createBlogPageSizeView>>;
