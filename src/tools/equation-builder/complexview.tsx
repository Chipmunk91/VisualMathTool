import { useCallback, useRef, useState } from "react";
import {
  ComplexPlane,
  complexViewportHalfSpan,
  type ComplexValue,
} from "./complexplane";
import type { ExplicitIsolation } from "./relation";
import {
  evalNode,
  evalScalarNode,
  keyOf,
  type TNode,
} from "./tree";
import {
  scalarParts,
  type ScalarEnvironment,
  type ScalarValue,
} from "./scalar";
import type {
  DomainRequirement,
  MappingSignatureCandidate,
  RangeAnalysis,
  ScalarOperationContext,
} from "./semantics";
import { expressionRequiresComplexScalars } from "./semantics";

export type ComplexDisplayMode = "cartesian" | "polar" | "exponential";

const roundedText = (value: number, digits = 4): string => {
  if (!Number.isFinite(value)) return "undefined";
  const rounded = Math.abs(value) < 10 ** -(digits + 1) ? 0 : Number(value.toFixed(digits));
  return String(rounded).replace("-", "−");
};

export const scalarPoint = (value: ScalarValue): ComplexValue => scalarParts(value);

/** The result carrier—not the arithmetic realm—decides whether an Argand value pane is useful. */
export const scalarHasComplexCarrier = (value: ScalarValue): boolean =>
  value.kind === "complex";

export const scalarText = (
  value: ScalarValue,
  mode: ComplexDisplayMode = "cartesian"
): string => {
  const { re, im } = scalarParts(value);
  if (mode === "cartesian") {
    if (Math.abs(im) < 1e-10) return roundedText(re);
    const magnitude = Math.abs(im);
    const imaginary = Math.abs(magnitude - 1) < 1e-10 ? "i" : `${roundedText(magnitude)}i`;
    if (Math.abs(re) < 1e-10) return im < 0 ? `−${imaginary}` : imaginary;
    return `${roundedText(re)} ${im < 0 ? "−" : "+"} ${imaginary}`;
  }

  const modulus = Math.hypot(re, im);
  if (modulus < 1e-12) return "0";
  const argument = Math.atan2(im, re);
  if (mode === "polar") {
    return `${roundedText(modulus)}(cos ${roundedText(argument)} + i sin ${roundedText(argument)})`;
  }
  return `${roundedText(modulus)}e^(i·${roundedText(argument)})`;
};

const evaluateScalar = (
  expression: TNode,
  environment: ScalarEnvironment
): ScalarValue | null => {
  const result = evalScalarNode(expression, environment);
  return result.ok ? result.value : null;
};

/**
 * Evaluate a graph sample through the scalar engine, including expressions
 * whose final value is real only after complex continuation (for example
 * |i·t| or Re(e^(i·t))).
 */
export const evaluateRealMappingValue = (
  expression: TNode,
  environment: ScalarEnvironment,
  operationContext?: ScalarOperationContext
): number => {
  const requiresComplexArithmetic =
    operationContext?.scalarRealm === "complex" ||
    expressionRequiresComplexScalars(expression);
  if (!requiresComplexArithmetic) {
    const realEnvironment: Record<string, number | undefined> = {};
    for (const [name, input] of Object.entries(environment)) {
      if (input === undefined || typeof input === "number") {
        realEnvironment[name] = input;
      } else if (input.kind === "real") {
        realEnvironment[name] = input.value;
      } else {
        return Number.NaN;
      }
    }
    const value = evalNode(expression, realEnvironment);
    return Number.isFinite(value) ? value : Number.NaN;
  }
  const result = evalScalarNode(expression, environment);
  return result.ok && result.value.kind === "real"
    ? result.value.value
    : Number.NaN;
};

const useStableComplexViewport = (
  identity: string,
  values: readonly ComplexValue[],
): number => {
  const viewport = useRef<{ identity: string; halfSpan: number } | null>(null);
  if (!viewport.current || viewport.current.identity !== identity) {
    viewport.current = {
      identity,
      // Six units matches the established probe window. Larger initial
      // inputs/outputs still expand the shared view before manipulation.
      halfSpan: complexViewportHalfSpan(values, 6),
    };
  }
  return viewport.current.halfSpan;
};

