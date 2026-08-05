import type { Spec } from 'vega';

export type ClosedLoopTimingCopy = {
  decisionUpdate: string;
  feedbackGeneration: string;
  commandApplication: string;
  commandAvailable: string;
  feedbackAvailable: string;
  generated: string;
  timeValue: string;
  available: string;
  delay: string;
  period: string;
  at: string;
  adoptedByExecution: string;
  adoptedByDecision: string;
  notAdoptedByExecution: string;
  notAdoptedByDecision: string;
  dragDecisionOffset: string;
  dragDecisionPeriod: string;
  dragFeedbackGroup: string;
  dragFeedbackPeriod: string;
  dragApplicationGroup: string;
  dragApplicationPeriod: string;
  dragDelay: string;
  firstPointOffset: string;
  past: string;
  future: string;
  timeAxis: string;
  currentDecision: string;
  feedbackDelay: string;
  transmissionDelay: string;
};

const INDEX_VALUES = Array.from({ length: 2201 }, (_, position) => ({
  index: position - 1100,
}));

const VIEW_START = -5;
const VIEW_END = 105;
const pointerTime = `clamp(invert('time', x()), ${VIEW_START}, ${VIEW_END})`;
const quantize = (expression: string) => `round((${expression}) * 10) / 10`;
const periodicPosition = '(dragIndex - dragAnchorIndex)';
const periodicBoundaryMaximum = `(${VIEW_END} - dragAnchorTime) / ${periodicPosition}`;
const periodicMaximum = `min(100, 2 + floor(((${periodicBoundaryMaximum}) - 2) / 0.1 + 1e-9) * 0.1)`;
const nextPeriodicInterval = `clamp(${quantize(`(${pointerTime} - dragAnchorTime) / ${periodicPosition}`)}, 2, ${periodicMaximum})`;

const dragMove = '[window:pointerdown, window:pointerup] > window:pointermove!';
const dragEnd = 'window:pointerup, window:pointercancel';

const color = (name: string) => ({ signal: name });
const literal = (value: string) => JSON.stringify(value);

