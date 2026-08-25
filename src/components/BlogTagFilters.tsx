import { Collapsible } from '@kobalte/core/collapsible';
import { ToggleGroup } from '@kobalte/core/toggle-group';
import { For } from 'solid-js';
import type { Locale } from '../i18n/config';
import * as m from '../paraglide/messages.js';

export type BlogTag = {
  name: string;
  slug: string;
  count: number;
};

type Props = {
  tags: BlogTag[];
  selectedTags: string[];
  locale: Locale;
  onChange: (values: string[]) => void;
};

export default function BlogTagFilters(props: Props) {
  return (
    <section data-blog-sidebar-section="article-tags">
      <Collapsible defaultOpen forceMount>
        <Collapsible.Trigger class="text-strong group flex w-full items-center justify-between gap-4 py-2 text-left text-sm font-bold lg:hidden">
          <span>{m.article_tags({}, { locale: props.locale })}</span>
          <span
            class="size-2.5 rotate-45 border-r-2 border-b-2 border-slate-400 transition-transform group-data-[expanded]:rotate-[225deg] dark:border-slate-500"
            aria-hidden="true"
          />
        </Collapsible.Trigger>

        <Collapsible.Content class="mt-2 data-[closed]:hidden lg:mt-0 lg:data-[closed]:block">
          <ToggleGroup
            multiple
            orientation="vertical"
            value={props.selectedTags}
            onChange={props.onChange}
            aria-label={m.article_tags({}, { locale: props.locale })}
            class="flex flex-col gap-1"
          >
            <For each={props.tags}>
              {(tag) => (
                <ToggleGroup.Item
                  value={tag.name}
                  data-tag-filter={tag.name}
                  data-tag-slug={tag.slug}
                  data-tag-count={tag.count}
                  class="filter-option grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-left text-sm"
                >
                  <span class="min-w-0 truncate">{tag.name}</span>
                  <span class="font-mono text-[0.68rem] opacity-65">{tag.count}</span>
                </ToggleGroup.Item>
              )}
            </For>
          </ToggleGroup>
        </Collapsible.Content>
      </Collapsible>
    </section>
  );
}
