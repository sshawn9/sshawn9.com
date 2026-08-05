import { Switch } from '@kobalte/core/switch';
import { RotateCcw } from 'lucide-solid';
import { createSignal, onCleanup, onMount, type Component } from 'solid-js';
import type { View } from 'vega';
import { BASE_LOCALE, toLanguageTag, type Locale } from '../../../i18n/config';
import * as m from '../../../paraglide/messages.js';
import { createClosedLoopTimingSpec, type ClosedLoopTimingCopy } from './closed-loop-timing-spec';

type Props = {
  locale?: Locale;
};

const INITIAL_SIGNALS = {
  decisionInterval: 10,
  decisionTime: 50,
  commandDelay: 15,
  feedbackInterval: 6,
  feedbackOffset: 2.5,
  feedbackDelay: 10,
  applicationInterval: 6,
  applicationOffset: 2.5,
  synchronized: false,
} as const;

const OBSERVED_SIGNALS = [
  ...Object.keys(INITIAL_SIGNALS),
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

function createCopy(locale: Locale): ClosedLoopTimingCopy {
  const options = { locale } as const;
  return {
    decisionUpdate: m.closed_loop_decision_update({}, options),
    feedbackGeneration: m.closed_loop_feedback_generation({}, options),
    commandApplication: m.closed_loop_command_application({}, options),
    commandAvailable: m.closed_loop_command_available({}, options),
    feedbackAvailable: m.closed_loop_feedback_available({}, options),
    generated: m.closed_loop_generated({}, options),
    timeValue: m.closed_loop_time_value({}, options),
    available: m.closed_loop_available({}, options),
    delay: m.closed_loop_delay({}, options),
    period: m.closed_loop_period({}, options),
    at: m.closed_loop_at({}, options),
    adoptedByExecution: m.closed_loop_adopted_by_execution({}, options),
    adoptedByDecision: m.closed_loop_adopted_by_decision({}, options),
    notAdoptedByExecution: m.closed_loop_not_adopted_by_execution({}, options),
    notAdoptedByDecision: m.closed_loop_not_adopted_by_decision({}, options),
    dragDecisionOffset: m.closed_loop_drag_decision_offset({}, options),
    dragDecisionPeriod: m.closed_loop_drag_decision_period({}, options),
    dragFeedbackGroup: m.closed_loop_drag_feedback_group({}, options),
    dragFeedbackPeriod: m.closed_loop_drag_feedback_period({}, options),
    dragApplicationGroup: m.closed_loop_drag_application_group({}, options),
    dragApplicationPeriod: m.closed_loop_drag_application_period({}, options),
    dragDelay: m.closed_loop_drag_delay({}, options),
    firstPointOffset: m.closed_loop_first_point_offset({}, options),
    past: m.closed_loop_past({}, options),
    future: m.closed_loop_future({}, options),
    timeAxis: m.closed_loop_time_axis({}, options),
    currentDecision: m.closed_loop_current_decision({}, options),
    feedbackDelay: m.closed_loop_feedback_delay({}, options),
    transmissionDelay: m.closed_loop_transmission_delay({}, options),
  };
}

const ClosedLoopTiming: Component<Props> = (props) => {
  const locale = props.locale ?? BASE_LOCALE;
  const copy = createCopy(locale);
  const ariaLabel = m.closed_loop_aria_label({}, { locale });
  const [synchronized, setSynchronizedState] = createSignal(false);
  let root!: HTMLDivElement;
  let graph!: HTMLDivElement;
  let view: View | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let themeObserver: MutationObserver | undefined;
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
      const height = Math.max(500, graph.clientHeight);
      void view.width(width).height(height).runAsync();
    });
  };

  const reset = () => {
    if (!view) return;
    setSynchronizedState(false);
    void setSignals(view, INITIAL_SIGNALS).runAsync();
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
    void import('vega').then(async (vega) => {
      if (disposed) return;
      view = new vega.View(vega.parse(createClosedLoopTimingSpec(copy)), {
        container: graph,
        renderer: 'svg',
        hover: true,
      });

      setSignals(view, readTheme(root));
      view.width(Math.max(320, graph.clientWidth));
      view.height(Math.max(500, graph.clientHeight));

      for (const signal of OBSERVED_SIGNALS) {
        view.addSignalListener(signal, (_name, value) => {
          root.dataset[signal] = String(value);
        });
      }
      view.addSignalListener('dragKind', (_name, value) => {
        if (value) root.dataset.dragging = String(value);
        else delete root.dataset.dragging;
      });

      await view.runAsync();
      graph.setAttribute('aria-label', ariaLabel);
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(graph);
      themeObserver = new MutationObserver(runThemeUpdate);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    });
  });

  onCleanup(() => {
    disposed = true;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    view?.finalize();
  });

  return (
    <div ref={root} class="closed-loop-timing" data-vega-timing lang={toLanguageTag(locale)}>
      <div class="timing-toolbar">
        <button type="button" class="timing-reset" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          {m.closed_loop_reset({}, { locale })}
        </button>
        <Switch class="timing-switch" checked={synchronized()} onChange={setSynchronized}>
          <Switch.Input />
          <Switch.Control class="timing-switch-control">
            <Switch.Thumb class="timing-switch-thumb" />
          </Switch.Control>
          <Switch.Label>{m.closed_loop_synchronize({}, { locale })}</Switch.Label>
        </Switch>
      </div>
      <div ref={graph} class="closed-loop-timing-plot" aria-label={ariaLabel} />
    </div>
  );
};

export default ClosedLoopTiming;