export function createClosedLoopTimingSpec(copy: ClosedLoopTimingCopy): Spec {
  return {
    $schema: 'https://vega.github.io/schema/vega/v6.json',
    width: 960,
    height: 620,
    autosize: { type: 'none', contains: 'padding', resize: true },
    padding: 0,
    signals: [
      { name: 'ink', value: '#e5e7eb' },
      { name: 'muted', value: '#94a3b8' },
      { name: 'line', value: '#273449' },
      { name: 'surface', value: '#090d18' },
      { name: 'decisionColor', value: '#648fff' },
      { name: 'feedbackColor', value: '#c27a9a' },
      { name: 'applicationColor', value: '#ffb000' },

      { name: 'compact', update: 'width < 640' },
      { name: 'plotLeft', update: 'compact ? 112 : 178' },
      { name: 'plotRight', update: 'width - (compact ? 12 : 24)' },
      { name: 'decisionY', update: 'max(126, height * 0.25)' },
      { name: 'feedbackY', update: 'height * 0.5' },
      { name: 'applicationY', update: 'height * 0.78' },
      { name: 'pairedRailGap', update: 'compact ? 13 : 17' },
      { name: 'decisionPrimaryY', update: 'decisionY - pairedRailGap / 2' },
      { name: 'decisionAvailabilityY', update: 'decisionY + pairedRailGap / 2' },
      { name: 'applicationAvailabilityY', update: 'applicationY - pairedRailGap / 2' },
      { name: 'applicationPrimaryY', update: 'applicationY + pairedRailGap / 2' },
      { name: 'baselineY', update: 'height - 34' },

      {
        name: 'decisionInterval',
        value: 10,
        on: [
          {
            events: dragMove,
            update: `dragKind === 'decision-interval' ? clamp(${quantize(`(${pointerTime} - decisionTime) / dragIndex`)}, 2, 25) : decisionInterval`,
          },
        ],
      },
      {
        name: 'decisionTime',
        value: 50,
        on: [
          {
            events: dragMove,
            update: `dragKind === 'decision-time' ? clamp(${quantize(pointerTime)}, 0, 100) : decisionTime`,
          },
        ],
      },
      {
        name: 'commandDelay',
        value: 15,
        on: [
          {
            events: dragMove,
            update: `dragKind === 'command-delay' ? clamp(${quantize(`${pointerTime} - dragSourceTime`)}, 0, 50) : commandDelay`,
          },
        ],
      },
      {
        name: 'feedbackInterval',
        value: 6,
        on: [
          {
            events: dragMove,
            update:
              `dragKind === 'feedback-interval' ? ${nextPeriodicInterval} : ` +
              `synchronized && dragKind === 'application-interval' ? ${nextPeriodicInterval} : feedbackInterval`,
          },
        ],
      },
      {
        name: 'feedbackOffset',
        value: 2.5,
        on: [
          {
            events: dragMove,
            update:
              `dragKind === 'feedback-offset' ? ${quantize(pointerTime)} - dragIndex * dragStartInterval : ` +
              `dragKind === 'feedback-interval' ? dragAnchorTime - dragAnchorIndex * ${nextPeriodicInterval} : ` +
              `synchronized && dragKind === 'application-offset' ? ${quantize(pointerTime)} - dragIndex * dragStartInterval : ` +
              `synchronized && dragKind === 'application-interval' ? dragAnchorTime - dragAnchorIndex * ${nextPeriodicInterval} : feedbackOffset`,
          },
        ],
      },
      {
        name: 'feedbackDelay',
        value: 10,
        on: [
          {
            events: dragMove,
            update: `dragKind === 'feedback-delay' ? clamp(${quantize(`${pointerTime} - dragSourceTime`)}, 0, 50) : feedbackDelay`,
          },
        ],
      },
      {
        name: 'applicationInterval',
        value: 6,
        on: [
          {
            events: dragMove,
            update:
              `dragKind === 'application-interval' ? ${nextPeriodicInterval} : ` +
              `synchronized && dragKind === 'feedback-interval' ? ${nextPeriodicInterval} : applicationInterval`,
          },
        ],
      },
      {
        name: 'applicationOffset',
        value: 2.5,
        on: [
          {
            events: dragMove,
            update:
              `dragKind === 'application-offset' ? ${quantize(pointerTime)} - dragIndex * dragStartInterval : ` +
              `dragKind === 'application-interval' ? dragAnchorTime - dragAnchorIndex * ${nextPeriodicInterval} : ` +
              `synchronized && dragKind === 'feedback-offset' ? ${quantize(pointerTime)} - dragIndex * dragStartInterval : ` +
              `synchronized && dragKind === 'feedback-interval' ? dragAnchorTime - dragAnchorIndex * ${nextPeriodicInterval} : applicationOffset`,
          },
        ],
      },
      { name: 'synchronized', value: false },

      {
        name: 'firstDecisionIndex',
        update: `ceil((${VIEW_START} - decisionTime) / decisionInterval - 1e-9)`,
      },
      {
        name: 'firstDecisionTime',
        update: 'decisionTime + firstDecisionIndex * decisionInterval',
      },
      {
        name: 'firstFeedbackIndex',
        update: `ceil((${VIEW_START} - feedbackOffset) / feedbackInterval - 1e-9)`,
      },
      {
        name: 'firstFeedbackTime',
        update: 'feedbackOffset + firstFeedbackIndex * feedbackInterval',
      },
      {
        name: 'firstApplicationIndex',
        update: `ceil((${VIEW_START} - applicationOffset) / applicationInterval - 1e-9)`,
      },
      {
        name: 'firstApplicationTime',
        update: 'applicationOffset + firstApplicationIndex * applicationInterval',
      },
      {
        name: 'currentFeedbackIndex',
        update: 'floor((decisionTime - feedbackDelay - feedbackOffset) / feedbackInterval + 1e-9)',
      },
      {
        name: 'currentFeedbackTime',
        update: 'feedbackOffset + currentFeedbackIndex * feedbackInterval',
      },

      {
        name: 'dragKind',
        value: null,
        on: [
          {
            events: '@decisionPoints:pointerdown',
            update: "datum.index === 0 ? 'decision-time' : 'decision-interval'",
          },
          {
            events: '@feedbackPoints:pointerdown',
            update: "datum.index === firstFeedbackIndex ? 'feedback-offset' : 'feedback-interval'",
          },
          {
            events: '@applicationPoints:pointerdown',
            update:
              "datum.index === firstApplicationIndex ? 'application-offset' : 'application-interval'",
          },
          {
            events: '@commandAvailabilityPoints:pointerdown',
            update: "'command-delay'",
          },
          {
            events: '@feedbackAvailabilityPoints:pointerdown',
            update: "'feedback-delay'",
          },
          { events: dragEnd, update: 'null' },
        ],
      },
      {
        name: 'dragIndex',
        value: 0,
        on: [
          { events: '@decisionPoints:pointerdown', update: 'datum.index' },
          { events: '@feedbackPoints:pointerdown', update: 'datum.index' },
          { events: '@applicationPoints:pointerdown', update: 'datum.index' },
          { events: '@commandAvailabilityPoints:pointerdown', update: 'datum.index' },
          { events: '@feedbackAvailabilityPoints:pointerdown', update: 'datum.index' },
        ],
      },
      {
        name: 'dragSourceTime',
        value: 0,
        on: [
          { events: '@commandAvailabilityPoints:pointerdown', update: 'datum.sourceTime' },
          { events: '@feedbackAvailabilityPoints:pointerdown', update: 'datum.sourceTime' },
        ],
      },
      {
        name: 'dragAnchorIndex',
        value: 0,
        on: [
          { events: '@feedbackPoints:pointerdown', update: 'firstFeedbackIndex' },
          { events: '@applicationPoints:pointerdown', update: 'firstApplicationIndex' },
        ],
      },
      {
        name: 'dragAnchorTime',
        value: 0,
        on: [
          {
            events: '@feedbackPoints:pointerdown',
            update: 'feedbackOffset + firstFeedbackIndex * feedbackInterval',
          },
          {
            events: '@applicationPoints:pointerdown',
            update: 'applicationOffset + firstApplicationIndex * applicationInterval',
          },
        ],
      },
      {
        name: 'dragStartInterval',
        value: 1,
        on: [
          {
            events: '@feedbackPoints:pointerdown',
            update: 'feedbackInterval',
          },
          {
            events: '@applicationPoints:pointerdown',
            update: 'applicationInterval',
          },
        ],
      },
      {
        name: 'hoverKind',
        value: null,
        on: [
          {
            events: '@decisionPoints:pointerover, @decisionPoints:pointerdown',
            update: "'decision'",
          },
          {
            events: '@feedbackPoints:pointerover, @feedbackPoints:pointerdown',
            update: "'feedback'",
          },
          {
            events: '@applicationPoints:pointerover, @applicationPoints:pointerdown',
            update: "'application'",
          },
          {
            events:
              '@commandAvailabilityPoints:pointerover, @commandAvailabilityPoints:pointerdown',
            update: "'command-availability'",
          },
          {
            events:
              '@feedbackAvailabilityPoints:pointerover, @feedbackAvailabilityPoints:pointerdown',
            update: "'feedback-availability'",
          },
          {
            events:
              '@decisionPoints:pointerout, @feedbackPoints:pointerout, @applicationPoints:pointerout, @commandAvailabilityPoints:pointerout, @feedbackAvailabilityPoints:pointerout',
            update: 'null',
          },
        ],
      },
      {
        name: 'hoverIndex',
        value: 0,
        on: [
          {
            events:
              '@decisionPoints:pointerover, @decisionPoints:pointerdown, @feedbackPoints:pointerover, @feedbackPoints:pointerdown, @applicationPoints:pointerover, @applicationPoints:pointerdown, @commandAvailabilityPoints:pointerover, @commandAvailabilityPoints:pointerdown, @feedbackAvailabilityPoints:pointerover, @feedbackAvailabilityPoints:pointerdown',
            update: 'datum.index',
          },
        ],
      },
      {
        name: 'hoverX',
        value: 0,
        on: [{ events: 'pointermove', update: 'x()' }],
      },
      {
        name: 'hoverY',
        value: 0,
        on: [{ events: 'pointermove', update: 'y()' }],
      },
      {
        name: 'tooltipKind',
        update:
          "dragKind === 'decision-time' || dragKind === 'decision-interval' ? 'decision' : " +
          "dragKind === 'feedback-offset' || dragKind === 'feedback-interval' ? 'feedback' : " +
          "dragKind === 'application-offset' || dragKind === 'application-interval' ? 'application' : " +
          "dragKind === 'command-delay' ? 'command-availability' : " +
          "dragKind === 'feedback-delay' ? 'feedback-availability' : hoverKind",
      },
      {
        name: 'tooltipIndex',
        update: 'dragKind === null ? hoverIndex : dragIndex',
      },
      {
        name: 'tooltipSourceTime',
        update:
          "tooltipKind === 'decision' ? decisionTime + tooltipIndex * decisionInterval : " +
          "tooltipKind === 'feedback' || tooltipKind === 'feedback-availability' ? feedbackOffset + tooltipIndex * feedbackInterval : " +
          "tooltipKind === 'application' ? applicationOffset + tooltipIndex * applicationInterval : " +
          'decisionTime + tooltipIndex * decisionInterval',
      },
      {
        name: 'tooltipTime',
        update:
          "tooltipKind === 'command-availability' ? tooltipSourceTime + commandDelay : " +
          "tooltipKind === 'feedback-availability' ? tooltipSourceTime + feedbackDelay : tooltipSourceTime",
      },
      {
        name: 'tooltipSelectedTime',
        update:
          "tooltipKind === 'command-availability' ? applicationOffset + ceil((tooltipTime - applicationOffset) / applicationInterval - 1e-9) * applicationInterval : " +
          "tooltipKind === 'feedback-availability' ? decisionTime + ceil((tooltipTime - decisionTime) / decisionInterval - 1e-9) * decisionInterval : 0",
      },
      {
        name: 'tooltipSelected',
        update:
          `tooltipKind === 'command-availability' ? tooltipSelectedTime <= ${VIEW_END} && tooltipSelectedTime < tooltipTime + decisionInterval - 1e-9 : ` +
          `tooltipKind === 'feedback-availability' ? tooltipSelectedTime <= ${VIEW_END} && tooltipSelectedTime < tooltipTime + feedbackInterval - 1e-9 : false`,
      },
      {
        name: 'tooltipTitle',
        update:
          `tooltipKind === 'decision' ? ${literal(copy.decisionUpdate)} + ' ' + tooltipIndex : ` +
          `tooltipKind === 'feedback' ? ${literal(copy.feedbackGeneration)} + ' ' + tooltipIndex : ` +
          `tooltipKind === 'application' ? ${literal(copy.commandApplication)} + ' ' + tooltipIndex : ` +
          `tooltipKind === 'command-availability' ? ${literal(copy.commandAvailable)} + ' ' + tooltipIndex : ${literal(copy.feedbackAvailable)} + ' ' + tooltipIndex`,
      },
      {
        name: 'tooltipLine1',
        update: `tooltipKind === 'command-availability' || tooltipKind === 'feedback-availability' ? ${literal(copy.generated)} + '  ' + format(tooltipSourceTime, '.1f') + ' ms' : ${literal(copy.timeValue)} + '  ' + format(tooltipTime, '.1f') + ' ms'`,
      },
      {
        name: 'tooltipLine2',
        update:
          `tooltipKind === 'command-availability' ? ${literal(copy.available)} + '  ' + format(tooltipTime, '.1f') + ' ms  ·  ' + ${literal(copy.delay)} + ' ' + format(commandDelay, '.1f') + ' ms' : ` +
          `tooltipKind === 'feedback-availability' ? ${literal(copy.available)} + '  ' + format(tooltipTime, '.1f') + ' ms  ·  ' + ${literal(copy.delay)} + ' ' + format(feedbackDelay, '.1f') + ' ms' : ` +
          `tooltipKind === 'decision' ? ${literal(copy.period)} + '  ' + format(decisionInterval, '.1f') + ' ms' : ` +
          `tooltipKind === 'feedback' ? ${literal(copy.period)} + '  ' + format(feedbackInterval, '.1f') + ' ms' : ${literal(copy.period)} + '  ' + format(applicationInterval, '.1f') + ' ms'`,
      },
      {
        name: 'tooltipLine3',
        update:
          `tooltipKind === 'command-availability' ? (tooltipSelected ? ${literal(copy.at)} + ' ' + format(tooltipSelectedTime, '.1f') + ' ms  ·  ' + ${literal(copy.adoptedByExecution)} : ${literal(copy.notAdoptedByExecution)}) : ` +
          `tooltipKind === 'feedback-availability' ? (tooltipSelected ? ${literal(copy.at)} + ' ' + format(tooltipSelectedTime, '.1f') + ' ms  ·  ' + ${literal(copy.adoptedByDecision)} : ${literal(copy.notAdoptedByDecision)}) : ''`,
      },
      {
        name: 'tooltipLine4',
        update:
          `tooltipKind === 'decision' ? (tooltipIndex === 0 ? ${literal(copy.dragDecisionOffset)} : ${literal(copy.dragDecisionPeriod)}) : ` +
          `tooltipKind === 'feedback' ? (tooltipIndex === firstFeedbackIndex ? ${literal(copy.dragFeedbackGroup)} : ${literal(copy.dragFeedbackPeriod)}) : ` +
          `tooltipKind === 'application' ? (tooltipIndex === firstApplicationIndex ? ${literal(copy.dragApplicationGroup)} : ${literal(copy.dragApplicationPeriod)}) : ${literal(copy.dragDelay)}`,
      },
    ],
    data: [
      {
        name: 'indices',
        values: INDEX_VALUES,
      },
      {
        name: 'tooltipState',
        values: [{}],
        transform: [{ type: 'filter', expr: 'tooltipKind !== null' }],
      },
      {
        name: 'decisions',
        source: 'indices',
        transform: [
          { type: 'formula', as: 'time', expr: 'decisionTime + datum.index * decisionInterval' },
          {
            type: 'filter',
            expr: `datum.time >= ${VIEW_START} && datum.time <= ${VIEW_END}`,
          },
        ],
      },
      {
        name: 'feedback',
        source: 'indices',
        transform: [
          { type: 'formula', as: 'time', expr: 'feedbackOffset + datum.index * feedbackInterval' },
          {
            type: 'filter',
            expr: `datum.time >= ${VIEW_START} && datum.time <= ${VIEW_END}`,
          },
        ],
      },
      {
        name: 'applications',
        source: 'indices',
        transform: [
          {
            type: 'formula',
            as: 'time',
            expr: 'applicationOffset + datum.index * applicationInterval',
          },
          {
            type: 'filter',
            expr: `datum.time >= ${VIEW_START} && datum.time <= ${VIEW_END}`,
          },
        ],
      },
      {
        name: 'commandAvailability',
        source: 'decisions',
        transform: [
          { type: 'formula', as: 'sourceTime', expr: 'datum.time' },
          { type: 'formula', as: 'time', expr: 'datum.sourceTime + commandDelay' },
          {
            type: 'filter',
            expr: `datum.sourceTime >= ${VIEW_START} && datum.time <= ${VIEW_END}`,
          },
          {
            type: 'formula',
            as: 'nextApplication',
            expr: 'applicationOffset + ceil((datum.time - applicationOffset) / applicationInterval - 1e-9) * applicationInterval',
          },
          {
            type: 'formula',
            as: 'selected',
            expr: `datum.nextApplication <= ${VIEW_END} && datum.nextApplication < datum.time + decisionInterval - 1e-9`,
          },
        ],
      },
      {
        name: 'feedbackAvailability',
        source: 'feedback',
        transform: [
          { type: 'formula', as: 'sourceTime', expr: 'datum.time' },
          { type: 'formula', as: 'time', expr: 'datum.sourceTime + feedbackDelay' },
          {
            type: 'filter',
            expr: `datum.sourceTime >= ${VIEW_START} && datum.time <= ${VIEW_END}`,
          },
          {
            type: 'formula',
            as: 'nextDecision',
            expr: 'decisionTime + ceil((datum.time - decisionTime) / decisionInterval - 1e-9) * decisionInterval',
          },
          {
            type: 'formula',
            as: 'selected',
            expr: `datum.nextDecision <= ${VIEW_END} && datum.nextDecision < datum.time + feedbackInterval - 1e-9`,
          },
        ],
      },
    ],
    scales: [
      {
        name: 'time',
        type: 'linear',
        domain: [VIEW_START, VIEW_END],
        range: [{ signal: 'plotLeft' }, { signal: 'plotRight' }],
        zero: false,
        nice: false,
      },
    ],
    marks: [
      {
        type: 'rule',
        from: { data: 'commandAvailability' },
        encode: {
          enter: { strokeDash: { value: [7, 7] } },
          update: {
            x: { scale: 'time', field: 'sourceTime' },
            x2: { scale: 'time', field: 'time' },
            y: { signal: 'decisionPrimaryY' },
            y2: { signal: 'applicationAvailabilityY' },
            stroke: color('decisionColor'),
            strokeOpacity: { value: 0.34 },
            strokeWidth: { value: 1 },
          },
        },
      },
      {
        type: 'rule',
        from: { data: 'feedbackAvailability' },
        encode: {
          enter: { strokeDash: { value: [3, 5] } },
          update: {
            x: { scale: 'time', field: 'sourceTime' },
            x2: { scale: 'time', field: 'time' },
            y: { signal: 'feedbackY' },
            y2: { signal: 'decisionAvailabilityY' },
            stroke: color('feedbackColor'),
            strokeOpacity: { value: 0.38 },
            strokeWidth: { value: 1 },
          },
        },
      },
      projectionStems(
        'decisionProjectionStems',
        'decisions',
        'decisionPrimaryY',
        'decisionAvailabilityY',
        'decisionColor',
      ),
      projectionStems(
        'feedbackAvailabilityProjectionStems',
        'feedbackAvailability',
        'decisionPrimaryY',
        'decisionAvailabilityY',
        'feedbackColor',
      ),
      projectionStems(
        'commandAvailabilityProjectionStems',
        'commandAvailability',
        'applicationAvailabilityY',
        'applicationPrimaryY',
        'decisionColor',
      ),
      projectionStems(
        'applicationProjectionStems',
        'applications',
        'applicationAvailabilityY',
        'applicationPrimaryY',
        'applicationColor',
      ),
      timelineRail('decisionPrimaryRail', 'decisionPrimaryY', false),
      timelineRail('decisionAvailabilityRail', 'decisionAvailabilityY', true),
      timelineRail('feedbackPrimaryRail', 'feedbackY', false),
      timelineRail('applicationAvailabilityRail', 'applicationAvailabilityY', true),
      timelineRail('applicationPrimaryRail', 'applicationPrimaryY', false),
      ...rowLabels(copy),
      ...topGuideMarks(copy),
      ...bottomGuideMarks(copy),
      ...currentDecisionMarks(copy),
      ...delayDimensionMarks(copy),
      samplePoints('decisionPoints', 'decisions', 'decisionPrimaryY', 'decisionColor'),
      samplePoints('feedbackPoints', 'feedback', 'feedbackY', 'feedbackColor'),
      samplePoints('applicationPoints', 'applications', 'applicationPrimaryY', 'applicationColor'),
      availabilityPoints(
        'commandAvailabilityPoints',
        'commandAvailability',
        'applicationAvailabilityY',
        'decisionColor',
        'triangle-down',
      ),
      availabilityPoints(
        'feedbackAvailabilityPoints',
        'feedbackAvailability',
        'decisionAvailabilityY',
        'feedbackColor',
        'triangle-up',
      ),
      ...liveTooltipMarks(),
    ],
  } as Spec;
}

