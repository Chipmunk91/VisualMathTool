import {
  antiderivative,
  ensureTreeEqIds,
  introducesLnOf,
  simplify,
  symbolIdForName,
  tadd,
  tc,
  tdiff,
  tfn,
  tint,
  tmul,
  tpow,
  tv,
  varsIn,
  type TCalculusNotation,
  type TNode,
  type TVariableRef,
  type TreeEq,
} from "./tree";

export type DifferentiationMode = "ordinary" | "partial" | "implicit" | "total";
export type IntegrationMode = "ordinary" | "partial";

/**
 * How a born derivative is WRITTEN. "leibniz" keeps the classic operator node
 * (dy/dx). "lagrange" and "subscript" instead birth a NEW NAMED SYMBOL
 * (y′ or y_x) — semantically the same derivative, but atomic by construction:
 * a plain symbol obeys every rule of the move grammar with zero exceptions,
 * cannot be torn apart like a fraction, and keeps the relation plottable.
 */
export type DerivativeNotationStyle = "leibniz" | "lagrange" | "subscript";

/**
 * Every non-differentiation symbol must be classified. Nothing in this
 * object is inferred from x/y names or which side happens to be isolated.
 */
export interface DifferentiationContext {
  mode: DifferentiationMode;
  withRespectTo: string;
  dependent: string[];
  heldConstant: string[];
  /** Explicit confirmation for identities that have no dependent symbol. */
  treatAsIdentity?: boolean;
  /** Presentation of born derivatives; omitted means classic Leibniz nodes. */
  notation?: DerivativeNotationStyle;
}

export interface IntegrationContext {
  mode: IntegrationMode;
  withRespectTo: string;
  dependent: string[];
  heldConstant: string[];
  /** Explicit confirmation for identities that have no dependent symbol. */
  treatAsIdentity?: boolean;
  bounds?: [number, number];
}

export interface CalculusResult {
  equation: TreeEq;
  label: string;
  note: string;
  pill?: string;
}

export interface ContextValidation {
  ok: boolean;
  message?: string;
}

const equationSymbols = (equation: TreeEq): string[] =>
  Array.from(new Set([
    ...Array.from(varsIn(equation.left)),
    ...Array.from(varsIn(equation.right)),
  ])).sort();

export function validateCalculusContext(
  equation: TreeEq,
  context: DifferentiationContext | IntegrationContext
): ContextValidation {
  if (!context || typeof context.withRespectTo !== "string" ||
      !Array.isArray(context.dependent) || !Array.isArray(context.heldConstant) ||
      context.dependent.some((name) => typeof name !== "string") ||
      context.heldConstant.some((name) => typeof name !== "string")) {
    return { ok: false, message: "The calculus context is malformed." };
  }
  const symbols = equationSymbols(equation);
  if (!context.withRespectTo) return { ok: false, message: "Choose the variable of operation." };
  if (!symbols.includes(context.withRespectTo)) {
    return { ok: false, message: `${context.withRespectTo} is not present in this relation.` };
  }
  const dependent = new Set(context.dependent);
  const held = new Set(context.heldConstant);
  if (dependent.has(context.withRespectTo) || held.has(context.withRespectTo)) {
    return { ok: false, message: "The operation variable cannot also be dependent or held constant." };
  }
  const overlap = context.dependent.find((name) => held.has(name));
  if (overlap) return { ok: false, message: `${overlap} has two conflicting roles.` };
  const unknown = [...Array.from(dependent), ...Array.from(held)].find((name) => !symbols.includes(name));
  if (unknown) return { ok: false, message: `${unknown} is not present in this relation.` };
  const unclassified = symbols.filter(
    (name) => name !== context.withRespectTo && !dependent.has(name) && !held.has(name)
  );
  if (unclassified.length > 0) {
    return {
      ok: false,
      message: `Classify ${unclassified.join(", ")} as dependent or held constant.`,
    };
  }
  if ("bounds" in context && context.bounds) {
    const [lower, upper] = context.bounds;
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower === upper) {
      return { ok: false, message: "Integration bounds must be two different finite numbers." };
    }
  }
  if (context.mode === "implicit" && context.dependent.length === 0) {
    return { ok: false, message: "Implicit differentiation needs at least one dependent symbol." };
  }
  if (context.dependent.length === 0 && !context.treatAsIdentity) {
    return {
      ok: false,
      message: "Mark a dependent symbol or explicitly confirm that the relation is an identity.",
    };
  }
  return { ok: true };
}

