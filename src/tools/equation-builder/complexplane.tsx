/**
 * An Argand-plane view for one complex value and, optionally, a
 * real-parameter path through the complex plane.
 *
 * This component deliberately owns only the structural { re, im } shape.
 * The equation engine may supply that shape from any exact or numerical
 * scalar implementation without coupling the view to it.
 */
import {
  useId,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

const W = 680;
const H = 360;
const PAD_X = 46;
const PAD_Y = 30;
const MIN_HALF_SPAN = 1;
const DIRECT_INPUT_HALF_SPAN = 6;
const DEFAULT_PATH_SAMPLES = 241;
const AUTO_VIEW_PADDING = 1.18;
const PLOT_ASPECT = (W - 2 * PAD_X) / (H - 2 * PAD_Y);

export interface ComplexValue {
  re: number;
  im: number;
}

export interface ComplexPathSpec {
  /** Evaluate the path z(t) at a real parameter value. */
  valueAt: (parameter: number) => ComplexValue;
  parameter: number;
  min: number;
  max: number;
  onParameterChange?: (parameter: number) => void;
  parameterLabel?: string;
  sampleCount?: number;
}

export interface ComplexPlaneProps {
  value: ComplexValue;
  /** Directly manipulate the input point. Ignored while a path is present. */
  onValueChange?: (value: ComplexValue) => void;
  path?: ComplexPathSpec;
  /**
   * Fixed world-space distance from the origin to the plot's top/bottom edge.
   * The real axis remains wider by the SVG aspect ratio, preserving equal
   * geometric scale. Give linked planes the same value for comparable vectors.
   */
  viewportHalfSpan?: number;
  valueLabel?: string;
  className?: string;
  ariaLabel?: string;
}

interface PathSample {
  parameter: number;
  value: ComplexValue;
  breakBefore: boolean;
}

const finiteComplex = (value: ComplexValue): boolean =>
  Number.isFinite(value.re) && Number.isFinite(value.im);

const safePathValue = (path: ComplexPathSpec, parameter: number): ComplexValue | null => {
  try {
    const value = path.valueAt(parameter);
    return finiteComplex(value) ? value : null;
  } catch {
    return null;
  }
};

const fmt = (value: number, digits = 3): string => {
  if (!Number.isFinite(value)) return "undefined";
  const rounded = Math.abs(value) < 10 ** -(digits + 1) ? 0 : Number(value.toFixed(digits));
  return String(rounded).replace("-", "−");
};

const fmtComplex = ({ re, im }: ComplexValue): string => {
  if (!finiteComplex({ re, im })) return "undefined";
  if (Math.abs(im) < 1e-10) return fmt(re);
  const imaginaryMagnitude = Math.abs(im);
  const imaginary = Math.abs(imaginaryMagnitude - 1) < 1e-10 ? "i" : `${fmt(imaginaryMagnitude)}i`;
  if (Math.abs(re) < 1e-10) return im < 0 ? `−${imaginary}` : imaginary;
  return `${fmt(re)} ${im < 0 ? "−" : "+"} ${imaginary}`;
};

const quantile = (values: number[], proportion: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * proportion))];
};

/**
 * Smallest padded, origin-centred viewport that contains the supplied points.
 * The returned number is the imaginary-axis half-span; equal SVG scaling
 * derives the wider real-axis half-span from it.
 */
export const complexViewportHalfSpan = (
  values: readonly ComplexValue[],
  minimum = MIN_HALF_SPAN,
): number => {
  const safeMinimum = Math.max(
    MIN_HALF_SPAN,
    Number.isFinite(minimum) ? minimum : MIN_HALF_SPAN,
  );
  let required = 0;
  for (const value of values) {
    if (!finiteComplex(value)) continue;
    required = Math.max(required, Math.abs(value.im), Math.abs(value.re) / PLOT_ASPECT);
  }
  return Math.max(safeMinimum, required * AUTO_VIEW_PADDING);
};

