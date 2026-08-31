import { For, Show } from 'solid-js';
import type {
  VersionComparisonLabels,
  VersionComparisonMode,
  VersionComparisonVersion,
} from '../../../content/version-comparison';

type Props = {
  variant: 'desktop' | 'mobile';
  versions: VersionComparisonVersion[];
  base: VersionComparisonVersion;
  comparison: VersionComparisonVersion;
  displayMode: VersionComparisonMode;
  labels: VersionComparisonLabels;
  comparisonHref: (version: number) => string;
  selectDisplayMode: (mode: VersionComparisonMode) => void;
};

export default function VersionComparisonControls(props: Props) {
  const displayModeHeading = `version-comparison-display-${props.variant}`;
  const versionHeading = `version-comparison-versions-${props.variant}`;

  return (
    <>
      <section aria-labelledby={displayModeHeading}>
        <h2 id={displayModeHeading} class="version-comparison-control-heading">
          {props.labels.displayMode}
        </h2>
        <div
          class="version-comparison-mode-options"
          role="group"
          aria-label={props.labels.displayMode}
        >
          <button
            type="button"
            data-diff-mode="unified"
            aria-pressed={props.displayMode === 'unified'}
            onClick={() => props.selectDisplayMode('unified')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M8 6h12M8 12h12M8 18h12" />
              <path d="M4 6h.01M4 12h.01M4 18h.01" />
            </svg>
            {props.labels.unified}
          </button>
          <button
            type="button"
            data-diff-mode="split"
            aria-pressed={props.displayMode === 'split'}
            onClick={() => props.selectDisplayMode('split')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <rect x="3" y="4" width="7" height="16" rx="1" />
              <rect x="14" y="4" width="7" height="16" rx="1" />
            </svg>
            {props.labels.split}
          </button>
        </div>
      </section>

      <section class="version-comparison-version-controls" aria-labelledby={versionHeading}>
        <h2 id={versionHeading} class="version-comparison-control-heading">
          {props.labels.compareHeading}
        </h2>
        <p>{props.labels.baseLabelTemplate.replace('{version}', String(props.base.number))}</p>

        <details>
          <summary>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M8 3 4 7l4 4" />
              <path d="M4 7h12a4 4 0 0 1 4 4" />
              <path d="m16 21 4-4-4-4" />
              <path d="M20 17H8a4 4 0 0 1-4-4" />
            </svg>
            {props.labels.chooseOther}
            <span aria-hidden="true">⌄</span>
          </summary>
          <ol aria-label={props.labels.chooseOther}>
            <For each={props.versions}>
              {(version) => (
                <li>
                  <Show
                    when={version.number !== props.base.number}
                    fallback={
                      <span class="version-comparison-disabled" aria-disabled="true">
                        <strong>v{version.number}</strong>
                        <time dateTime={version.dateTime}>{version.dateLabel}</time>
                      </span>
                    }
                  >
                    <a
                      href={props.comparisonHref(version.number)}
                      aria-current={version.number === props.comparison.number ? 'page' : undefined}
                    >
                      <strong>v{version.number}</strong>
                      <time dateTime={version.dateTime}>{version.dateLabel}</time>
                    </a>
                  </Show>
                </li>
              )}
            </For>
          </ol>
        </details>
      </section>
    </>
  );
}