const isZero = (node: TNode): boolean =>
  node.kind === "const" && node.num === 0;

/**
 * The name a derivative-born symbol receives. Lagrange appends a prime
 * (y → y′ → y′′); subscript appends the operation variable to the subscript
 * chunk (z → z_x → z_xx), so repeated differentiation stays readable.
 */
export function derivedSymbolName(
  dependent: string,
  withRespectTo: string,
  style: Exclude<DerivativeNotationStyle, "leibniz">
): string {
  if (style === "lagrange") return `${dependent}′`;
  const subscripted = dependent.match(/^(.+)_([^_]+)$/);
  return subscripted
    ? `${subscripted[1]}_${subscripted[2]}${withRespectTo}`
    : `${dependent}_${withRespectTo}`;
}

interface DerivativeState {
  context: DifferentiationContext;
  dependent: ReadonlySet<string>;
  held: ReadonlySet<string>;
  notation: TCalculusNotation;
  style: DerivativeNotationStyle;
  operationVariable: TVariableRef;
  assumptions: Set<string>;
}

const symbolRefIn = (node: TNode, name: string): TVariableRef | null => {
  switch (node.kind) {
    case "var":
      return node.name === name ? { name: node.name, symbolId: node.symbolId } : null;
    case "add":
      for (const term of node.terms) {
        const found = symbolRefIn(term, name);
        if (found) return found;
      }
      return null;
    case "mul":
      for (const factor of node.factors) {
        const found = symbolRefIn(factor, name);
        if (found) return found;
      }
      return null;
    case "pow":
      return symbolRefIn(node.base, name) ?? symbolRefIn(node.exp, name);
    case "fn":
      return symbolRefIn(node.arg, name);
    case "derivative":
      return node.variable.name === name ? node.variable : symbolRefIn(node.expression, name);
    case "integral":
      if (node.variable.name === name) return node.variable;
      return symbolRefIn(node.integrand, name) ??
        (node.bounds ? symbolRefIn(node.bounds.lower, name) ?? symbolRefIn(node.bounds.upper, name) : null);
    default:
      return null;
  }
};

const symbolRefInEquation = (equation: TreeEq, name: string): TVariableRef =>
  symbolRefIn(equation.left, name) ?? symbolRefIn(equation.right, name) ?? {
    name,
    symbolId: symbolIdForName(name),
  };