function rowLabels(copy: ClosedLoopTimingCopy): NonNullable<Spec['marks']> {
  const rows = [
    {
      y: 'decisionY',
      color: 'decisionColor',
      label: copy.decisionUpdate,
      offset: `${literal(copy.firstPointOffset)} + ' ' + format(firstDecisionTime, '.1f') + ' ms'`,
      interval: `${literal(copy.period)} + ' ' + format(decisionInterval, '.1f') + ' ms'`,
    },
    {
      y: 'feedbackY',
      color: 'feedbackColor',
      label: copy.feedbackGeneration,
      offset: `${literal(copy.firstPointOffset)} + ' ' + format(firstFeedbackTime, '.1f') + ' ms'`,
      interval: `${literal(copy.period)} + ' ' + format(feedbackInterval, '.1f') + ' ms'`,
    },
    {
      y: 'applicationY',
      color: 'applicationColor',
      label: copy.commandApplication,
      offset: `${literal(copy.firstPointOffset)} + ' ' + format(firstApplicationTime, '.1f') + ' ms'`,
      interval: `${literal(copy.period)} + ' ' + format(applicationInterval, '.1f') + ' ms'`,
    },
  ];

  return rows.flatMap((row) => [
    {
      type: 'text',
      encode: {
        update: {
          x: { signal: 'plotLeft - 18' },
          y: { signal: row.y },
          text: { value: row.label },
          align: { value: 'right' },
          baseline: { value: 'middle' },
          fill: color(row.color),
          fontWeight: { value: 700 },
          fontSize: { signal: 'compact ? 12 : 13' },
        },
      },
    },
    {
      type: 'text',
      encode: {
        update: {
          x: { signal: 'plotLeft - 18' },
          y: { signal: `${row.y} + 20` },
          text: { signal: row.offset },
          align: { value: 'right' },
          baseline: { value: 'middle' },
          fill: color('muted'),
          fontSize: { signal: 'compact ? 8 : 10' },
          limit: { signal: 'compact ? 96 : 160' },
        },
      },
    },
    {
      type: 'text',
      encode: {
        update: {
          x: { signal: 'plotLeft - 18' },
          y: { signal: `${row.y} + 36` },
          text: { signal: row.interval },
          align: { value: 'right' },
          baseline: { value: 'middle' },
          fill: color('muted'),
          fontSize: { signal: 'compact ? 8 : 10' },
          limit: { signal: 'compact ? 96 : 160' },
        },
      },
    },
  ]) as NonNullable<Spec['marks']>;
}