const realmGlyph = (space: MappingSignatureCandidate["output"]["space"]): string =>
  space === "real" ? "ℝ" : space === "complex" ? "ℂ" : "?";

const signatureLabel = (candidate: MappingSignatureCandidate): string => {
  const inputs =
    candidate.inputs.length === 1
      ? `${candidate.inputs[0].symbol} ∈ ${realmGlyph(candidate.inputs[0].space)}`
      : `(${candidate.inputs.map((input) => input.symbol).join(", ")}) ∈ ${realmGlyph(
          candidate.inputs[0]?.space ?? "unknown"
        )}^${candidate.inputs.length}`;
  return `${inputs} → ${candidate.output.symbol} ∈ ${realmGlyph(candidate.output.space)}`;
};

const rangeLabel = (range: RangeAnalysis): string | null => {
  if (range.status !== "exact") return null;
  const set = range.set;
  if (set.kind === "real") {
    return set.subset === "all"
      ? "range ℝ"
      : set.subset === "nonnegative"
        ? "range [0, ∞)"
        : "range (0, ∞)";
  }
  if (set.kind === "complex") {
    return set.subset === "all" ? "range ℂ" : "range ℂ ∖ {0}";
  }
  if (set.kind === "singleton" && set.value) return `range {${scalarText(set.value)}}`;
  return "constant range";
};

const requirementLabel = (requirement: DomainRequirement): string => {
  const prefix = requirement.appliesTo === "real" ? "real domain: " : "";
  if (requirement.kind === "excluded-values") {
    return `argument ≠ ${requirement.values
      .map((value) => scalarText(value))
      .join(", ")}`;
  }
  if (requirement.kind === "closed-interval") {
    return `${prefix}argument ∈ [${roundedText(requirement.lower)}, ${roundedText(requirement.upper)}]`;
  }
  const relation =
    requirement.kind === "positive"
      ? "> 0"
      : requirement.kind === "nonnegative"
        ? "≥ 0"
        : "≠ 0";
  return `${prefix}argument ${relation}`;
};

export interface MappingLensControlProps {
  candidates: MappingSignatureCandidate[];
  value: MappingSignatureCandidate;
  onChange: (candidateId: string) => void;
}

/**
 * A compact interpretation switch, intentionally colocated with the graph.
 * It is a lens over one symbolic expression—not a permanent realm field on a
 * variable and not a global "complex mode".
 */