function derivativeInContext(node: TNode, state: DerivativeState): TNode {
  const { context, dependent, held, notation } = state;
  switch (node.kind) {
    case "const":
    case "named":
      return tc(0);
    case "var":
      if (node.name === context.withRespectTo) return tc(1);
      if (held.has(node.name)) return tc(0);
      if (dependent.has(node.name)) {
        if (state.style !== "leibniz") {
          const name = derivedSymbolName(node.name, context.withRespectTo, state.style);
          return tv(name, symbolIdForName(name));
        }
        return tdiff(tv(node.name, node.symbolId), state.operationVariable, notation);
      }
      // validateCalculusContext prevents this path. Keep the thrown error so
      // API callers can never receive a silently guessed derivative.
      throw new Error(`Unclassified symbol ${node.name}`);
    case "add":
      return tadd(...node.terms.map((term) => derivativeInContext(term, state)));
    case "mul": {
      const terms = node.factors.map((factor, index) =>
        tmul(
          derivativeInContext(factor, state),
          ...node.factors.filter((_, factorIndex) => factorIndex !== index)
        )
      );
      return tadd(...terms);
    }
    case "pow": {
      const du = simplify(derivativeInContext(node.base, state));
      const dv = simplify(derivativeInContext(node.exp, state));
      if (isZero(dv)) {
        return tmul(node.exp, tpow(node.base, simplify(tadd(node.exp, tc(-1)))), du);
      }
      if (isZero(du)) {
        return tmul(node, tfn("ln", node.base), dv);
      }
      // u^v = exp(v ln u) over the real model, requiring u > 0.
      state.assumptions.add(`${printCompact(node.base)} > 0`);
      return tmul(
        node,
        tadd(
          tmul(dv, tfn("ln", node.base)),
          tmul(node.exp, du, tpow(node.base, -1))
        )
      );
    }
    case "fn": {
      const du = derivativeInContext(node.arg, state);
      const u = node.arg;
      const outer: TNode =
        node.fn === "sin"
          ? tfn("cos", u)
          : node.fn === "cos"
            ? tmul(tc(-1), tfn("sin", u))
            : node.fn === "tan"
              ? tpow(tfn("cos", u), -2)
              : node.fn === "ln"
                ? tpow(u, -1)
                : node.fn === "exp"
                  ? tfn("exp", u)
                  : node.fn === "sqrt"
                    ? tmul(tc(1, 2), tpow(tfn("sqrt", u), -1))
                    : node.fn === "asin"
                      ? tpow(tadd(tc(1), tmul(tc(-1), tpow(u, 2))), tc(-1, 2))
                      : node.fn === "acos"
                        ? tmul(tc(-1), tpow(tadd(tc(1), tmul(tc(-1), tpow(u, 2))), tc(-1, 2)))
                        : tpow(tadd(tc(1), tpow(u, 2)), -1);
      return tmul(outer, du);
    }
    case "derivative":
      return tdiff(node, state.operationVariable, notation);
    case "integral":
      if (!node.bounds && node.variable.name === context.withRespectTo) return node.integrand;
      return tdiff(node, state.operationVariable, notation);
  }
}

// Kept local to avoid circular presentation dependencies.
const printCompact = (node: TNode): string => {
  switch (node.kind) {
    case "var":
      return node.name;
    case "const":
      return node.den === 1 ? String(node.num) : `${node.num}/${node.den}`;
    default:
      return "base";
  }
};

export function differentiateRelation(
  equation: TreeEq,
  context: DifferentiationContext
): CalculusResult | string {
  if (!["ordinary", "partial", "implicit", "total"].includes(context?.mode)) {
    return "Choose a supported differentiation mode.";
  }
  const validation = validateCalculusContext(equation, context);
  if (!validation.ok) return validation.message ?? "The differentiation context is incomplete.";
  const assumptions = new Set<string>();
  const style = context.notation ?? "leibniz";
  const state: DerivativeState = {
    context,
    dependent: new Set(context.dependent),
    held: new Set(context.heldConstant),
    notation: context.mode === "partial" ? "partial" : "ordinary",
    style,
    operationVariable: symbolRefInEquation(equation, context.withRespectTo),
    assumptions,
  };
  const next = ensureTreeEqIds({
    left: simplify(derivativeInContext(equation.left, state)),
    right: simplify(derivativeInContext(equation.right, state)),
  });
  const dependentText = context.dependent.length > 0
    ? `${context.dependent.join(", ")} depend${context.dependent.length === 1 ? "s" : ""} on ${context.withRespectTo}`
    : "the relation was explicitly confirmed as an identity";
  const heldText = context.heldConstant.length > 0
    ? `; held ${context.heldConstant.join(", ")} constant`
    : "";
  const mark = context.mode === "partial" ? "∂" : "d";
  const namedText = style !== "leibniz" && context.dependent.length > 0
    ? `; wrote ${context.dependent
        .map((name) => `${derivedSymbolName(name, context.withRespectTo, style)} for ${mark}${name}/${mark}${context.withRespectTo}`)
        .join(", ")}`
    : "";
  const assumptionText = Array.from(assumptions).join(", ");
  return {
    equation: next,
    label: `${context.mode} derivative with respect to ${context.withRespectTo}`,
    note: `Differentiated both sides; ${dependentText}${heldText}${namedText}.`,
    pill: assumptionText || undefined,
  };
}