function topGuideMarks(copy: ClosedLoopTimingCopy): NonNullable<Spec['marks']> {
  return [
    {
      type: 'rule',
      encode: {
        update: {
          x: { scale: 'time', value: 4 },
          x2: { scale: 'time', signal: 'decisionTime - 4' },
          y: { value: 48 },
          stroke: color('muted'),
          strokeOpacity: { value: 0.72 },
          strokeWidth: { value: 1.2 },
          opacity: { signal: 'decisionTime > 9 ? 1 : 0' },
        },
      },
    },
    {
      type: 'symbol',
      encode: {
        update: {
          x: { scale: 'time', signal: 'decisionTime - 4' },
          y: { value: 48 },
          shape: { value: 'triangle-right' },
          size: { value: 55 },
          fill: color('muted'),
          opacity: { signal: 'decisionTime > 9 ? 1 : 0' },
        },
      },
    },
    {
      type: 'rule',
      encode: {
        update: {
          x: { scale: 'time', signal: 'decisionTime + 4' },
          x2: { scale: 'time', value: 96 },
          y: { value: 48 },
          stroke: color('muted'),
          strokeOpacity: { value: 0.72 },
          strokeWidth: { value: 1.2 },
          opacity: { signal: 'decisionTime < 91 ? 1 : 0' },
        },
      },
    },
    {
      type: 'symbol',
      encode: {
        update: {
          x: { scale: 'time', signal: 'decisionTime + 4' },
          y: { value: 48 },
          shape: { value: 'triangle-left' },
          size: { value: 55 },
          fill: color('muted'),
          opacity: { signal: 'decisionTime < 91 ? 1 : 0' },
        },
      },
    },
    {
      type: 'text',
      encode: {
        update: {
          x: {
            signal: "(scale('time', 4) + scale('time', decisionTime - 4)) / 2",
          },
          y: { value: 29 },
          text: { value: copy.past },
          align: { value: 'center' },
          fill: color('muted'),
          fontStyle: { value: 'italic' },
          fontSize: { value: 12 },
          opacity: { signal: 'decisionTime > 9 ? 1 : 0' },
        },
      },
    },
    {
      type: 'text',
      encode: {
        update: {
          x: {
            signal: "(scale('time', decisionTime + 4) + scale('time', 96)) / 2",
          },
          y: { value: 29 },
          text: { value: copy.future },
          align: { value: 'center' },
          fill: color('muted'),
          fontStyle: { value: 'italic' },
          fontSize: { value: 12 },
          opacity: { signal: 'decisionTime < 91 ? 1 : 0' },
        },
      },
    },
  ] as NonNullable<Spec['marks']>;
}