export function MappingLensControl({
  candidates,
  value,
  onChange,
}: MappingLensControlProps) {
  const activeBranches = value.principalBranches.filter((branch) => branch.active);
  const branchLabels = [
    activeBranches.some((branch) =>
      branch.operation === "sqrt" ||
      branch.operation === "log" ||
      branch.operation === "power" ||
      branch.operation === "argument"
    )
      ? "principal branch · Arg ∈ (−π, π]"
      : null,
    activeBranches.some((branch) => branch.operation === "inverse-trigonometric")
      ? "principal inverse trig · standard branch cuts"
      : null,
  ].filter((label): label is string => !!label);
  const exactRange = rangeLabel(value.range);
  const alternative =
    candidates.length > 1
      ? candidates[(candidates.findIndex((candidate) => candidate.id === value.id) + 1) % candidates.length]
      : null;

  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-[10px]" data-ui>
      <button
        type="button"
        onClick={() => alternative && onChange(alternative.id)}
        disabled={!alternative}
        aria-label={
          alternative
            ? `Current mapping ${signatureLabel(value)}. Switch to ${signatureLabel(alternative)}`
            : `Mapping ${signatureLabel(value)}`
        }
        title={
          alternative
            ? `Interpret the same formula as ${signatureLabel(alternative)}`
            : "The expression determines this scalar realm"
        }
        className="inline-flex min-h-11 items-center rounded-full border border-sky-300 bg-sky-50 px-3 py-0.5 font-medium text-sky-700 transition-colors enabled:hover:border-sky-500 dark:bg-sky-950/30 dark:text-sky-300"
      >
        {signatureLabel(value)}
      </button>
      {exactRange && (
        <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
          {exactRange}
        </span>
      )}
      {value.effectiveDomainRequirements.map((requirement) => (
        <span
          key={`${requirement.kind}:${requirement.expressionKey}:${requirement.appliesTo}`}
          className="rounded-full border border-amber-300/80 bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-950/25 dark:text-amber-300"
        >
          {requirementLabel(requirement)}
        </span>
      ))}
      {branchLabels.map((label) => (
        <span
          key={label}
          className="rounded-full border border-violet-300/80 bg-violet-50 px-2 py-0.5 text-violet-700 dark:bg-violet-950/25 dark:text-violet-300"
          title={activeBranches.map((branch) => branch.operation).join(", ")}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

interface ComplexRepresentationProps {
  label: string;
  value: ScalarValue | null;
  mode: ComplexDisplayMode;
  onMode: (mode: ComplexDisplayMode) => void;
}

function ComplexRepresentation({
  label,
  value,
  mode,
  onMode,
}: ComplexRepresentationProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px]" data-ui>
      <span className="mr-1 font-serif text-sm">
        <span className="italic">{label}</span> = {value ? scalarText(value, mode) : "undefined"}
      </span>
      {(["cartesian", "polar", "exponential"] as const).map((candidate) => (
        <button
          key={candidate}
          type="button"
          onClick={() => onMode(candidate)}
          aria-pressed={mode === candidate}
          className={`inline-flex min-h-11 items-center rounded-full border px-3 py-0.5 transition-colors ${
            mode === candidate
              ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
              : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          }`}
        >
          {candidate === "cartesian" ? "a + bi" : candidate === "polar" ? "polar" : "re^(iθ)"}
        </button>
      ))}
    </div>
  );
}

export interface ClosedComplexPaneProps {
  label: string;
  value: ScalarValue;
  display: ComplexDisplayMode;
  onDisplay: (mode: ComplexDisplayMode) => void;
}

export function ClosedComplexPane({
  label,
  value,
  display,
  onDisplay,
}: ClosedComplexPaneProps) {
  return (
    <section className="mt-3 flex w-full flex-col items-center gap-1">
      <ComplexRepresentation label={label} value={value} mode={display} onMode={onDisplay} />
      <ComplexPlane value={scalarPoint(value)} valueLabel={label} />
    </section>
  );
}

export interface ComplexMappingPaneProps {
  isolation: ExplicitIsolation;
  signature: MappingSignatureCandidate;
  input: string;
  fixed: Readonly<Record<string, number>>;
  realProbe: number;
  onRealProbe: (value: number) => void;
  complexProbe: ComplexValue;
  onComplexProbe: (value: ComplexValue) => void;
  display: ComplexDisplayMode;
  onDisplay: (mode: ComplexDisplayMode) => void;
}

/**
 * Selects visualization from the complete mapping signature:
 * R→C is a path, C→C is linked input/output planes, and C→R is an input
 * plane with a scalar reading. R→R remains in the established graph panes.
 */
export function ComplexMappingPane({
  isolation,
  signature,
  input,
  fixed,
  realProbe,
  onRealProbe,
  complexProbe,
  onComplexProbe,
  display,
  onDisplay,
}: ComplexMappingPaneProps) {
  const inputSpace = signature.inputs.find((candidate) => candidate.symbol === input)?.space;
  const outputSpace = signature.output.space;
  const expressionKey = keyOf(isolation.expression);
  const fixedKey = Object.entries(fixed)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, value]) => `${symbol}:${value}`)
    .join("|");
  const mappingIdentity = `${signature.id}|${input}|${expressionKey}|${fixedKey}`;
  const [mobilePlane, setMobilePlane] = useState<"input" | "output">("input");

  const complexInputValue: ScalarValue = {
    kind: "complex",
    re: complexProbe.re,
    im: complexProbe.im,
  };
  const complexOutputValue =
    inputSpace === "complex"
      ? evaluateScalar(isolation.expression, {
          ...fixed,
          [input]: complexInputValue,
        })
      : null;
  const complexOutputPoint =
    outputSpace === "complex" && complexOutputValue
      ? scalarPoint(complexOutputValue)
      : null;
  const sharedViewportHalfSpan = useStableComplexViewport(
    mappingIdentity,
    complexOutputPoint
      ? [complexProbe, complexOutputPoint]
      : [complexProbe],
  );

  const realPathValueAt = useCallback(
    (parameter: number): ComplexValue => {
      const result = evaluateScalar(isolation.expression, {
        ...fixed,
        [input]: parameter,
      });
      return result ? scalarPoint(result) : { re: Number.NaN, im: Number.NaN };
    },
    // Structural/value keys deliberately make this stable when parents
    // recreate equivalent expression or parameter objects during a drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expressionKey, fixedKey, input],
  );

  if (inputSpace === "real" && outputSpace === "complex") {
    const value = evaluateScalar(isolation.expression, { ...fixed, [input]: realProbe });
    const point = value ? scalarPoint(value) : { re: Number.NaN, im: Number.NaN };
    return (
      <section className="mt-3 flex w-full flex-col items-center gap-1">
        <ComplexRepresentation
          label={signature.output.symbol}
          value={value}
          mode={display}
          onMode={onDisplay}
        />
        <ComplexPlane
          value={point}
          valueLabel={signature.output.symbol}
          path={{
            valueAt: realPathValueAt,
            parameter: realProbe,
            min: -6,
            max: 6,
            onParameterChange: onRealProbe,
            parameterLabel: input,
          }}
        />
      </section>
    );
  }

  if (inputSpace === "complex") {
    if (outputSpace === "complex") {
      return (
        <section className="mt-2 w-full">
          <ComplexRepresentation
            label={signature.output.symbol}
            value={complexOutputValue}
            mode={display}
            onMode={onDisplay}
          />
          <div
            className="mx-auto mt-1 flex w-fit rounded-full border border-border bg-muted/35 p-0.5 text-[11px] lg:hidden"
            role="group"
            aria-label="Choose complex plane"
            data-ui
          >
            <button
              type="button"
              aria-pressed={mobilePlane === "input"}
              onClick={() => setMobilePlane("input")}
              className={`min-h-11 rounded-full px-4 ${
                mobilePlane === "input"
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              input <span className="font-serif italic">{input}</span>
            </button>
            <button
              type="button"
              aria-pressed={mobilePlane === "output"}
              onClick={() => setMobilePlane("output")}
              className={`min-h-11 rounded-full px-4 ${
                mobilePlane === "output"
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              output <span className="font-serif italic">{signature.output.symbol}</span>
            </button>
          </div>
          <div className="mt-1 w-full gap-2 lg:grid lg:grid-cols-2">
            <div className={mobilePlane === "input" ? "block" : "hidden lg:block"}>
              <ComplexPlane
                value={complexProbe}
                onValueChange={onComplexProbe}
                viewportHalfSpan={sharedViewportHalfSpan}
                valueLabel={input}
                ariaLabel={`Complex input plane for ${input}. Drag the amber point to update the mapping.`}
              />
            </div>
            <div className={mobilePlane === "output" ? "block" : "hidden lg:block"}>
              <ComplexPlane
                value={complexOutputPoint ?? { re: Number.NaN, im: Number.NaN }}
                viewportHalfSpan={sharedViewportHalfSpan}
                valueLabel={signature.output.symbol}
                ariaLabel={`Complex output plane for ${signature.output.symbol}.`}
              />
            </div>
          </div>
          <p className="mt-1 text-center text-[10px] text-muted-foreground" data-ui>
            Drag <span className="font-serif italic">{input}</span>; both planes use the same scale.
          </p>
        </section>
      );
    }

    return (
      <section className="mt-2 flex w-full flex-col items-center gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="order-2 w-full lg:order-1">
          <ComplexPlane
            value={complexProbe}
            onValueChange={onComplexProbe}
            viewportHalfSpan={sharedViewportHalfSpan}
            valueLabel={input}
            ariaLabel={`Complex input plane for ${input}. Drag the amber point to update the scalar output.`}
          />
        </div>
        <div className="order-1 mx-auto rounded-2xl border border-border bg-card px-5 py-3 text-center shadow-sm lg:order-2" data-ui>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">scalar output</div>
          <div className="mt-1 font-serif text-2xl">
            <span className="italic">{signature.output.symbol}</span>
            {" = "}
            {complexOutputValue ? scalarText(complexOutputValue) : "undefined"}
          </div>
        </div>
      </section>
    );
  }

  return null;
}

export const signatureNeedsComplexView = (
  signature: MappingSignatureCandidate
): boolean =>
  signature.inputs.some((input) => input.space === "complex") ||
  signature.output.space === "complex";