const numberNode = (value: number): TNode => {
  if (Number.isInteger(value)) return tc(value);
  const den = 1_000_000;
  return tc(Math.round(value * den), den);
};

const containsDependent = (node: TNode, dependent: ReadonlySet<string>): boolean =>
  Array.from(varsIn(node)).some((name) => dependent.has(name));

export function integrateRelation(
  equation: TreeEq,
  context: IntegrationContext
): CalculusResult | string {
  if (!["ordinary", "partial"].includes(context?.mode)) {
    return "Choose a supported integration mode.";
  }
  const validation = validateCalculusContext(equation, context);
  if (!validation.ok) return validation.message ?? "The integration context is incomplete.";
  const dependent = new Set(context.dependent);
  const operationVariable = symbolRefInEquation(equation, context.withRespectTo);
  const bounds = context.bounds
    ? { lower: numberNode(context.bounds[0]), upper: numberNode(context.bounds[1]) }
    : undefined;
  let introducedLn = false;
  const integrateSide = (node: TNode): TNode => {
    if (bounds || containsDependent(node, dependent)) {
      return tint(node, operationVariable, bounds);
    }
    const primitive = antiderivative(node, context.withRespectTo, operationVariable.symbolId);
    if (!primitive) return tint(node, operationVariable);
    const simplified = simplify(primitive);
    introducedLn ||= introducesLnOf(simplified, context.withRespectTo);
    return simplified;
  };
  const left = integrateSide(equation.left);
  const rightPrimitive = integrateSide(equation.right);
  const right = bounds ? rightPrimitive : simplify(tadd(rightPrimitive, tv("C")));
  const next = ensureTreeEqIds({ left, right });
  const heldText = context.heldConstant.length > 0
    ? `; held ${context.heldConstant.join(", ")} constant`
    : "";
  const dependentText = context.dependent.length > 0
    ? `; retained integrals containing dependent ${context.dependent.join(", ")}`
    : "; the relation was explicitly confirmed as an identity";
  return {
    equation: next,
    label: `${context.bounds ? "definite" : "indefinite"} integral with respect to ${context.withRespectTo}`,
    note: `Integrated both sides${heldText}${dependentText}${bounds ? "" : "; C records the integration constant"}.`,
    pill: introducedLn ? "logarithm argument > 0" : undefined,
  };
}

/**
 * The four readiness states of the calculus operators, decided purely from
 * relation structure (see docs/design/calculus-ux.md):
 *
 *   no-symbols     — a constant relation; there is nothing to vary, hide/disable.
 *   solution-set   — symbols exist but the relation only holds at isolated
 *                    solutions (x² = 4). Differentiating both sides would
 *                    destroy them; refuse with the explanation, and leave the
 *                    context panel's explicit identity confirmation as the
 *                    deliberate escape hatch.
 *   deterministic  — exactly one reading exists (y = 2x²). The returned
 *                    context is complete; apply it in one tap with a visible
 *                    receipt instead of asking.
 *   needs-context  — several readings exist. Open the panel, but seeded with
 *                    the best-ranked suggestion so accepting is one confirm.
 */
export type CalculusReadiness =
  | { state: "no-symbols"; explanation: string }
  | { state: "solution-set"; explanation: string }
  | { state: "deterministic"; context: DifferentiationContext; explanation: string }
  | { state: "needs-context"; suggestion: DifferentiationContext; explanation: string };

interface AnalysisShape {
  symbols: string[];
  isolations: { output: string; inputs: string[] }[];
  /** Declared dependency edges (symbol book): name → the names it is a function of. */
  dependencies?: Record<string, string[]>;
}

/**
 * Readiness read straight off a DECLARED dependency graph. The graph answers
 * every question the context panel would ask: dependent = everything that can
 * reach the operation variable through the edges, held = everything that
 * can't, and the mode is a derived label, not a choice. Only the operation
 * variable can remain open — and only when several free symbols drive things.
 */