function bottomGuideMarks(copy: ClosedLoopTimingCopy): NonNullable<Spec['marks']> {
  return [
    {
      type: 'rule',
      encode: {
        update: {
          x: { signal: 'plotLeft' },
          x2: { signal: 'plotRight' },
          y: { signal: 'baselineY' },
          stroke: color('muted'),
          strokeOpacity: { value: 0.75 },
          strokeDash: { value: [7, 4, 2, 4] },
          strokeWidth: { value: 1.3 },
        },
      },
    },
    {
      type: 'text',
      encode: {
        update: {
          x: { scale: 'time', value: 0 },
          y: { signal: 'baselineY + 22' },
          text: { value: '0 ms' },
          align: { value: 'center' },
          fill: color('muted'),
          fontSize: { value: 11 },
        },
      },
    },
    {
      type: 'text',
      encode: {
        update: {
          x: { scale: 'time', value: 100 },
          y: { signal: 'baselineY + 22' },
          text: { value: '100 ms' },
          align: { value: 'center' },
          fill: color('muted'),
          fontSize: { value: 11 },
        },
      },
    },
    {
      type: 'text',
      encode: {
        update: {
          x: { signal: '(plotLeft + plotRight) / 2' },
          y: { signal: 'baselineY + 22' },
          text: { value: copy.timeAxis },
          align: { value: 'center' },
          fill: color('muted'),
          fontSize: { value: 11 },
        },
      },
    },
    ...[0, 100].map((time) => ({
      name: `timeBoundary${time}`,
      type: 'rule',
      encode: {
        update: {
          x: { scale: 'time', value: time },
          y: { signal: 'decisionPrimaryY - 16' },
          y2: { signal: 'baselineY' },
          stroke: color('muted'),
          strokeOpacity: { value: 0.72 },
          strokeDash: { value: [7, 7] },
          strokeWidth: { value: 1.15 },
        },
      },
    })),
  ] as NonNullable<Spec['marks']>;
}

