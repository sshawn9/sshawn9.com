import { Switch } from '@kobalte/core/switch';
import { RotateCcw } from 'lucide-solid';
import { createSignal, onCleanup, onMount, type Component } from 'solid-js';
import type { View } from 'vega';
import { BASE_LOCALE, toLanguageTag, type Locale } from '@sshawn9/site-domain/locales';
import * as m from '@sshawn9/site-i18n/messages';
import { waitForDocumentFonts } from '../../runtime/document-font-readiness';
import { setInteractiveFigureState } from '../../runtime/interactive-figure-state';
import {
  createClosedLoopControlTimingSpec,
  INITIAL_TIMING_SIGNALS,
  type ClosedLoopControlTimingCopy,
  type ClosedLoopControlTimingLayout,
} from './closed-loop-control-timing-spec';

type Props = {
  locale?: Locale;
};

const OBSERVED_SIGNALS = [
  ...Object.keys(INITIAL_TIMING_SIGNALS),
  'firstDecisionTime',
  'firstFeedbackTime',
  'firstApplicationTime',
] as const;

type Theme = {
  ink: string;
  muted: string;
  line: string;
  surface: string;
  decisionColor: string;
  feedbackColor: string;
  applicationColor: string;
};

function css(root: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(root).getPropertyValue(name).trim() || fallback;
}

function readTheme(root: HTMLElement): Theme {
  const dark = document.documentElement.classList.contains('dark');
  return {
    ink: css(root, '--ink', dark ? '#e5e7eb' : '#172033'),
    muted: css(root, '--muted', dark ? '#94a3b8' : '#697386'),
    line: css(root, '--line', dark ? '#273449' : '#d7d7d8'),
    surface: css(root, '--surface-strong', dark ? '#090d18' : '#ffffff'),
    decisionColor: dark ? '#648fff' : '#1d4ed8',
    feedbackColor: dark ? '#c27a9a' : '#9f3f64',
    applicationColor: dark ? '#ffb000' : '#b45309',
  };
}

function setSignals(view: View, signals: Record<string, string | number | boolean>): View {
  Object.entries(signals).forEach(([name, value]) => view.signal(name, value));
  return view;
}

function createClosedLoopControlTimingCopy(locale: Locale): ClosedLoopControlTimingCopy {
  const options = { locale } as const;
  return {
    motorController: m.closed_loop_control_timing_motor_controller({}, options),
    decisionUpdate: m.closed_loop_control_timing_decision_update({}, options),
    feedbackGeneration: m.closed_loop_control_timing_feedback_generation({}, options),
    commandApplication: m.closed_loop_control_timing_command_application({}, options),
    commandAvailable: m.closed_loop_control_timing_command_available({}, options),
    feedbackAvailable: m.closed_loop_control_timing_feedback_available({}, options),
    generated: m.closed_loop_control_timing_generated({}, options),
    timeValue: m.closed_loop_control_timing_time_value({}, options),
    available: m.closed_loop_control_timing_available({}, options),
    delay: m.closed_loop_control_timing_delay({}, options),
    period: m.closed_loop_control_timing_period({}, options),
    nextApplication: m.closed_loop_control_timing_next_application({}, options),
    nextDecision: m.closed_loop_control_timing_next_decision({}, options),
    latestCommandThen: m.closed_loop_control_timing_latest_command_then({}, options),
    latestFeedbackThen: m.closed_loop_control_timing_latest_feedback_then({}, options),
    newerCommandThen: m.closed_loop_control_timing_newer_command_then({}, options),
    newerFeedbackThen: m.closed_loop_control_timing_newer_feedback_then({}, options),
    dragDecisionOffset: m.closed_loop_control_timing_drag_decision_offset({}, options),
    dragDecisionPeriod: m.closed_loop_control_timing_drag_decision_period({}, options),
    dragFeedbackGroup: m.closed_loop_control_timing_drag_feedback_group({}, options),
    dragFeedbackPeriod: m.closed_loop_control_timing_drag_feedback_period({}, options),
    dragApplicationGroup: m.closed_loop_control_timing_drag_application_group({}, options),
    dragApplicationPeriod: m.closed_loop_control_timing_drag_application_period({}, options),
    dragDelay: m.closed_loop_control_timing_drag_delay({}, options),
    firstPointOffset: m.closed_loop_control_timing_first_point_offset({}, options),
    past: m.closed_loop_control_timing_past({}, options),
    future: m.closed_loop_control_timing_future({}, options),
    currentDecision: m.closed_loop_control_timing_current_decision({}, options),
    feedbackDelay: m.closed_loop_control_timing_feedback_delay({}, options),
    transmissionDelay: m.closed_loop_control_timing_transmission_delay({}, options),
    stateKnown: m.closed_loop_control_timing_state_known({}, options),
    statePredictable: m.closed_loop_control_timing_state_predictable({}, options),
    stateUnknown: m.closed_loop_control_timing_state_unknown({}, options),
  };
}