const edgesAmong = (symbols: string[], dependencies: Record<string, string[]>): Map<string, string[]> => {
  const present = new Set(symbols);
  return new Map(
    Object.entries(dependencies)
      .filter(([output]) => present.has(output))
      .map(([output, inputs]) => [output, inputs.filter((input) => present.has(input))] as const)
      .filter(([, inputs]) => inputs.length > 0)
  );
};

const dependentsIn = (edges: Map<string, string[]>, root: string): string[] => {
  const reached = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [output, inputs] of Array.from(edges)) {
      if (reached.has(output)) continue;
      if (inputs.some((input) => input === root || reached.has(input))) {
        reached.add(output);
        grew = true;
      }
    }
  }
  return Array.from(reached).sort();
};

/** The ranked free symbols that drive something — the legal "along" choices. */
export function graphDrivers(symbols: string[], dependencies: Record<string, string[]>): string[] {
  const edges = edgesAmong(symbols, dependencies);
  const free = symbols.filter((name) => (edges.get(name) ?? []).length === 0);
  return rankInputs(free.filter((name) => dependentsIn(edges, name).length > 0));
}

/** The full context the graph implies for one along-choice: reachability decides every role. */
export function graphContextFor(
  symbols: string[],
  dependencies: Record<string, string[]>,
  withRespectTo: string
): DifferentiationContext {
  const edges = edgesAmong(symbols, dependencies);
  const dependent = dependentsIn(edges, withRespectTo);
  const dependentSet = new Set(dependent);
  const heldConstant = symbols.filter((name) => name !== withRespectTo && !dependentSet.has(name));
  const mode: DifferentiationMode =
    heldConstant.length > 0 ? "partial" : dependent.length > 1 ? "total" : "ordinary";
  return {
    mode,
    withRespectTo,
    dependent,
    heldConstant,
    notation: mode === "ordinary" ? "lagrange" : "subscript",
  };
}

const readinessFromGraph = (
  symbols: string[],
  dependencies: Record<string, string[]>
): CalculusReadiness | null => {
  const drivers = graphDrivers(symbols, dependencies);
  if (drivers.length === 0) return null; // degenerate declaration — fall back to structure
  const context = graphContextFor(symbols, dependencies, drivers[0]);
  const readingText = `${context.dependent.join(", ")} respond${context.dependent.length === 1 ? "s" : ""} to ${drivers[0]}` +
    (context.heldConstant.length > 0 ? `; ${context.heldConstant.join(", ")} unconnected, held constant` : "");
  if (drivers.length === 1) {
    return {
      state: "deterministic",
      context,
      explanation: `The declared dependencies leave one reading: ${readingText}.`,
    };
  }
  return {
    state: "needs-context",
    suggestion: context,
    explanation: `The declared graph can be read along ${drivers.join(" or ")} — d/d${drivers[0]} suggested: ${readingText}.`,
  };
};

/**
 * Conventional-role ranking for SEEDING suggestions only — the panel still
 * requires explicit confirmation, so this never decides, it just makes the
 * default match what a textbook reader expects: y = mx + b seeds d/dx with
 * m, b held, not d/db. x and t outrank everything; early-alphabet single
 * letters (a…n) read as parameters.
 */
const INDEPENDENT_RANK: Record<string, number> = { x: 6, t: 5, u: 4, v: 4, w: 4, s: 3, r: 3, "θ": 3 };
const independentScore = (name: string): number =>
  INDEPENDENT_RANK[name] ?? (/^[a-n]$/.test(name) ? 0 : 1);
const rankInputs = (inputs: string[]): string[] =>
  [...inputs].sort((a, b) => independentScore(b) - independentScore(a) || a.localeCompare(b));