function samplePoints(
  name: string,
  data: string,
  ySignal: string,
  colorSignal: string,
): NonNullable<Spec['marks']>[number] {
  const activeDrag =
    data === 'decisions'
      ? "dragKind === 'decision-time' || dragKind === 'decision-interval'"
      : data === 'feedback'
        ? "dragKind === 'feedback-offset' || dragKind === 'feedback-interval'"
        : "dragKind === 'application-offset' || dragKind === 'application-interval'";
  return {
    name,
    type: 'symbol',
    from: { data },
    encode: {
      update: {
        x: { scale: 'time', field: 'time' },
        y: { signal: ySignal },
        size: {
          signal:
            `((${activeDrag}) && datum.index === dragIndex) ? 170 : ` +
            `clamp(190 - length(data('${data}')) * 2.5, 55, 125)`,
        },
        fill: color('surface'),
        stroke: color(colorSignal),
        strokeWidth: { value: 2.2 },
        cursor: { value: 'grab' },
        zindex: { value: 2 },
      },
      hover: {
        size: { value: 170 },
        strokeWidth: { value: 3 },
      },
    },
  };
}

function projectionStems(
  name: string,
  data: string,
  ySignal: string,
  y2Signal: string,
  colorSignal: string,
): NonNullable<Spec['marks']>[number] {
  return {
    name,
    type: 'rule',
    from: { data },
    encode: {
      update: {
        x: { scale: 'time', field: 'time' },
        y: { signal: `${ySignal} - 4` },
        y2: { signal: `${y2Signal} + 4` },
        stroke: color(colorSignal),
        strokeOpacity: {
          signal: `length(data('${data}')) <= 20 ? 0.24 : length(data('${data}')) <= 40 ? 0.16 : 0.1`,
        },
        strokeWidth: { value: 1 },
      },
    },
  };
}

