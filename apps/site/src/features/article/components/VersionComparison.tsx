import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import 'diff2html/bundles/css/diff2html.min.css';
import {
  getAutomaticVersionComparisonMode,
  resolveVersionComparisonSelection,
  type VersionComparisonLabels,
  type VersionComparisonMode,
  type VersionComparisonVersion,
} from '../../../content/version-comparison';
import VersionComparisonControls from './VersionComparisonControls';

type VersionSource = { body: string };

type DiffRenderer = (
  patch: string,
  options: {
    drawFileList: boolean;
    outputFormat: 'line-by-line' | 'side-by-side';
    matching: 'words';
    diffStyle: 'word';
    renderNothingWhenEmpty: boolean;
  },
) => string;

type Props = {
  articleTitle: string;
  versions: VersionComparisonVersion[];
  labels: VersionComparisonLabels;
  comparePageHref: string;
};

export default function VersionComparison(props: Props) {
  const [selection, setSelection] = createSignal(resolveVersionComparisonSelection(props.versions));
  const [automaticMode, setAutomaticMode] = createSignal<VersionComparisonMode>('unified');
  const [manualMode, setManualMode] = createSignal<VersionComparisonMode>();
  const [enhanced, setEnhanced] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [sourcesAreIdentical, setSourcesAreIdentical] = createSignal(false);
  const [patch, setPatch] = createSignal('');
  const [renderPatch, setRenderPatch] = createSignal<DiffRenderer>();
  let mainElement: HTMLElement | undefined;

  const displayMode = createMemo(() => manualMode() ?? automaticMode());
  const renderedDiff = createMemo(() => {
    const renderer = renderPatch();
    const currentPatch = patch();
    if (!renderer || !currentPatch) return '';

    return renderer(currentPatch, {
      drawFileList: false,
      outputFormat: displayMode() === 'split' ? 'side-by-side' : 'line-by-line',
      matching: 'words',
      diffStyle: 'word',
      renderNothingWhenEmpty: true,
    });
  });

  const comparisonHref = (versionNumber: number): string => {
    const parameters = new URLSearchParams({
      base: String(selection().base.number),
      compare: String(versionNumber),
    });
    return `${props.comparePageHref}?${parameters}`;
  };

  async function loadComparison(signal: AbortSignal): Promise<void> {
    setLoading(true);
    setFailed(false);

    try {
      const [from, to] = selection().orderedPair;
      const [fromResponse, toResponse, diffModule, diff2HtmlModule] = await Promise.all([
        fetch(from.sourceHref, { signal }),
        fetch(to.sourceHref, { signal }),
        import('diff'),
        import('diff2html'),
      ]);
      if (!fromResponse.ok || !toResponse.ok) throw new Error(props.labels.error);

      const [fromSource, toSource] = (await Promise.all([
        fromResponse.json(),
        toResponse.json(),
      ])) as [VersionSource, VersionSource];
      if (signal.aborted) return;

      const identical = fromSource.body === toSource.body;
      setSourcesAreIdentical(identical);
      setPatch(
        identical
          ? ''
          : diffModule.createTwoFilesPatch(
              `v${from.number}.md`,
              `v${to.number}.md`,
              fromSource.body,
              toSource.body,
              undefined,
              undefined,
              { context: 3 },
            ),
      );
      setRenderPatch(() => diff2HtmlModule.html as DiffRenderer);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setFailed(true);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }

  onMount(() => {
    const abortController = new AbortController();
    setSelection(
      resolveVersionComparisonSelection(
        props.versions,
        new URLSearchParams(window.location.search),
      ),
    );
    setEnhanced(true);

    const updateAutomaticMode = () => {
      if (!mainElement) return;
      setAutomaticMode(
        getAutomaticVersionComparisonMode(mainElement.getBoundingClientRect().width),
      );
    };
    updateAutomaticMode();
    const resizeObserver = new ResizeObserver(updateAutomaticMode);
    if (mainElement) resizeObserver.observe(mainElement);
    void loadComparison(abortController.signal);

    onCleanup(() => {
      abortController.abort();
      resizeObserver.disconnect();
    });
  });

  return (
    <div class="version-comparison" data-version-comparison>
      <div class="version-comparison-grid">
        <main
          ref={(element) => {
            mainElement = element;
          }}
          data-version-comparison-main
        >
          <header class="version-comparison-header">
            <p class="version-comparison-eyebrow">{props.labels.eyebrow}</p>
            <h1>{props.articleTitle}</h1>

            <div class="version-comparison-pair" aria-label={props.labels.compareHeading}>
              <For each={selection().orderedPair}>
                {(version, index) => (
                  <>
                    <Show when={index() > 0}>
                      <span aria-hidden="true">→</span>
                    </Show>
                    <a href={version.href}>
                      <strong>v{version.number}</strong>
                      <time dateTime={version.dateTime}>{version.dateLabel}</time>
                    </a>
                  </>
                )}
              </For>
            </div>
          </header>

          <div class="version-comparison-mobile-controls">
            <VersionComparisonControls
              variant="mobile"
              versions={props.versions}
              base={selection().base}
              comparison={selection().comparison}
              displayMode={displayMode()}
              labels={props.labels}
              comparisonHref={comparisonHref}
              selectDisplayMode={setManualMode}
            />
          </div>

          <div class="version-comparison-legend" aria-hidden="true">
            <span>
              <strong>−</strong>
              {props.labels.removed}
            </span>
            <span>
              <strong>+</strong>
              {props.labels.added}
            </span>
          </div>

          <div class="version-comparison-result" aria-live="polite">
            <Show
              when={enhanced()}
              fallback={
                <p class="version-comparison-static-fallback">{props.labels.staticFallback}</p>
              }
            >
              <Show
                when={!loading()}
                fallback={<p class="version-comparison-status">{props.labels.loading}</p>}
              >
                <Show
                  when={!failed()}
                  fallback={
                    <p class="version-comparison-status" data-diff-error>
                      {props.labels.error}
                    </p>
                  }
                >
                  <Show
                    when={!sourcesAreIdentical()}
                    fallback={<p class="version-comparison-status">{props.labels.noChanges}</p>}
                  >
                    <Show when={renderedDiff()}>
                      <div
                        class="version-diff-panel"
                        data-diff-panel={displayMode()}
                        innerHTML={renderedDiff()}
                      />
                    </Show>
                  </Show>
                </Show>
              </Show>
            </Show>
          </div>
        </main>

        <aside aria-label={props.labels.compareHeading}>
          <div class="version-comparison-sidebar-scroll">
            <VersionComparisonControls
              variant="desktop"
              versions={props.versions}
              base={selection().base}
              comparison={selection().comparison}
              displayMode={displayMode()}
              labels={props.labels}
              comparisonHref={comparisonHref}
              selectDisplayMode={setManualMode}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
