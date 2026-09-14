import { drag, dragEnable, type D3DragEvent } from 'd3-drag';
import { select } from 'd3-selection';
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import {
  angleDegrees,
  arcPath,
  clampMotionControlVehicle,
  deriveMotionControlScene,
  MOTION_CONTROL_INITIAL_POSITION,
  MOTION_CONTROL_MODEL,
  MOTION_CONTROL_VIEW_BOX,
  pointAlong,
  REFERENCE_PATH,
  type Point,
} from './motion-control-project-model';
import './motion-control-project-visual.css';

const UNIT_VECTOR_LENGTH = 58;

const MotionControlProjectVisual: Component = () => {
  let svg!: SVGSVGElement;
  let vehicleHandle!: SVGRectElement;
  const [vehicle, setVehicle] = createSignal<Point>({ ...MOTION_CONTROL_INITIAL_POSITION });
  const [dragging, setDragging] = createSignal(false);
  const scene = createMemo(() => deriveMotionControlScene(vehicle()));
  const markerPrefix = `motion-control-${createUniqueId().replaceAll(':', '-')}`;
  const marker = (name: string) => `url(#${markerPrefix}-${name})`;

  onMount(() => {
    let releaseMouseDrag: (() => void) | undefined;
    const behavior = drag<SVGRectElement, unknown, Point>()
      .container(svg)
      .touchable(true)
      .subject(() => ({ ...scene().vehicle }))
      .on('start', (event: D3DragEvent<SVGRectElement, unknown, Point>) => {
        event.sourceEvent.stopPropagation();
        if (event.identifier === 'mouse') {
          const view: Window = event.sourceEvent.view;
          const selection = select(view);
          // D3 installs these before start. Another instance may later take over.
          const move = selection.on('mousemove.drag');
          const up = selection.on('mouseup.drag');
          releaseMouseDrag = () => {
            if (selection.on('mousemove.drag') !== move || selection.on('mouseup.drag') !== up)
              return;
            selection.on('mousemove.drag mouseup.drag', null);
            dragEnable(view);
          };
        }
        setDragging(true);
      })
      .on('drag', (event: D3DragEvent<SVGRectElement, unknown, Point>) => {
        setVehicle(clampMotionControlVehicle({ x: event.x, y: event.y }));
      })
      .on('end', (event: D3DragEvent<SVGRectElement, unknown, Point>) => {
        if (event.identifier === 'mouse') releaseMouseDrag = undefined;
        setDragging(false);
      });

    select<SVGRectElement, unknown>(vehicleHandle).call(behavior);
    onCleanup(() => {
      select(vehicleHandle).on('.drag', null);
      releaseMouseDrag?.();
    });
  });

  const tangentEnd = () => pointAlong(scene().projection, scene().tangent, UNIT_VECTOR_LENGTH);
  const normalEnd = () => pointAlong(scene().projection, scene().normal, UNIT_VECTOR_LENGTH);
  const headingEnd = () => pointAlong(scene().vehicle, scene().heading, UNIT_VECTOR_LENGTH);

  return (
    <figure
      class="motion-control-project-visual"
      data-dragging={dragging() ? '' : undefined}
      data-vehicle-x={scene().vehicle.x.toFixed(3)}
      data-vehicle-y={scene().vehicle.y.toFixed(3)}
      data-heading-angle={scene().headingAngle.toFixed(6)}
      data-lateral-error={scene().lateralError.toFixed(6)}
      data-steering-angle={scene().steeringAngle.toFixed(6)}
    >
      <svg
        ref={svg}
        class="motion-control-project-visual-plot"
        viewBox={`0 0 ${MOTION_CONTROL_VIEW_BOX.width} ${MOTION_CONTROL_VIEW_BOX.height}`}
        aria-hidden="true"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id={`${markerPrefix}-tangent`}
            class="motion-control-marker-tangent"
            markerWidth="7"
            markerHeight="7"
            refX="6.2"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 7 3.5 L 0 7 Z" />
          </marker>
          <marker
            id={`${markerPrefix}-normal`}
            class="motion-control-marker-normal"
            markerWidth="7"
            markerHeight="7"
            refX="6.2"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 7 3.5 L 0 7 Z" />
          </marker>
          <marker
            id={`${markerPrefix}-geometry`}
            class="motion-control-marker-geometry"
            markerWidth="7"
            markerHeight="7"
            refX="6.2"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 7 3.5 L 0 7 Z" />
          </marker>
        </defs>

        <g class="motion-control-reference" aria-hidden="true">
          <path class="motion-control-reference-band" d={REFERENCE_PATH} />
          <path class="motion-control-reference-line" d={REFERENCE_PATH} />
        </g>

        <g class="motion-control-vehicle" aria-hidden="true">
          <g
            transform={`translate(${scene().vehicle.x} ${scene().vehicle.y}) rotate(${MOTION_CONTROL_MODEL.headingDegrees})`}
          >
            <rect
              class="motion-control-vehicle-body"
              x={-MOTION_CONTROL_MODEL.rearOverhang}
              y={-MOTION_CONTROL_MODEL.bodyWidth / 2}
              width={MOTION_CONTROL_MODEL.bodyLength}
              height={MOTION_CONTROL_MODEL.bodyWidth}
              rx="10"
            />
            <circle class="motion-control-vehicle-rear-axle-center" cx="0" cy="0" r="2.5" />
            <rect
              ref={vehicleHandle}
              class="motion-control-vehicle-handle"
              x={-MOTION_CONTROL_MODEL.rearOverhang - 6}
              y={-MOTION_CONTROL_MODEL.bodyWidth / 2 - 6}
              width={MOTION_CONTROL_MODEL.bodyLength + 12}
              height={MOTION_CONTROL_MODEL.bodyWidth + 12}
              rx="14"
              data-vehicle-drag-handle
            />
          </g>
          <For each={scene().wheels}>
            {(wheel) => (
              <g
                class="motion-control-wheel-assembly"
                transform={`translate(${wheel.center.x} ${wheel.center.y}) rotate(${angleDegrees(wheel.angle)})`}
                data-wheel-axle={wheel.axle}
                data-wheel-side={wheel.side}
                data-wheel-angle={wheel.angle.toFixed(6)}
              >
                <rect
                  class="motion-control-wheel-shadow"
                  x="-9.5"
                  y="-3.2"
                  width="19"
                  height="6.4"
                  rx="1.6"
                />
                <rect
                  class="motion-control-wheel"
                  x="-9.5"
                  y="-3.2"
                  width="19"
                  height="6.4"
                  rx="1.6"
                />
              </g>
            )}
          </For>
        </g>

        <g class="motion-control-geometry" aria-hidden="true">
          <line
            class="motion-control-error-line"
            x1={scene().projection.x}
            y1={scene().projection.y}
            x2={scene().vehicle.x}
            y2={scene().vehicle.y}
          />
          <line
            class="motion-control-tangent-line"
            x1={scene().projection.x}
            y1={scene().projection.y}
            x2={tangentEnd().x}
            y2={tangentEnd().y}
            marker-end={marker('tangent')}
          />
          <line
            class="motion-control-normal-line"
            x1={scene().projection.x}
            y1={scene().projection.y}
            x2={normalEnd().x}
            y2={normalEnd().y}
            marker-end={marker('normal')}
          />
          <line
            class="motion-control-translated-tangent"
            x1={pointAlong(scene().vehicle, scene().tangent, -14).x}
            y1={pointAlong(scene().vehicle, scene().tangent, -14).y}
            x2={pointAlong(scene().vehicle, scene().tangent, 58).x}
            y2={pointAlong(scene().vehicle, scene().tangent, 58).y}
          />
          <line
            class="motion-control-heading-line"
            x1={scene().vehicle.x}
            y1={scene().vehicle.y}
            x2={headingEnd().x}
            y2={headingEnd().y}
            marker-end={marker('geometry')}
          />
          <path
            class="motion-control-heading-error-arc"
            d={arcPath(scene().vehicle, 34, scene().pathAngle, scene().headingAngle)}
          />
          <circle
            class="motion-control-projection-point"
            cx={scene().projection.x}
            cy={scene().projection.y}
            r="5"
          />
          <circle
            class="motion-control-position-point"
            cx={scene().vehicle.x}
            cy={scene().vehicle.y}
            r="5"
          />
        </g>
      </svg>
    </figure>
  );
};

export default MotionControlProjectVisual;