function timelineRail(
  name: string,
  ySignal: string,
  secondary: boolean,
): NonNullable<Spec['marks']>[number] {
  return {
    name,
    type: 'rule',
    encode: {
      update: {
        x: { signal: 'plotLeft' },
        x2: { signal: 'plotRight' },
        y: { signal: ySignal },
        stroke: color('line'),
        strokeOpacity: { value: secondary ? 0.34 : 1 },
        strokeWidth: { value: secondary ? 1 : 1.5 },
      },
    },
  };
}

function availabilityPoints(
  name: string,
  data: string,
  ySignal: string,
  colorSignal: string,
  shape: 'triangle-up' | 'triangle-down',
): NonNullable<Spec['marks']>[number] {
  const activeDrag =
    data === 'commandAvailability'
      ? "dragKind === 'command-delay'"
      : "dragKind === 'feedback-delay'";
  return {
    name,
    type: 'symbol',
    from: { data },
    encode: {
      enter: {
        shape: { value: shape },
      },
      update: {
        x: { scale: 'time', field: 'time' },
        y: { signal: ySignal },
        size: { signal: `(${activeDrag}) && datum.index === dragIndex ? 120 : 72` },
        fill: [{ test: 'datum.selected', signal: colorSignal }, { signal: 'surface' }],
        stroke: color(colorSignal),
        strokeWidth: { value: 1.7 },
        cursor: { value: 'ew-resize' },
        zindex: { value: 3 },
      },
      hover: { size: { value: 125 }, strokeWidth: { value: 2.5 } },
    },
  };
}

function liveTooltipMarks(): NonNullable<Spec['marks']> {
  return [
    {
      name: 'liveTimingTooltip',
      type: 'group',
      from: { data: 'tooltipState' },
      interactive: false,
      encode: {
        update: {
          x: { signal: 'clamp(hoverX + 14, 8, width - 238)' },
          y: { signal: 'clamp(hoverY - 54, 8, height - 116)' },
          width: { value: 230 },
          height: { value: 108 },
        },
      },
      marks: [
        {
          type: 'rect',
          encode: {
            update: {
              x: { value: 0 },
              y: { value: 0 },
              width: { value: 230 },
              height: { value: 108 },
              cornerRadius: { value: 9 },
              fill: color('surface'),
              fillOpacity: { value: 0.96 },
              stroke: color('line'),
              strokeWidth: { value: 1 },
            },
          },
        },
        {
          type: 'text',
          encode: {
            update: {
              x: { value: 12 },
              y: { value: 18 },
              text: { signal: 'tooltipTitle' },
              fill: color('ink'),
              fontSize: { value: 12 },
              fontWeight: { value: 700 },
            },
          },
        },
        ...[
          ['tooltipLine1', 40, 'muted'],
          ['tooltipLine2', 57, 'muted'],
          ['tooltipLine3', 74, 'muted'],
          ['tooltipLine4', 94, 'decisionColor'],
        ].map(([signal, y, fill]) => ({
          type: 'text',
          encode: {
            update: {
              x: { value: 12 },
              y: { value: y },
              text: { signal },
              fill: color(String(fill)),
              fontSize: { value: 10 },
              limit: { value: 206 },
            },
          },
        })),
      ],
    },
  ] as NonNullable<Spec['marks']>;
}

