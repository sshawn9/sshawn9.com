import { onCleanup, onMount, type JSX } from 'solid-js';
import type { Locale } from '../i18n/config';
import { BLOG_SIDEBAR_LAYOUT } from '../lib/site-preferences';
import * as m from '../paraglide/messages.js';
import { createSidebarLayoutController } from '../scripts/sidebar-layout-controller';

type Props = {
  locale: Locale;
  sidebar: JSX.Element;
  children: JSX.Element;
};

const SIDEBAR_ID = 'blog-sidebar';
const SIDEBAR_TITLE_ID = 'blog-sidebar-title';
const TAG_LIST_GUTTER = 16;
const DEFAULT_WIDTH = BLOG_SIDEBAR_LAYOUT.defaultWidth;
const MIN_WIDTH = BLOG_SIDEBAR_LAYOUT.minWidth;
const MAX_WIDTH = BLOG_SIDEBAR_LAYOUT.maxWidth;

function SidebarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="size-[1.125rem]"
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path data-blog-sidebar-collapse-icon d="m16 15-3-3 3-3" />
      <path data-blog-sidebar-expand-icon d="m14 9 3 3-3 3" />
    </svg>
  );
}

export default function BlogSidebarLayout(props: Props) {
  let layoutElement!: HTMLDivElement;
  const collapseLabel = m.blog_sidebar_collapse({}, { locale: props.locale });
  const expandLabel = m.blog_sidebar_expand({}, { locale: props.locale });

  onMount(() => {
    const controller = createSidebarLayoutController('blog', layoutElement);
    onCleanup(() => controller?.destroy());
  });

  return (
    <div
      ref={layoutElement}
      data-sidebar-layout
      data-blog-sidebar-layout
      class="grid gap-y-10 lg:grid-cols-[var(--blog-sidebar-track)_2.5rem_minmax(0,1fr)] lg:items-start lg:gap-y-0"
      style={{
        '--blog-sidebar-width': `var(--blog-sidebar-current-width, var(--blog-sidebar-boot-width, ${DEFAULT_WIDTH}px))`,
        '--blog-sidebar-track':
          'var(--blog-sidebar-current-track, var(--blog-sidebar-boot-track, var(--blog-sidebar-width)))',
        '--blog-sidebar-content-gutter': `${TAG_LIST_GUTTER}px`,
        '--blog-sidebar-top': 'calc(var(--site-header-sticky-offset) + 2.25rem)',
        '--blog-sidebar-bottom-gap': '2rem',
      }}
    >
      <div
        data-sidebar-shell
        data-blog-sidebar-shell
        class="contents lg:sticky lg:top-[var(--blog-sidebar-top)] lg:col-span-2 lg:col-start-1 lg:row-start-1 lg:grid lg:grid-cols-[var(--blog-sidebar-track)_2.5rem] lg:self-start"
      >
        <div class="pointer-events-none absolute top-0 left-0 z-20 hidden w-10 lg:block">
          <button
            type="button"
            data-sidebar-toggle
            data-blog-sidebar-collapse
            data-collapse-label={collapseLabel}
            data-expand-label={expandLabel}
            aria-label={collapseLabel}
            aria-controls={SIDEBAR_ID}
            aria-expanded="true"
            class="text-supporting hover:text-strong focus-visible:text-strong pointer-events-auto inline-flex size-8 items-center justify-center rounded-md transition-colors"
          >
            <SidebarIcon />
          </button>
        </div>

        <div data-blog-sidebar-viewport class="contents min-w-0 lg:block lg:overflow-clip">
          <aside
            id={SIDEBAR_ID}
            data-sidebar-panel
            aria-labelledby={SIDEBAR_TITLE_ID}
            class="min-w-0 lg:w-full"
          >
            <div class="w-full lg:flex lg:w-[var(--blog-sidebar-width)] lg:max-h-[min(75dvh,calc(100dvh-var(--blog-sidebar-top)-var(--blog-sidebar-bottom-gap)))] lg:flex-col">
              <header class="mb-4 hidden h-8 shrink-0 items-center pl-10 lg:flex">
                <h2
                  id={SIDEBAR_TITLE_ID}
                  class="text-strong text-base font-extrabold tracking-tight"
                >
                  {m.article_tags({}, { locale: props.locale })}
                </h2>
              </header>

              <div
                data-tag-filter-panel
                data-scroll-restoration-key="blog-sidebar-tags"
                class="blog-sidebar-scrollbar lg:mr-[var(--blog-sidebar-content-gutter)] lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-2 [scrollbar-gutter:stable]"
              >
                {props.sidebar}
              </div>
            </div>
          </aside>
        </div>

        <div data-blog-sidebar-rail class="relative hidden self-stretch lg:block">
          <div
            role="separator"
            aria-label={m.blog_sidebar_resize({}, { locale: props.locale })}
            aria-controls={SIDEBAR_ID}
            aria-orientation="vertical"
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={MAX_WIDTH}
            aria-valuenow={DEFAULT_WIDTH}
            tabIndex={0}
            data-sidebar-resizer
            data-blog-sidebar-resizer
            class="group absolute inset-y-0 -left-1.5 z-10 w-3 touch-none cursor-col-resize select-none focus-visible:outline-none"
          >
            <span
              aria-hidden="true"
              data-blog-sidebar-boundary
              class="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--line)] transition-colors group-focus-visible:bg-[color-mix(in_srgb,var(--text-supporting)_34%,transparent)] group-data-[dragging]:bg-[color-mix(in_srgb,var(--text-supporting)_34%,transparent)]"
            />
          </div>
        </div>
      </div>

      <div class="min-w-0 lg:col-start-3 lg:row-start-1">{props.children}</div>
    </div>
  );
}
