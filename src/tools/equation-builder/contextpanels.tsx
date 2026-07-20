import { X } from "lucide-react";
import type {
  DifferentiationContext,
  IntegrationContext,
} from "./calculus";
import {
  viewSpecKey,
  type RelationAnalysis,
  type ViewSpec,
} from "./relation";

const cloneView = (spec: ViewSpec): ViewSpec => ({
  ...spec,
  fixed: { ...spec.fixed },
});

export function VisualizationSetup({
  analysis,
  value,
  onChange,
}: {
  analysis: RelationAnalysis;
  value: ViewSpec | null;
  onChange: (value: ViewSpec | null) => void;
}) {
  if (analysis.viewCandidates.length === 0) return null;
  const active = value
    ? analysis.viewCandidates.find((candidate) => viewSpecKey(candidate.spec) === viewSpecKey(value))
    : null;
  const fixed = value ? Object.keys(value.fixed) : [];
  const swap = () => {
    if (!value || (value.kind !== "implicit-2d" && value.kind !== "scalar-field-2d")) return;
    onChange({ ...value, horizontal: value.vertical, vertical: value.horizontal });
  };
  return (
    <div className="mt-5 flex max-w-[min(680px,90vw)] flex-wrap items-center justify-center gap-2 text-xs" data-ui>
      <span className="text-muted-foreground">Visualization</span>
      <select
        aria-label="Visualization interpretation"
        value={active?.id ?? "custom"}
        onChange={(event) => {
          if (event.target.value === "none") return onChange(null);
          const candidate = analysis.viewCandidates.find((item) => item.id === event.target.value);
          if (candidate) onChange(cloneView(candidate.spec));
        }}
        className="h-8 max-w-[min(26rem,80vw)] rounded-lg border border-border bg-card px-2"
      >
        <option value="none">choose a view…</option>
        {value && !active && <option value="custom">custom view</option>}
        {analysis.viewCandidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
        ))}
      </select>
      {value && (value.kind === "implicit-2d" || value.kind === "scalar-field-2d") && (
        <button
          type="button"
          onClick={swap}
          className="h-8 rounded-lg border border-border bg-card px-2 text-muted-foreground hover:text-foreground"
          title="Swap horizontal and vertical axes"
        >
          swap axes
        </button>
      )}
      {fixed.map((name) => (
        <label key={name} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-2">
          <span className="font-serif italic">{name}</span>
          <span className="text-muted-foreground">=</span>
          <input
            aria-label={`Fixed value for ${name}`}
            type="number"
            step="any"
            value={value!.fixed[name]}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              onChange({ ...value!, fixed: { ...value!.fixed, [name]: next } });
            }}
            className="w-16 bg-transparent text-right tabular-nums outline-none"
          />
        </label>
      ))}
    </div>
  );
}

type CalculusContext = DifferentiationContext | IntegrationContext;