function currentDecisionMarks(copy: ClosedLoopTimingCopy): NonNullable<Spec['marks']> {
  return [
    {
      type: 'rule',
      encode: {
        update: {
          x: { scale: 'time', signal: 'decisionTime' },
          y: { value: 58 },
          y2: { signal: 'decisionPrimaryY - 18' },
          stroke: color('decisionColor'),
          strokeWidth: { value: 2 },
        },
      },
    },
    {
      type: 'symbol',
      encode: {
        update: {
          x: { scale: 'time', signal: 'decisionTime' },
          y: { signal: 'decisionPrimaryY - 18' },
          shape: { value: 'triangle-down' },
          size: { value: 78 },
          fill: color('decisionColor'),
        },
      },
    },
    {
      type: 'text',
      encode: {
        update: {
          x: { scale: 'time', signal: 'decisionTime' },
          y: { value: 43 },
          text: { value: copy.currentDecision },
          align: { value: 'center' },
          baseline: { value: 'bottom' },
          fill: color('decisionColor'),
          fontWeight: { value: 700 },
          fontSize: { signal: 'compact ? 11 : 13' },
        },
      },
    },
  ] as NonNullable<Spec['marks']>;
}

function delayDimensionMarks(copy: ClosedLoopTimingCopy): NonNullable<Spec['marks']> {
  const dimensions = [
    {
      name: 'feedback',
      x: 'currentFeedbackTime',
      x2: 'currentFeedbackTime + feedbackDelay',
      y: 'baselineY - 39',
      sourceY: 'feedbackY',
      targetY: 'decisionAvailabilityY',
      color: 'feedbackColor',
      label: `${literal(copy.feedbackDelay)} + ' ' + format(feedbackDelay, '.1f') + ' ms'`,
      valid: `currentFeedbackTime >= ${VIEW_START} && currentFeedbackTime + feedbackDelay < decisionTime - 1e-9`,
    },
    {
      name: 'command',
      x: 'decisionTime',
      x2: 'decisionTime + commandDelay',
      y: 'baselineY - 17',
      sourceY: 'decisionPrimaryY',
      targetY: 'applicationAvailabilityY',
      color: 'decisionColor',
      label: `${literal(copy.transmissionDelay)} + ' ' + format(commandDelay, '.1f') + ' ms'`,
      valid: `decisionTime + commandDelay <= ${VIEW_END}`,
    },
  ];

  return dimensions.flatMap((dimension) => [
    {
      name: `${dimension.name}DelayDimension`,
      type: 'rule',
      encode: {
        update: {
          x: { scale: 'time', signal: dimension.x },
          x2: { scale: 'time', signal: dimension.x2 },
          y: { signal: dimension.y },
          stroke: color(dimension.color),
          strokeWidth: { value: 1.2 },
          opacity: { signal: `${dimension.valid} ? 0.82 : 0` },
        },
      },
    },
    {
      name: `${dimension.name}DelaySourceGuide`,
      type: 'rule',
      encode: {
        update: {
          x: { scale: 'time', signal: dimension.x },
          y: { signal: dimension.sourceY },
          y2: { signal: 'baselineY' },
          stroke: color(dimension.color),
          strokeOpacity: { signal: `${dimension.valid} ? 0.68 : 0` },
          strokeDash: { value: [3, 4] },
          strokeWidth: { value: 1.05 },
        },
      },
    },
    {
      name: `${dimension.name}DelayTargetGuide`,
      type: 'rule',
      encode: {
        update: {
          x: { scale: 'time', signal: dimension.x2 },
          y: { signal: dimension.targetY },
          y2: { signal: 'baselineY' },
          stroke: color(dimension.color),
          strokeOpacity: { signal: `${dimension.valid} ? 0.68 : 0` },
          strokeDash: { value: [3, 4] },
          strokeWidth: { value: 1.05 },
        },
      },
    },
    {
      type: 'text',
      encode: {
        update: {
          x: {
            signal: `(scale('time', ${dimension.x}) + scale('time', ${dimension.x2})) / 2`,
          },
          y: { signal: `${dimension.y} - 6` },
          text: { signal: dimension.label },
          align: { value: 'center' },
          baseline: { value: 'bottom' },
          fill: color(dimension.color),
          fontSize: { signal: 'compact ? 8 : 10' },
          opacity: { signal: `${dimension.valid} ? 1 : 0` },
        },
      },
    },
  ]) as NonNullable<Spec['marks']>;
}