const niceStep = (span: number, targetTickCount = 7): number => {
  const raw = span / targetTickCount;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, Number.EPSILON)));
  return ([1, 2, 5, 10].map((multiple) => multiple * magnitude).find((step) => raw <= step) ??
    10 * magnitude);
};

const ticksBetween = (min: number, max: number, step: number): number[] => {
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-8; value += step) {
    const normalized = Math.abs(value) < step * 1e-8 ? 0 : value;
    ticks.push(normalized);
    if (ticks.length > 30) break;
  }
  return ticks;
};

/**
 * Responsive complex-plane visualization.
 *
 * When `path.onParameterChange` is supplied, both direct manipulation on the
 * plane and the native range control update the controlled path parameter.
 */
export function ComplexPlane({
  value,
  onValueChange,
  path,
  viewportHalfSpan,
  valueLabel = "z",
  className = "",
  ariaLabel,
}: ComplexPlaneProps) {
  const generatedId = useId().replace(/:/g, "");
  const titleId = `complex-plane-title-${generatedId}`;
  const descriptionId = `complex-plane-description-${generatedId}`;
  const clipId = `complex-plane-clip-${generatedId}`;
  const arrowId = `complex-plane-arrow-${generatedId}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const directViewport = useRef<number | null>(null);
  const valueInteractive = !path && Boolean(onValueChange);

  const sampledPath = useMemo<PathSample[]>(() => {
    if (!path || !Number.isFinite(path.min) || !Number.isFinite(path.max) || path.min === path.max) return [];
    const min = Math.min(path.min, path.max);
    const max = Math.max(path.min, path.max);
    const sampleCount = Math.max(16, Math.min(801, Math.round(path.sampleCount ?? DEFAULT_PATH_SAMPLES)));
    const samples: PathSample[] = [];
    let breakBefore = false;
    for (let index = 0; index < sampleCount; index++) {
      const parameter = min + ((max - min) * index) / (sampleCount - 1);
      const pathValue = safePathValue(path, parameter);
      if (pathValue) {
        samples.push({ parameter, value: pathValue, breakBefore });
        breakBefore = false;
      } else {
        breakBefore = true;
      }
    }
    return samples;
    // The controlled parameter and callback do not change the path's shape.
    // Keeping them out prevents a 241-point resample on every pointer event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path?.valueAt, path?.min, path?.max, path?.sampleCount]);

  const pathViewport = useMemo(() => {
    if (sampledPath.length === 0) return complexViewportHalfSpan([]);
    const robustPoint = {
      re: quantile(sampledPath.map((sample) => Math.abs(sample.value.re)), 0.97),
      im: quantile(sampledPath.map((sample) => Math.abs(sample.value.im)), 0.97),
    };
    return complexViewportHalfSpan([robustPoint]);
  }, [sampledPath]);

  const automaticViewport = Math.max(
    complexViewportHalfSpan(
      [value],
      valueInteractive ? DIRECT_INPUT_HALF_SPAN : MIN_HALF_SPAN,
    ),
    pathViewport,
  );
  if (valueInteractive) {
    // A controlled update must not alter the coordinate transform under the
    // active finger. The initial view remains stable for this mounted input
    // plane; callers can intentionally reset it by remounting or passing an
    // explicit shared viewport.
    directViewport.current ??= automaticViewport;
  } else {
    directViewport.current = null;
  }
  const fixedViewport =
    Number.isFinite(viewportHalfSpan) && (viewportHalfSpan ?? 0) > 0
      ? viewportHalfSpan!
      : valueInteractive
        ? directViewport.current!
        : automaticViewport;

  const plot = useMemo(() => {
    const plotWidth = W - 2 * PAD_X;
    const plotHeight = H - 2 * PAD_Y;
    const scale = plotHeight / (2 * fixedViewport);
    const halfReal = plotWidth / (2 * scale);
    const halfImaginary = plotHeight / (2 * scale);
    const centerX = W / 2;
    const centerY = H / 2;
    const px = (real: number) => centerX + real * scale;
    const py = (imaginary: number) => centerY - imaginary * scale;

    const realStep = niceStep(2 * halfReal);
    const imaginaryStep = niceStep(2 * halfImaginary);
    const realTicks = ticksBetween(-halfReal, halfReal, realStep);
    const imaginaryTicks = ticksBetween(-halfImaginary, halfImaginary, imaginaryStep);

    const paths: string[] = [];
    let segment: string[] = [];
    let previous: ComplexValue | null = null;
    for (const sample of sampledPath) {
      const { re, im } = sample.value;
      const inUsefulWindow = Math.abs(re) <= halfReal * 1.5 && Math.abs(im) <= halfImaginary * 1.5;
      const jump =
        sample.breakBefore ||
        (previous !== null &&
          Math.hypot(px(re) - px(previous.re), py(im) - py(previous.im)) >
            Math.hypot(plotWidth, plotHeight) * 0.45);
      if (inUsefulWindow && !jump) {
        segment.push(`${segment.length === 0 ? "M" : "L"}${px(re).toFixed(2)} ${py(im).toFixed(2)}`);
      } else {
        if (segment.length > 1) paths.push(segment.join(" "));
        segment = inUsefulWindow ? [`M${px(re).toFixed(2)} ${py(im).toFixed(2)}`] : [];
      }
      previous = sample.value;
    }
    if (segment.length > 1) paths.push(segment.join(" "));

    return {
      centerX,
      centerY,
      halfReal,
      halfImaginary,
      imaginaryTicks,
      paths,
      plotHeight,
      plotWidth,
      px,
      py,
      realTicks,
      scale,
    };
  }, [fixedViewport, sampledPath]);

  const modulus = finiteComplex(value) ? Math.hypot(value.re, value.im) : Number.NaN;
  const argumentValue = finiteComplex(value) && modulus > 1e-12 ? Math.atan2(value.im, value.re) : Number.NaN;
  const parameterLabel = path?.parameterLabel ?? "t";
  const pathMin = path ? Math.min(path.min, path.max) : 0;
  const pathMax = path ? Math.max(path.min, path.max) : 0;
  const pathInteractive = Boolean(
    path?.onParameterChange && Number.isFinite(pathMin) && Number.isFinite(pathMax) && pathMax > pathMin,
  );
  const interactive = pathInteractive || valueInteractive;

  const pointerCoordinates = (event: ReactPointerEvent<SVGRectElement>) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * W,
      y: ((event.clientY - rect.top) / rect.height) * H,
    };
  };

  const updateFromPointer = (event: ReactPointerEvent<SVGRectElement>) => {
    const pointer = pointerCoordinates(event);
    if (!pointer) return;

    if (valueInteractive && onValueChange) {
      const pointerX = Math.max(PAD_X, Math.min(W - PAD_X, pointer.x));
      const pointerY = Math.max(PAD_Y, Math.min(H - PAD_Y, pointer.y));
      onValueChange({
        re: (pointerX - plot.centerX) / plot.scale,
        im: (plot.centerY - pointerY) / plot.scale,
      });
      return;
    }

    if (!path?.onParameterChange || sampledPath.length === 0) return;
    const pointerX = pointer.x;
    const pointerY = pointer.y;
    let nearestParameter = sampledPath[0].parameter;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;

    for (let index = 0; index < sampledPath.length - 1; index++) {
      const from = sampledPath[index];
      const to = sampledPath[index + 1];
      if (to.breakBefore) continue;
      const x1 = plot.px(from.value.re);
      const y1 = plot.py(from.value.im);
      const x2 = plot.px(to.value.re);
      const y2 = plot.py(to.value.im);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared === 0 || Math.sqrt(lengthSquared) > Math.hypot(plot.plotWidth, plot.plotHeight) * 0.45) continue;
      const projection = Math.max(
        0,
        Math.min(1, ((pointerX - x1) * dx + (pointerY - y1) * dy) / lengthSquared),
      );
      const projectedX = x1 + projection * dx;
      const projectedY = y1 + projection * dy;
      const distanceSquared = (pointerX - projectedX) ** 2 + (pointerY - projectedY) ** 2;
      if (distanceSquared < nearestDistanceSquared) {
        nearestDistanceSquared = distanceSquared;
        nearestParameter = from.parameter + projection * (to.parameter - from.parameter);
      }
    }
    path.onParameterChange(nearestParameter);
  };

  const pointerDown = (event: ReactPointerEvent<SVGRectElement>) => {
    if (!interactive || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  };

  const pointerMove = (event: ReactPointerEvent<SVGRectElement>) => {
    if (!dragging.current) return;
    event.preventDefault();
    updateFromPointer(event);
  };

  const pointerUp = (event: ReactPointerEvent<SVGRectElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const keyboardMove = (event: ReactKeyboardEvent<SVGRectElement>) => {
    if (!valueInteractive || !onValueChange) return;
    const multiplier = event.shiftKey ? 5 : 1;
    const realStep = niceStep(plot.halfReal * 2) / 10;
    const imaginaryStep = niceStep(plot.halfImaginary * 2) / 10;
    let next = value;
    if (event.key === "ArrowLeft") next = { ...value, re: value.re - realStep * multiplier };
    else if (event.key === "ArrowRight") next = { ...value, re: value.re + realStep * multiplier };
    else if (event.key === "ArrowDown") next = { ...value, im: value.im - imaginaryStep * multiplier };
    else if (event.key === "ArrowUp") next = { ...value, im: value.im + imaginaryStep * multiplier };
    else return;
    event.preventDefault();
    onValueChange(next);
  };

  const pointX = plot.px(value.re);
  const pointY = plot.py(value.im);
  const pointVisible =
    finiteComplex(value) && Math.abs(value.re) <= plot.halfReal * 1.02 && Math.abs(value.im) <= plot.halfImaginary * 1.02;
  const vectorLength = pointVisible ? Math.hypot(pointX - plot.centerX, pointY - plot.centerY) : 0;
  const angleRadius = Math.min(38, Math.max(15, vectorLength * 0.28));
  const angleEndX = plot.centerX + angleRadius * Math.cos(argumentValue);
  const angleEndY = plot.centerY - angleRadius * Math.sin(argumentValue);
  const angleArc =
    Number.isFinite(argumentValue) && vectorLength > 18
      ? `M ${plot.centerX + angleRadius} ${plot.centerY} A ${angleRadius} ${angleRadius} 0 0 ${
          argumentValue >= 0 ? 0 : 1
        } ${angleEndX} ${angleEndY}`
      : null;
  const defaultAriaLabel = `Complex plane showing ${valueLabel} equals ${fmtComplex(value)}. Real part ${fmt(
    value.re,
  )}, imaginary part ${fmt(value.im)}, modulus ${fmt(modulus)}, principal argument ${
    Number.isFinite(argumentValue) ? `${fmt(argumentValue)} radians` : "undefined at zero"
  }.`;

  return (
    <figure
      className={`flex w-full select-none flex-col items-center gap-2 ${className}`}
      data-ui
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-[min(680px,92vw)] max-w-full"
        style={{ touchAction: "pan-y" }}
        data-viewport-half-span={fixedViewport}
        data-units-per-pixel={1 / plot.scale}
        role={interactive ? "group" : "img"}
        aria-label={ariaLabel ?? defaultAriaLabel}
      >
        <title id={titleId}>{`Complex plane for ${valueLabel}`}</title>
        <desc id={descriptionId}>
          The horizontal axis is the real component and the vertical axis is the imaginary component. The amber
          vector ends at {fmtComplex(value)}.
        </desc>
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD_X} y={PAD_Y} width={plot.plotWidth} height={plot.plotHeight} rx="8" />
          </clipPath>
          <marker id={arrowId} viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" className="fill-amber-500" />
          </marker>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {/* quiet square grid */}
          {plot.realTicks
            .filter((tick) => tick !== 0)
            .map((tick) => (
              <line
                key={`real-grid-${tick}`}
                x1={plot.px(tick)}
                y1={PAD_Y}
                x2={plot.px(tick)}
                y2={H - PAD_Y}
                className="stroke-muted-foreground/10"
                strokeWidth="1"
              />
            ))}
          {plot.imaginaryTicks
            .filter((tick) => tick !== 0)
            .map((tick) => (
              <line
                key={`imag-grid-${tick}`}
                x1={PAD_X}
                y1={plot.py(tick)}
                x2={W - PAD_X}
                y2={plot.py(tick)}
                className="stroke-muted-foreground/10"
                strokeWidth="1"
              />
            ))}

          {/* optional z(t) path */}
          {plot.paths.map((pathData, index) => (
            <path
              key={`complex-path-${index}`}
              d={pathData}
              fill="none"
              className="stroke-foreground/55"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* coordinate projections */}
          {pointVisible && (
            <>
              <line
                x1={pointX}
                y1={pointY}
                x2={pointX}
                y2={plot.centerY}
                className="stroke-amber-500/40"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              <line
                x1={pointX}
                y1={pointY}
                x2={plot.centerX}
                y2={pointY}
                className="stroke-amber-500/40"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            </>
          )}
        </g>

        {/* axes and tick labels */}
        <line
          x1={PAD_X}
          y1={plot.centerY}
          x2={W - PAD_X}
          y2={plot.centerY}
          className="stroke-muted-foreground/45"
          strokeWidth="1.2"
        />
        <line
          x1={plot.centerX}
          y1={PAD_Y}
          x2={plot.centerX}
          y2={H - PAD_Y}
          className="stroke-muted-foreground/45"
          strokeWidth="1.2"
        />
        {plot.realTicks.map((tick) => (
          <g key={`real-tick-${tick}`}>
            <line
              x1={plot.px(tick)}
              y1={plot.centerY - 3}
              x2={plot.px(tick)}
              y2={plot.centerY + 3}
              className="stroke-muted-foreground/55"
              strokeWidth="1"
            />
            <text
              x={plot.px(tick)}
              y={plot.centerY + 15}
              textAnchor="middle"
              className="fill-muted-foreground/70 text-[9px]"
            >
              {fmt(tick)}
            </text>
          </g>
        ))}
        {plot.imaginaryTicks
          .filter((tick) => tick !== 0)
          .map((tick) => (
            <g key={`imaginary-tick-${tick}`}>
              <line
                x1={plot.centerX - 3}
                y1={plot.py(tick)}
                x2={plot.centerX + 3}
                y2={plot.py(tick)}
                className="stroke-muted-foreground/55"
                strokeWidth="1"
              />
              <text
                x={plot.centerX - 7}
                y={plot.py(tick) + 3}
                textAnchor="end"
                className="fill-muted-foreground/70 text-[9px]"
              >
                {fmt(tick)}
              </text>
            </g>
          ))}
        <text
          x={W - PAD_X + 7}
          y={plot.centerY + 4}
          className="fill-muted-foreground text-[11px]"
          fontFamily="serif"
          fontStyle="italic"
        >
          Re
        </text>
        <text
          x={plot.centerX + 7}
          y={PAD_Y - 8}
          className="fill-muted-foreground text-[11px]"
          fontFamily="serif"
          fontStyle="italic"
        >
          Im
        </text>

        {/* selected value and its argument */}
        {pointVisible && (
          <g>
            {vectorLength > 2 && (
              <line
                x1={plot.centerX}
                y1={plot.centerY}
                x2={pointX}
                y2={pointY}
                className="stroke-amber-500"
                strokeWidth="1.8"
                markerEnd={`url(#${arrowId})`}
              />
            )}
            {angleArc && (
              <path
                d={angleArc}
                fill="none"
                className="stroke-amber-500/65"
                strokeWidth="1.2"
                strokeDasharray="2 2"
              />
            )}
            <circle cx={pointX} cy={pointY} r="8" className="fill-amber-500/15" />
            <circle cx={pointX} cy={pointY} r="4.5" className="fill-amber-500 stroke-background" strokeWidth="1.5" />
            <text
              x={pointX + (value.re < 0 ? -10 : 10)}
              y={pointY - 9}
              textAnchor={value.re < 0 ? "end" : "start"}
              className="fill-amber-600 text-[11px]"
              fontFamily="serif"
              fontStyle="italic"
            >
              {valueLabel}
            </text>
            <text
              x={pointX}
              y={plot.centerY + (value.im >= 0 ? 15 : -8)}
              textAnchor="middle"
              className="fill-amber-600/80 text-[9px]"
            >
              {fmt(value.re)}
            </text>
            <text
              x={plot.centerX + (value.re >= 0 ? -7 : 7)}
              y={pointY + 3}
              textAnchor={value.re >= 0 ? "end" : "start"}
              className="fill-amber-600/80 text-[9px]"
            >
              {fmt(value.im)}
            </text>
          </g>
        )}

        {/* Only the plotted rectangle captures touch. Axis labels and the rest
            of the figure retain ordinary page scrolling on iOS. */}
        {interactive && (
          <rect
            x={PAD_X}
            y={PAD_Y}
            width={plot.plotWidth}
            height={plot.plotHeight}
            rx="8"
            fill="transparent"
            className="cursor-crosshair stroke-transparent focus:stroke-amber-500/60 focus:outline-none"
            strokeWidth="2"
            strokeDasharray="5 4"
            style={{ touchAction: "none" }}
            tabIndex={valueInteractive ? 0 : undefined}
            role={valueInteractive ? "group" : undefined}
            aria-roledescription={valueInteractive ? "complex-plane control" : undefined}
            aria-label={
              valueInteractive
                ? `Move ${valueLabel} on the complex plane. Use the arrow keys for precise movement; hold Shift for larger steps.`
                : undefined
            }
            aria-keyshortcuts={valueInteractive ? "ArrowUp ArrowDown ArrowLeft ArrowRight" : undefined}
            onKeyDown={keyboardMove}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onLostPointerCapture={() => {
              dragging.current = false;
            }}
          />
        )}
      </svg>

      <figcaption className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">
          <span className="font-serif italic">{valueLabel}</span> = {fmtComplex(value)}
        </span>
        {path && (
          <span>
            <span className="font-serif italic">{parameterLabel}</span> = {fmt(path.parameter)}
          </span>
        )}
      </figcaption>

      <dl className="grid w-[min(560px,92vw)] max-w-full grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-muted-foreground sm:grid-cols-4">
        <div className="flex items-baseline justify-between gap-2 sm:justify-center">
          <dt>Re</dt>
          <dd className="tabular-nums text-foreground">{fmt(value.re)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 sm:justify-center">
          <dt>Im</dt>
          <dd className="tabular-nums text-foreground">{fmt(value.im)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 sm:justify-center">
          <dt>modulus</dt>
          <dd className="tabular-nums text-foreground">{fmt(modulus)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 sm:justify-center">
          <dt>argument</dt>
          <dd className="tabular-nums text-foreground">
            {Number.isFinite(argumentValue) ? `${fmt(argumentValue)} rad` : "undefined"}
          </dd>
        </div>
      </dl>

      {interactive && path?.onParameterChange && (
        <label className="flex w-[min(560px,92vw)] max-w-full items-center gap-3 py-1 text-[10px] text-muted-foreground">
          <span className="shrink-0 font-serif italic">{parameterLabel}</span>
          <input
            type="range"
            min={pathMin}
            max={pathMax}
            step={(pathMax - pathMin) / 400}
            value={Math.max(pathMin, Math.min(pathMax, path.parameter))}
            onChange={(event) => path.onParameterChange?.(Number(event.currentTarget.value))}
            className="h-8 min-w-0 flex-1 cursor-pointer accent-amber-500"
            aria-label={`Move ${parameterLabel} along the complex path`}
          />
          <output className="w-14 text-right tabular-nums text-foreground">{fmt(path.parameter)}</output>
        </label>
      )}

      <span className="sr-only" aria-live="polite">
        {defaultAriaLabel}
      </span>
    </figure>
  );
}