export function CalculusContextPanel({
  operation,
  symbols,
  context,
  onContext,
  validationMessage,
  onApply,
  onClose,
  onOperation,
}: {
  operation: "differentiate" | "integrate";
  symbols: string[];
  context: CalculusContext;
  onContext: (context: CalculusContext) => void;
  validationMessage?: string;
  onApply: () => void;
  onClose: () => void;
  /** When provided, the panel shows a switch between the two operations. */
  onOperation?: (operation: "differentiate" | "integrate") => void;
}) {
  const classify = (name: string): "" | "dependent" | "constant" =>
    context.dependent.includes(name)
      ? "dependent"
      : context.heldConstant.includes(name)
        ? "constant"
        : "";
  const setClassification = (name: string, classification: "" | "dependent" | "constant") => {
    onContext({
      ...context,
      dependent: [
        ...context.dependent.filter((symbol) => symbol !== name),
        ...(classification === "dependent" ? [name] : []),
      ],
      heldConstant: [
        ...context.heldConstant.filter((symbol) => symbol !== name),
        ...(classification === "constant" ? [name] : []),
      ],
    });
  };
  const integration = operation === "integrate" ? context as IntegrationContext : null;
  return (
    <section
      data-calculus-context
      className="absolute left-0 top-[calc(100%+6px)] z-[70] w-[min(25rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-4 font-sans shadow-xl"
      aria-label={`${operation} context`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          {onOperation ? (
            <div className="inline-flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Calculus operation">
              {(["differentiate", "integrate"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="tab"
                  aria-selected={operation === candidate}
                  onClick={() => onOperation(candidate)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    operation === candidate
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {candidate === "differentiate" ? "Differentiate" : "Integrate"}
                </button>
              ))}
            </div>
          ) : (
            <h2 className="text-sm font-semibold">
              {operation === "differentiate" ? "Differentiate the relation" : "Integrate the relation"}
            </h2>
          )}
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Choose every symbol’s role. The operation applies to both sides; no target or source is inferred.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close calculus context" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-muted-foreground">
          Operation
          <select
            value={context.mode}
            onChange={(event) => onContext({ ...context, mode: event.target.value } as CalculusContext)}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground"
          >
            {operation === "differentiate" ? (
              <>
                <option value="ordinary">ordinary derivative</option>
                <option value="partial">partial derivative</option>
                <option value="implicit">implicit derivative</option>
                <option value="total">total derivative</option>
              </>
            ) : (
              <>
                <option value="ordinary">ordinary integral</option>
                <option value="partial">partial integral</option>
              </>
            )}
          </select>
        </label>
        <label className="text-[11px] text-muted-foreground">
          With respect to
          <select
            value={context.withRespectTo}
            onChange={(event) => {
              const withRespectTo = event.target.value;
              onContext({
                ...context,
                withRespectTo,
                dependent: context.dependent.filter((name) => name !== withRespectTo),
                heldConstant: context.heldConstant.filter((name) => name !== withRespectTo),
              });
            }}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 font-serif text-sm italic text-foreground"
          >
            <option value="">choose…</option>
            {symbols.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-3 space-y-1.5">
        {symbols.filter((name) => name !== context.withRespectTo).map((name) => (
          <label key={name} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-2">
            <span className="w-8 font-serif text-lg italic">{name}</span>
            <select
              aria-label={`Calculus role for ${name}`}
              value={classify(name)}
              onChange={(event) => setClassification(name, event.target.value as "" | "dependent" | "constant")}
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs"
            >
              <option value="">choose a role…</option>
              <option value="dependent">depends on {context.withRespectTo || "operation variable"}</option>
              <option value="constant">held constant</option>
            </select>
          </label>
        ))}
      </div>

      {operation === "differentiate" && (
        <label className="mt-3 block text-[11px] text-muted-foreground">
          Write derivatives as
          <select
            aria-label="Derivative notation"
            value={(context as DifferentiationContext).notation ?? "leibniz"}
            onChange={(event) =>
              onContext({
                ...context,
                notation: event.target.value as DifferentiationContext["notation"],
              } as CalculusContext)
            }
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground"
          >
            <option value="lagrange">y′ — a new symbol, moves like any other</option>
            <option value="subscript">y_x — a new symbol, names the variable</option>
            <option value="leibniz">dy/dx — the classic operator form</option>
          </select>
        </label>
      )}

      <label className="mt-3 flex items-start gap-2 rounded-lg border border-border p-2.5 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={!!context.treatAsIdentity}
          onChange={(event) => onContext({ ...context, treatAsIdentity: event.target.checked })}
        />
        <span>
          <span className="block font-medium">Relation is an identity in {context.withRespectTo || "the operation variable"}</span>
          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
            Use this only when both sides are equal for every value, not merely at isolated solutions.
          </span>
        </span>
      </label>

      {integration && (
        <div className="mt-3 rounded-lg border border-border p-2.5">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={!!integration.bounds}
              onChange={(event) => onContext({
                ...integration,
                bounds: event.target.checked ? [0, 1] : undefined,
              })}
            />
            definite bounds
          </label>
          {integration.bounds && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <input
                aria-label="Lower integration bound"
                type="number"
                step="any"
                value={integration.bounds[0]}
                onChange={(event) => onContext({ ...integration, bounds: [Number(event.target.value), integration.bounds![1]] })}
                className="h-8 w-20 rounded-lg border border-border bg-background px-2"
              />
              <span className="text-muted-foreground">to</span>
              <input
                aria-label="Upper integration bound"
                type="number"
                step="any"
                value={integration.bounds[1]}
                onChange={(event) => onContext({ ...integration, bounds: [integration.bounds![0], Number(event.target.value)] })}
                className="h-8 w-20 rounded-lg border border-border bg-background px-2"
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className={`text-[11px] ${validationMessage ? "text-amber-600" : "text-emerald-600"}`}>
          {validationMessage ?? "Context is complete."}
        </p>
        <button
          type="button"
          disabled={!!validationMessage}
          onClick={onApply}
          className="h-9 shrink-0 rounded-lg bg-foreground px-3 text-xs font-medium text-background disabled:cursor-not-allowed disabled:opacity-35"
        >
          Apply to both sides
        </button>
      </div>
    </section>
  );
}
