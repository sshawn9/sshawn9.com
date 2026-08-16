import { Columns2, GitCompareArrows, List } from 'lucide-solid';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { createTwoFilesPatch } from 'diff';
import { html } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';

export type ComparisonVersion = {
  number: number;
  dateTime: string;
  dateLabel: string;
  href: string;
  sourceHref: string;
};

export type ComparisonLabels = {
  eyebrow: string;
  displayMode: string;
  unified: string;
  split: string;
  compareHeading: string;
  chooseOther: string;
  baseBefore: string;
  baseAfter: string;
  removed: string;
  added: string;
  noChanges: string;
  loading: string;
  error: string;
};

type Props = {
  articleTitle: string;
  versions: ComparisonVersion[];
  labels: ComparisonLabels;
};

type Source = { body: string };
type DisplayMode = 'unified' | 'split';

function readVersionParameter(name: string, versions: ComparisonVersion[], fallback: number) {
  if (typeof window === 'undefined') return fallback;
  const value = Number.parseInt(new URLSearchParams(window.location.search).get(name) ?? '', 10);
  return versions.some((version) => version.number === value) ? value : fallback;
}

export default function VersionComparison(props: Props) {
  const latest = props.versions[0];
  const firstAlternative = props.versions.find((version) => version.number !== latest.number);
  const initialBase = readVersionParameter('base', props.versions, latest.number);
  const requestedComparison = readVersionParameter(
    'compare',
    props.versions,
    firstAlternative?.number ?? latest.number,
  );
  const initialComparison =
    requestedComparison === initialBase
      ? (props.versions.find((version) => version.number !== initialBase)?.number ?? initialBase)
      : requestedComparison;

  const [displayMode, setDisplayMode] = createSignal<DisplayMode>('unified');
  const versionByNumber = (number: number) =>
    props.versions.find((version) => version.number === number) ?? latest;
  const base = versionByNumber(initialBase);
  const comparison = versionByNumber(initialComparison);
  const orderedPair = [base, comparison].toSorted((left, right) => left.number - right.number);

  const [sources] = createResource(async () => {
    const [from, to] = orderedPair;
    const responses = await Promise.all([fetch(from.sourceHref), fetch(to.sourceHref)]);
    if (responses.some((response) => !response.ok)) throw new Error(props.labels.error);
    const [fromSource, toSource] = (await Promise.all(
      responses.map((response) => response.json()),
    )) as [Source, Source];
    return { from, to, fromSource, toSource };
  });

  const renderedDiff = createMemo(() => {
    const value = sources();
    if (!value || value.fromSource.body === value.toSource.body) return '';
    const patch = createTwoFilesPatch(
      `v${value.from.number}.md`,
      `v${value.to.number}.md`,
      value.fromSource.body,
      value.toSource.body,
      undefined,
      undefined,
      { context: 3 },
    );
    return html(patch, {
      drawFileList: false,
      outputFormat: displayMode() === 'split' ? 'side-by-side' : 'line-by-line',
      matching: 'words',
      diffStyle: 'word',
      renderNothingWhenEmpty: true,
    });
  });

  const comparisonHref = (number: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set('base', String(base.number));
    url.searchParams.set('compare', String(number));
    return `${url.pathname}${url.search}`;
  };

  const Controls = (controlsProps: { variant: 'mobile' | 'desktop' }) => (
    <div>
      <section aria-labelledby={`diff-view-heading-${controlsProps.variant}`}>
        <h2 id={`diff-view-heading-${controlsProps.variant}`} class="sidebar-heading">
          {props.labels.displayMode}
        </h2>
        <div
          class="mt-3 grid grid-cols-2 rounded-xl bg-slate-900/[0.045] p-1 dark:bg-white/[0.055]"
          role="group"
          aria-label={props.labels.displayMode}
        >
          <button
            type="button"
            data-diff-mode="unified"
            aria-pressed={displayMode() === 'unified'}
            onClick={() => setDisplayMode('unified')}
            class="segmented-option inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold"
          >
            <List class="size-3.5" aria-hidden="true" />
            {props.labels.unified}
          </button>
          <button
            type="button"
            data-diff-mode="split"
            aria-pressed={displayMode() === 'split'}
            onClick={() => setDisplayMode('split')}
            class="segmented-option inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold"
          >
            <Columns2 class="size-3.5" aria-hidden="true" />
            {props.labels.split}
          </button>
        </div>
      </section>

      <section class="mt-7 border-t border-slate-900/10 pt-6 dark:border-white/10">
        <h2 class="sidebar-heading">{props.labels.compareHeading}</h2>
        <p class="text-supporting mt-3 text-xs leading-5">
          {props.labels.baseBefore}
          <strong class="text-strong">v{base.number}</strong>
          {props.labels.baseAfter}
        </p>

        <details class="group mt-2">
          <summary class="interactive-supporting flex min-h-9 cursor-pointer list-none items-center gap-2 text-xs font-bold">
            <GitCompareArrows class="size-4" aria-hidden="true" />
            {props.labels.chooseOther}
            <span
              class="ml-auto size-2.5 rotate-45 border-r-2 border-b-2 border-current transition-transform group-open:rotate-[225deg]"
              aria-hidden="true"
            />
          </summary>
          <ol class="mt-2 grid gap-0.5" aria-label={props.labels.chooseOther}>
            <For each={props.versions}>
              {(version) => {
                const isBase = version.number === base.number;
                const isCompared = version.number === comparison.number;
                return (
                  <li>
                    <Show
                      when={!isBase}
                      fallback={
                        <span
                          class="text-disabled flex min-h-9 cursor-not-allowed items-center gap-3 rounded-lg px-2 text-xs"
                          aria-disabled="true"
                        >
                          <span class="font-bold">v{version.number}</span>
                          <time class="ml-auto font-mono text-[0.6rem] font-normal">
                            {version.dateLabel}
                          </time>
                        </span>
                      }
                    >
                      <a
                        href={comparisonHref(version.number)}
                        aria-current={isCompared ? 'page' : undefined}
                        class="version-option flex min-h-9 items-center gap-3 rounded-lg px-2 text-xs"
                      >
                        <span>v{version.number}</span>
                        <time
                          class="text-supporting ml-auto font-mono text-[0.6rem] font-normal"
                          dateTime={version.dateTime}
                        >
                          {version.dateLabel}
                        </time>
                      </a>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ol>
        </details>
      </section>
    </div>
  );

  return (
    <div
      class="grid gap-12 lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-start"
      data-version-comparison
    >
      <main class="min-w-0">
        <header>
          <p class="text-supporting font-mono text-[0.68rem] font-bold tracking-[0.14em]">
            {props.labels.eyebrow}
          </p>
          <h1 class="mt-4 text-4xl font-extrabold tracking-[-0.045em] text-balance sm:text-5xl">
            {props.articleTitle}
          </h1>

          <div class="mt-7 flex flex-wrap items-stretch gap-x-4 gap-y-3 border-y border-slate-900/10 py-4 dark:border-white/10">
            <For each={orderedPair}>
              {(version, index) => (
                <>
                  <Show when={index() > 0}>
                    <span class="text-supporting self-center" aria-hidden="true">
                      →
                    </span>
                  </Show>
                  <a
                    class="interactive-heading group min-w-36 flex-1 text-sm last:text-right"
                    href={version.href}
                  >
                    <span class="font-extrabold">v{version.number}</span>
                    <time
                      class="text-supporting mt-1 block font-mono text-[0.65rem] group-hover:text-current"
                      dateTime={version.dateTime}
                    >
                      {version.dateLabel}
                    </time>
                  </a>
                </>
              )}
            </For>
          </div>
        </header>

        <div class="mt-7 rounded-2xl border border-slate-900/10 bg-slate-900/[0.025] p-4 lg:hidden dark:border-white/10 dark:bg-white/[0.025]">
          <Controls variant="mobile" />
        </div>

        <div class="text-supporting mt-8 flex flex-wrap items-center gap-4 text-xs">
          <span class="inline-flex items-center gap-1.5">
            <span class="text-danger font-mono font-bold" aria-hidden="true">
              −
            </span>
            {props.labels.removed}
          </span>
          <span class="inline-flex items-center gap-1.5">
            <span class="text-success font-mono font-bold" aria-hidden="true">
              +
            </span>
            {props.labels.added}
          </span>
        </div>

        <div class="mt-4" aria-live="polite">
          <Show
            when={!sources.loading}
            fallback={<p class="py-8 text-sm">{props.labels.loading}</p>}
          >
            <Show
              when={!sources.error}
              fallback={<p class="text-danger py-8 text-sm">{props.labels.error}</p>}
            >
              <Show
                when={renderedDiff()}
                fallback={
                  <p class="text-default rounded-2xl border border-slate-900/10 p-6 text-sm dark:border-white/10">
                    {props.labels.noChanges}
                  </p>
                }
              >
                <div
                  class="version-diff-panel overflow-x-auto"
                  data-diff-panel={displayMode()}
                  innerHTML={renderedDiff()}
                />
              </Show>
            </Show>
          </Show>
        </div>
      </main>

      <aside class="hidden min-w-0 self-stretch lg:block" aria-label={props.labels.compareHeading}>
        <div class="article-sidebar-scroll sticky top-[8.75rem] max-h-[calc(100dvh-9.75rem)] overflow-y-auto overscroll-contain pr-2 pb-2">
          <Controls variant="desktop" />
        </div>
      </aside>
    </div>
  );
}