function measureTimingLayout(copy: ClosedLoopControlTimingCopy): ClosedLoopControlTimingLayout {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return { plotLeft: 176, compactPlotLeft: 136 };

  const titles = [copy.decisionUpdate, copy.feedbackGeneration, copy.commandApplication];
  const details = [`${copy.firstPointOffset} -100.0 ms`, `${copy.period} 100.0 ms`];
  const measure = (font: string, values: string[]) => {
    context.font = font;
    return Math.max(...values.map((value) => context.measureText(value).width));
  };
  const columnWidth = (titleFont: string, detailFont: string, outerPadding: number) =>
    Math.ceil(
      outerPadding + Math.max(measure(titleFont, titles), measure(detailFont, details)) + 14,
    );

  return {
    plotLeft: columnWidth('700 12px sans-serif', '10px sans-serif', 16),
    compactPlotLeft: columnWidth('700 12px sans-serif', '8px sans-serif', 10),
  };
}

const ClosedLoopControlTimingClient: Component<Props> = (props) => {
  const locale = props.locale ?? BASE_LOCALE;
  const copy = createClosedLoopControlTimingCopy(locale);
  const ariaLabel = m.closed_loop_control_timing_aria_label({}, { locale });
  const [synchronized, setSynchronizedState] = createSignal<boolean>(
    INITIAL_TIMING_SIGNALS.synchronized,
  );
  let root!: HTMLDivElement;
  let graph!: HTMLDivElement;
  let view: View | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let themeObserver: MutationObserver | undefined;
  const fontWait = new AbortController();
  let disposed = false;
  let resizeFrame = 0;

  const runThemeUpdate = () => {
    if (!view) return;
    void setSignals(view, readTheme(root)).runAsync();
  };

  const resize = () => {
    if (!view || resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!view) return;
      const width = Math.max(320, graph.clientWidth);
      const height = Math.max(420, graph.clientHeight);
      void view.width(width).height(height).runAsync();
    });
  };

  const reset = () => {
    setSynchronizedState(INITIAL_TIMING_SIGNALS.synchronized);
    if (!view) return;
    void setSignals(view, INITIAL_TIMING_SIGNALS).runAsync();
  };

  const setSynchronized = (checked: boolean) => {
    setSynchronizedState(checked);
    if (!view) return;
    view.signal('synchronized', checked);
    if (checked) {
      view.signal('applicationInterval', view.signal('feedbackInterval'));
      view.signal('applicationOffset', view.signal('feedbackOffset'));
    }
    void view.runAsync();
  };

  onMount(() => {
    void Promise.all([
      import('vega'),
      waitForDocumentFonts(document.documentElement, fontWait.signal),
    ])
      .then(async ([vega]) => {
        if (disposed) return;
        view = new vega.View(
          vega.parse(createClosedLoopControlTimingSpec(copy, measureTimingLayout(copy))),
          {
            container: graph,
            renderer: 'svg',
            hover: true,
          },
        );

        setSignals(view, readTheme(root));
        view.width(Math.max(320, graph.clientWidth));
        view.height(Math.max(420, graph.clientHeight));

        for (const signal of OBSERVED_SIGNALS) {
          view.addSignalListener(signal, (_name, value) => {
            root.dataset[signal] = String(value);
          });
        }
        view.addSignalListener('dragKind', (_name, value) => {
          if (value) root.dataset.dragging = String(value);
          else delete root.dataset.dragging;
        });

        view.signal('synchronized', synchronized());
        await view.runAsync();
        if (disposed) return;
        setInteractiveFigureState(root, 'ready');
        graph.setAttribute('aria-label', ariaLabel);
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(graph);
        themeObserver = new MutationObserver(runThemeUpdate);
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class'],
        });
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setInteractiveFigureState(root, 'error');
          console.error('Failed to initialize the closed-loop timing figure.', error);
        }
      });
  });

  onCleanup(() => {
    disposed = true;
    fontWait.abort();
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    view?.finalize();
  });

  return (
    <div
      ref={root}
      class="closed-loop-control-timing"
      data-closed-loop-control-timing
      lang={toLanguageTag(locale)}
    >
      <div class="closed-loop-control-timing-toolbar">
        <Switch
          class="closed-loop-control-timing-switch"
          checked={synchronized()}
          onChange={setSynchronized}
        >
          <Switch.Input />
          <Switch.Control class="closed-loop-control-timing-switch-control">
            <Switch.Thumb class="closed-loop-control-timing-switch-thumb" />
          </Switch.Control>
          <Switch.Label>{m.closed_loop_control_timing_synchronize({}, { locale })}</Switch.Label>
        </Switch>
        <button type="button" class="closed-loop-control-timing-reset" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          {m.closed_loop_control_timing_reset({}, { locale })}
        </button>
      </div>
      <div ref={graph} class="closed-loop-control-timing-plot" aria-label={ariaLabel} />
    </div>
  );
};

export default ClosedLoopControlTimingClient;
