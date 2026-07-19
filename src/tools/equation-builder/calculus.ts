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

interface DerivativeState {
  context: DifferentiationContext;
  dependent: ReadonlySet<string>;
  held: ReadonlySet<string>;
  notation: TCalculusNotation;
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
  const state: DerivativeState = {
    context,
    dependent: new Set(context.dependent),
    held: new Set(context.heldConstant),
    notation: context.mode === "partial" ? "partial" : "ordinary",
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
  const assumptionText = Array.from(assumptions).join(", ");
  return {
    equation: next,
    label: `${context.mode} derivative with respect to ${context.withRespectTo}`,
    note: `Differentiated both sides; ${dependentText}${heldText}.`,
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