export function inferCalculusDefaults(analysis: AnalysisShape): CalculusReadiness {
  const { symbols, isolations } = analysis;
  if (symbols.length === 0) {
    return { state: "no-symbols", explanation: "Both sides are constant — nothing varies, so there is no rate of change to take." };
  }
  // Declared knowledge outranks structural guessing: a dependency graph in
  // the symbol book decides the reading before any isolation heuristics run.
  if (edgesAmong(symbols, analysis.dependencies ?? {}).size > 0) {
    const fromGraph = readinessFromGraph(symbols, analysis.dependencies ?? {});
    if (fromGraph) return fromGraph;
  }
  if (isolations.length === 1) {
    const [isolation] = isolations;
    if (isolation.inputs.length === 1) {
      return {
        state: "deterministic",
        context: {
          mode: "ordinary",
          withRespectTo: isolation.inputs[0],
          dependent: [isolation.output],
          heldConstant: [],
          notation: "lagrange",
        },
        explanation: `${isolation.output} is a function of ${isolation.inputs[0]} — differentiate d/d${isolation.inputs[0]} with ${isolation.output} dependent.`,
      };
    }
    if (isolation.inputs.length === 0) {
      return {
        state: "solution-set",
        explanation: `This pins ${isolation.output} to a single value — a point, not a function, so there is no rate of change.`,
      };
    }
    const ranked = rankInputs(isolation.inputs);
    return {
      state: "needs-context",
      suggestion: {
        mode: "partial",
        withRespectTo: ranked[0],
        dependent: [isolation.output],
        heldConstant: ranked.slice(1),
        notation: "subscript",
      },
      explanation: `${isolation.output} depends on several symbols — choose which one varies; the others are held constant.`,
    };
  }
  if (isolations.length >= 2) {
    // Both sides are bare symbols, so the relation reads either way. Seed
    // the reading whose input is the more conventional independent variable
    // (y = x suggests y′ = dy/dx, not x′ = dx/dy) and say both out loud.
    const best = [...isolations].sort(
      (a, b) =>
        independentScore(rankInputs(b.inputs)[0] ?? "") - independentScore(rankInputs(a.inputs)[0] ?? "")
    )[0];
    const other = isolations.find((isolation) => isolation !== best)!;
    const ranked = rankInputs(best.inputs);
    return {
      state: "needs-context",
      suggestion: {
        mode: "ordinary",
        withRespectTo: ranked[0] ?? "",
        dependent: [best.output],
        heldConstant: ranked.slice(1),
        notation: "lagrange",
      },
      explanation:
        `This reads two ways: ${best.output} as a function of ${ranked[0] ?? other.output} (suggested), ` +
        `or ${other.output} as a function of ${rankInputs(other.inputs)[0] ?? best.output} — confirm which side is the function.`,
    };
  }
  if (symbols.length === 1) {
    return {
      state: "solution-set",
      explanation: `This equation only holds at particular values of ${symbols[0]} — differentiating both sides would destroy those solutions. Solve it instead, or confirm it as an identity.`,
    };
  }
  return {
    state: "needs-context",
    suggestion: {
      mode: "implicit",
      withRespectTo: symbols[0],
      dependent: symbols.slice(1),
      heldConstant: [],
      notation: "lagrange",
    },
    explanation: "An implicit relation — confirm which symbol varies freely and which depend on it.",
  };
}

/** The matching integration context for an inferred differentiation reading. */
export const integrationDefaultsFrom = (context: DifferentiationContext): IntegrationContext => ({
  mode: context.mode === "partial" ? "partial" : "ordinary",
  withRespectTo: context.withRespectTo,
  dependent: context.dependent,
  heldConstant: context.heldConstant,
  treatAsIdentity: context.treatAsIdentity,
});

/** Convenience for UI/API callers that need a blank, deliberately incomplete context. */
export const emptyDifferentiationContext = (): DifferentiationContext => ({
  mode: "ordinary",
  withRespectTo: "",
  dependent: [],
  heldConstant: [],
  treatAsIdentity: false,
});

export const emptyIntegrationContext = (): IntegrationContext => ({
  mode: "ordinary",
  withRespectTo: "",
  dependent: [],
  heldConstant: [],
  treatAsIdentity: false,
});
