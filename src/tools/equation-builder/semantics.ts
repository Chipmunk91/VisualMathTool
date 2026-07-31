import type { ExplicitIsolation } from "./relation";
import {
  evalClosedNode,
  freeVarsIn,
  keyOf,
  type TNode,
} from "./tree";
import type { ScalarValue } from "./scalar";

/**
 * The scalar realm is deliberately not a symbol attribute. A bare symbol is
 * unknown until a declaration or a selected mapping lens supplies a realm.
 * "complex" means that complex scalar semantics are required; it does not
 * claim that a computed value has a non-zero imaginary part.
 */
export type ScalarValueSpace = "real" | "complex" | "unknown";
export type KnownScalarValueSpace = Exclude<ScalarValueSpace, "unknown">;

/**
 * Scalar algebra selected for one equation operation.
 *
 * This is deliberately operation-scoped rather than a permanent property of
 * a symbol. `mappingSignatureId` records the advertised mapping lens that
 * supplied the realm, when one exists, so a preview/event can be replayed with
 * the same branch conventions.
 */
export interface ScalarOperationContext {
  scalarRealm: KnownScalarValueSpace;
  mappingSignatureId?: string;
}

export const sameScalarOperationContext = (
  left: ScalarOperationContext,
  right: ScalarOperationContext
): boolean =>
  left.scalarRealm === right.scalarRealm &&
  left.mappingSignatureId === right.mappingSignatureId;

export interface RealmEvidence {
  kind:
    | "real-constant"
    | "imaginary-unit"
    | "complex-only-constant"
    | "symbol-lens"
    | "unconstrained-symbol"
    | "real-valued-operation"
    | "realm-propagation";
  nodeId: string;
  expressionKey: string;
  space: ScalarValueSpace;
  detail: string;
}

export type DomainRequirement =
  | {
      kind: "nonzero" | "positive" | "nonnegative";
      nodeId: string;
      expressionKey: string;
      appliesTo: "real" | "complex" | "both";
    }
  | {
      kind: "closed-interval";
      nodeId: string;
      expressionKey: string;
      lower: number;
      upper: number;
      appliesTo: "real";
    }
  | {
      kind: "excluded-values";
      nodeId: string;
      expressionKey: string;
      values: ScalarValue[];
      appliesTo: "complex";
    };

export interface PrincipalBranchNode {
  nodeId: string;
  expressionKey: string;
  operation: "sqrt" | "log" | "inverse-trigonometric" | "power" | "argument";
  convention: "principal";
  /** Active means the current analysis actually uses complex semantics. */
  active: boolean;
}

export interface ExpressionSemanticContext {
  /** Convenient for relation analysis, whose current contract uses names. */
  symbolSpaces?: Readonly<Record<string, KnownScalarValueSpace>>;
  /** Stable-id facts take precedence when a document-level fact store exists. */
  symbolSpacesById?: Readonly<Record<string, KnownScalarValueSpace>>;
}

export interface ExpressionSemantics {
  valueSpace: ScalarValueSpace;
  /** Present only for a variable-free expression with a finite value. */
  closedValue?: ScalarValue;
  evidence: RealmEvidence[];
  requirements: DomainRequirement[];
  principalBranches: PrincipalBranchNode[];
}

export type SemanticSet =
  | { kind: "real"; subset: "all" | "nonnegative" | "positive" }
  | { kind: "complex"; subset: "all" | "nonzero" }
  | { kind: "singleton"; expressionKey: string; value?: ScalarValue }
  | { kind: "unknown" };

export type RangeAnalysis =
  | {
      status: "exact";
      set: Exclude<SemanticSet, { kind: "unknown" }>;
      rule: "constant" | "square" | "exponential" | "absolute-value";
    }
  | {
      status: "unknown";
      set: Extract<SemanticSet, { kind: "unknown" }>;
      reason: "no-known-exact-rule";
    };

export interface SymbolMembershipInference {
  symbol: string;
  space: KnownScalarValueSpace;
  status: "inferred";
  source: "explicit-isolation";
  evidence: RealmEvidence[];
}

export interface MappingInputSpace {
  symbol: string;
  space: KnownScalarValueSpace;
}

export interface MappingSignatureCandidate {
  id: string;
  lens: "constant" | "default-real" | "complex-alternative";
  recommended: boolean;
  inputs: MappingInputSpace[];
  output: {
    symbol: string;
    space: ScalarValueSpace;
  };
  effectiveDomainRequirements: DomainRequirement[];
  range: RangeAnalysis;
  evidence: RealmEvidence[];
  principalBranches: PrincipalBranchNode[];
}

/**
 * Convert an advertised mapping into the scalar algebra its operations need.
 * Both C→R (complex intermediates) and R→C (complex outputs) require complex
 * scalar rules even though only one side of the signature names C.
 */
export const scalarOperationContextForMapping = (
  candidate: MappingSignatureCandidate
): ScalarOperationContext => ({
  scalarRealm:
    candidate.inputs.some((input) => input.space === "complex") ||
    candidate.output.space === "complex" ||
    candidate.evidence.some((item) => item.space === "complex")
      ? "complex"
      : "real",
  mappingSignatureId: candidate.id,
});

export interface IsolationSemantics {
  output: string;
  inputs: string[];
  expression: ExpressionSemantics;
  inferredMemberships: SymbolMembershipInference[];
  mappingCandidates: MappingSignatureCandidate[];
}

const evidence = (
  node: TNode,
  kind: RealmEvidence["kind"],
  space: ScalarValueSpace,
  detail: string
): RealmEvidence => ({
  kind,
  nodeId: node.id,
  expressionKey: keyOf(node),
  space,
  detail,
});

const uniqueBy = <T>(items: T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

const uniqueEvidence = (items: RealmEvidence[]): RealmEvidence[] =>
  uniqueBy(items, (item) =>
    `${item.kind}|${item.nodeId}|${item.space}|${item.detail}`
  );

const uniqueRequirements = (items: DomainRequirement[]): DomainRequirement[] =>
  uniqueBy(items, (item) =>
    item.kind === "closed-interval"
      ? `${item.kind}|${item.expressionKey}|${item.lower}|${item.upper}|${item.appliesTo}`
      : item.kind === "excluded-values"
        ? `${item.kind}|${item.expressionKey}|${JSON.stringify(item.values)}|${item.appliesTo}`
      : `${item.kind}|${item.expressionKey}|${item.appliesTo}`
  );

const uniqueBranches = (items: PrincipalBranchNode[]): PrincipalBranchNode[] =>
  uniqueBy(items, (item) =>
    `${item.nodeId}|${item.operation}|${item.active}`
  );

const childrenOf = (node: TNode): TNode[] => {
  switch (node.kind) {
    case "add":
      return node.terms;
    case "mul":
      return node.factors;
    case "pow":
      return [node.base, node.exp];
    case "fn":
      return [node.arg];
    case "derivative":
      return [node.expression];
    case "integral":
      return node.bounds
        ? [node.integrand, node.bounds.lower, node.bounds.upper]
        : [node.integrand];
    default:
      return [];
  }
};

const combineSpaces = (spaces: ScalarValueSpace[]): ScalarValueSpace => {
  if (spaces.some((space) => space === "complex")) return "complex";
  if (spaces.length > 0 && spaces.every((space) => space === "real")) return "real";
  return "unknown";
};

const isIntegerConstant = (node: TNode): boolean =>
  node.kind === "const" && node.den === 1;

const isNegativeConstant = (node: TNode): boolean =>
  node.kind === "const" && node.num / node.den < 0;

const isNonIntegerExponent = (node: TNode): boolean =>
  node.kind !== "const" || node.den !== 1;

/**
 * The evaluator gives 0^w a value only for a closed non-negative real w
 * (including its existing 0^0 convention). Every other principal complex
 * power is defined through Log(base), so its base must be nonzero.
 */
const complexPowerAllowsZeroBase = (exponent: TNode): boolean => {
  if (freeVarsIn(exponent).size > 0) return false;
  const evaluated = evalClosedNode(exponent);
  if (!evaluated.ok) return false;
  if (evaluated.value.kind === "complex") return false;
  return evaluated.value.value >= 0;
};

const isProvenClosedNonzero = (node: TNode): boolean => {
  if (freeVarsIn(node).size > 0) return false;
  const evaluated = evalClosedNode(node);
  if (!evaluated.ok) return false;
  return evaluated.value.kind === "real"
    ? evaluated.value.value !== 0
    : evaluated.value.re !== 0 || evaluated.value.im !== 0;
};

/** Does this closed expression require the evaluator's complex continuation? */
const closedComplexRequirement = (node: TNode): boolean => {
  if (freeVarsIn(node).size > 0) return false;
  const evaluated = evalClosedNode(node);
  return evaluated.ok && evaluated.realm === "complex";
};

const branchOperation = (node: TNode): PrincipalBranchNode["operation"] | null => {
  if (
    node.kind === "pow" &&
    (node.branch === "principal-complex" || isNonIntegerExponent(node.exp))
  ) return "power";
  if (node.kind !== "fn") return null;
  switch (String(node.fn)) {
    case "sqrt":
      return "sqrt";
    case "ln":
      return "log";
    case "asin":
    case "acos":
    case "atan":
      return "inverse-trigonometric";
    case "arg":
      return "argument";
    default:
      return null;
  }
};

const requirementForRealFunction = (
  node: Extract<TNode, { kind: "fn" }>
): DomainRequirement | null => {
  const fn = String(node.fn);
  if (fn === "sqrt") {
    return {
      kind: "nonnegative",
      nodeId: node.arg.id,
      expressionKey: keyOf(node.arg),
      appliesTo: "real",
    };
  }
  if (fn === "ln") {
    return {
      kind: "positive",
      nodeId: node.arg.id,
      expressionKey: keyOf(node.arg),
      appliesTo: "real",
    };
  }
  if (fn === "asin" || fn === "acos") {
    return {
      kind: "closed-interval",
      nodeId: node.arg.id,
      expressionKey: keyOf(node.arg),
      lower: -1,
      upper: 1,
      appliesTo: "real",
    };
  }
  return null;
};

const analyzeNode = (
  node: TNode,
  context: ExpressionSemanticContext
): ExpressionSemantics => {
  if (node.kind === "const") {
    return {
      valueSpace: "real",
      evidence: [evidence(node, "real-constant", "real", "rational constants are real")],
      requirements: [],
      principalBranches: [],
    };
  }

  if (node.kind === "named") {
    if (String(node.name) === "i") {
      return {
        valueSpace: "complex",
        evidence: [evidence(node, "imaginary-unit", "complex", "the imaginary unit requires complex scalars")],
        requirements: [],
        principalBranches: [],
      };
    }
    return {
      valueSpace: "real",
      evidence: [evidence(node, "real-constant", "real", `${String(node.name)} is a real named constant`)],
      requirements: [],
      principalBranches: [],
    };
  }

  if (node.kind === "var") {
    const selected =
      context.symbolSpacesById?.[node.symbolId] ??
      context.symbolSpaces?.[node.name];
    return {
      valueSpace: selected ?? "unknown",
      evidence: [
        selected
          ? evidence(node, "symbol-lens", selected, `the selected mapping lens places ${node.name} in ${selected}`)
          : evidence(node, "unconstrained-symbol", "unknown", `${node.name} has no scalar-realm fact`),
      ],
      requirements: [],
      principalBranches: [],
    };
  }

  const children = childrenOf(node).map((child) => analyzeNode(child, context));
  const childEvidence = children.flatMap((child) => child.evidence);
  const requirements = children.flatMap((child) => child.requirements);
  const branches = children.flatMap((child) => child.principalBranches);
  const childSpace = combineSpaces(children.map((child) => child.valueSpace));
  let valueSpace: ScalarValueSpace = childSpace;
  let ownEvidence: RealmEvidence[] = [];

  if (node.kind === "fn") {
    const fn = String(node.fn);
    if (fn === "re" || fn === "im" || fn === "abs" || fn === "arg") {
      valueSpace = "real";
      ownEvidence.push(
        evidence(node, "real-valued-operation", "real", `${fn} has real-valued output`)
      );
      if (fn === "arg") {
        requirements.push({
          kind: "nonzero",
          nodeId: node.arg.id,
          expressionKey: keyOf(node.arg),
          appliesTo: "both",
        });
      }
    } else if (
      fn === "sqrt" ||
      fn === "ln" ||
      fn === "asin" ||
      fn === "acos" ||
      fn === "atan"
    ) {
      if (closedComplexRequirement(node) || childSpace === "complex") {
        valueSpace = "complex";
        ownEvidence.push(
          evidence(node, "complex-only-constant", "complex", `${fn} uses its complex continuation`)
        );
        if (fn === "ln") {
          requirements.push({
            kind: "nonzero",
            nodeId: node.arg.id,
            expressionKey: keyOf(node.arg),
            appliesTo: "complex",
          });
        }
        if (fn === "atan") {
          requirements.push({
            kind: "excluded-values",
            nodeId: node.arg.id,
            expressionKey: keyOf(node.arg),
            values: [
              { kind: "complex", re: 0, im: 1 },
              { kind: "complex", re: 0, im: -1 },
            ],
            appliesTo: "complex",
          });
        }
      } else if (childSpace === "real") {
        valueSpace = "real";
        const requirement = requirementForRealFunction(node);
        if (requirement) requirements.push(requirement);
      } else {
        valueSpace = "unknown";
      }
    } else if (fn === "conj") {
      valueSpace = childSpace;
    }
  } else if (node.kind === "pow") {
    const negativeExponent = isNegativeConstant(node.exp);
    if (negativeExponent && !isProvenClosedNonzero(node.base)) {
      requirements.push({
        kind: "nonzero",
        nodeId: node.base.id,
        expressionKey: keyOf(node.base),
        appliesTo: "both",
      });
    }
    if (
      node.branch === "principal-complex" ||
      closedComplexRequirement(node) ||
      childSpace === "complex"
    ) {
      valueSpace = "complex";
      ownEvidence.push(
        evidence(node, "realm-propagation", "complex", "complex power semantics are required")
      );
      if (
        !negativeExponent &&
        !complexPowerAllowsZeroBase(node.exp) &&
        !isProvenClosedNonzero(node.base)
      ) {
        requirements.push({
          kind: "nonzero",
          nodeId: node.base.id,
          expressionKey: keyOf(node.base),
          appliesTo: "complex",
        });
      }
    } else if (
      children[0]?.valueSpace === "real" &&
      children[1]?.valueSpace === "real"
    ) {
      valueSpace = "real";
      if (!isIntegerConstant(node.exp)) {
        // An odd-denominator rational power has its familiar real-root
        // interpretation on negative inputs. A general symbolic exponent
        // needs a positive base; an even-denominator rational needs a
        // nonnegative base.
        if (node.exp.kind !== "const" || Math.abs(node.exp.den) % 2 === 0) {
          requirements.push({
            kind: node.exp.kind === "const" ? "nonnegative" : "positive",
            nodeId: node.base.id,
            expressionKey: keyOf(node.base),
            appliesTo: "real",
          });
        }
      }
    } else {
      valueSpace = "unknown";
    }
  } else if (node.kind === "add" || node.kind === "mul") {
    valueSpace = childSpace;
    if (valueSpace === "complex") {
      ownEvidence.push(
        evidence(node, "realm-propagation", "complex", "a complex operand promotes the expression")
      );
    }
  } else if (node.kind === "derivative" || node.kind === "integral") {
    // The semantic layer does not choose a calculus interpretation. It merely
    // preserves a realm already established by the explicit calculus context.
    valueSpace = children[0]?.valueSpace ?? "unknown";
  }

  const branch = branchOperation(node);
  if (branch) {
    const active =
      node.kind === "pow" && node.branch === "principal-complex"
        ? true
        : branch === "argument"
        ? childSpace === "complex" || (node.kind === "fn" && closedComplexRequirement(node.arg))
        : valueSpace === "complex";
    branches.push({
      nodeId: node.id,
      expressionKey: keyOf(node),
      operation: branch,
      convention: "principal",
      active,
    });
  }

  return {
    valueSpace,
    evidence: uniqueEvidence([...childEvidence, ...ownEvidence]),
    requirements: uniqueRequirements(requirements),
    principalBranches: uniqueBranches(branches),
  };
};

/** Pure, non-mutating scalar-realm analysis for one expression. */
export function analyzeExpressionSemantics(
  expression: TNode,
  context: ExpressionSemanticContext = {}
): ExpressionSemantics {
  const analyzed = analyzeNode(expression, context);
  if (freeVarsIn(expression).size > 0) return analyzed;
  const evaluated = evalClosedNode(expression);
  return evaluated.ok
    ? { ...analyzed, closedValue: evaluated.value }
    : analyzed;
}

/**
 * Whether evaluating an expression needs complex arithmetic, even if a
 * real-valued wrapper such as Re, Im, |·|, or arg gives it a real result.
 * Result space alone is insufficient: Re(i·x) is real-valued but still must
 * not license real-only logarithm laws inside its argument.
 */
export const expressionRequiresComplexScalars = (
  expression: TNode,
  context: ExpressionSemanticContext = {}
): boolean => {
  const analyzed = analyzeExpressionSemantics(expression, context);
  return (
    analyzed.valueSpace === "complex" ||
    analyzed.evidence.some((item) => item.space === "complex") ||
    analyzed.principalBranches.some((branch) => branch.active)
  );
};

const sameVariable = (node: TNode, name: string): boolean =>
  node.kind === "var" && node.name === name;

const directUnaryInput = (
  expression: TNode,
  input: string,
  fn: string
): boolean =>
  expression.kind === "fn" &&
  String(expression.fn) === fn &&
  sameVariable(expression.arg, input);

const directSquareInput = (expression: TNode, input: string): boolean =>
  expression.kind === "pow" &&
  sameVariable(expression.base, input) &&
  expression.exp.kind === "const" &&
  expression.exp.num === 2 &&
  expression.exp.den === 1;

export function analyzeExactRange(
  expression: TNode,
  inputs: MappingInputSpace[]
): RangeAnalysis {
  if (freeVarsIn(expression).size === 0) {
    const evaluated = evalClosedNode(expression);
    if (evaluated.ok) {
      return {
        status: "exact",
        set: {
          kind: "singleton",
          expressionKey: keyOf(expression),
          value: evaluated.value,
        },
        rule: "constant",
      };
    }
  }

  if (inputs.length === 1) {
    const input = inputs[0];
    if (directSquareInput(expression, input.symbol)) {
      return input.space === "real"
        ? {
            status: "exact",
            set: { kind: "real", subset: "nonnegative" },
            rule: "square",
          }
        : {
            status: "exact",
            set: { kind: "complex", subset: "all" },
            rule: "square",
          };
    }
    if (directUnaryInput(expression, input.symbol, "exp")) {
      return input.space === "real"
        ? {
            status: "exact",
            set: { kind: "real", subset: "positive" },
            rule: "exponential",
          }
        : {
            status: "exact",
            set: { kind: "complex", subset: "nonzero" },
            rule: "exponential",
          };
    }
    if (directUnaryInput(expression, input.symbol, "abs")) {
      return {
        status: "exact",
        set: { kind: "real", subset: "nonnegative" },
        rule: "absolute-value",
      };
    }
  }

  return {
    status: "unknown",
    set: { kind: "unknown" },
    reason: "no-known-exact-rule",
  };
}

export function inferIsolationMemberships(
  isolation: ExplicitIsolation
): SymbolMembershipInference[] {
  const analyzed = analyzeExpressionSemantics(isolation.expression);
  if (freeVarsIn(isolation.expression).size === 0 && !analyzed.closedValue) return [];
  if (analyzed.valueSpace === "unknown") return [];
  return [{
    symbol: isolation.output,
    space: analyzed.valueSpace,
    status: "inferred",
    source: "explicit-isolation",
    evidence: analyzed.evidence,
  }];
}

const signatureId = (
  isolation: ExplicitIsolation,
  lens: MappingSignatureCandidate["lens"],
  inputs: MappingInputSpace[],
  outputSpace: ScalarValueSpace
): string => {
  const payload = [
    "mapping",
    isolation.output,
    lens,
    inputs.map((input) => `${input.symbol}:${input.space}`).join(","),
    outputSpace,
  ].join("|");
  // Protocol IDs are opaque and bounded. User-authored identifiers can be
  // thousands of characters long, so embedding them directly would advertise
  // IDs that the request schema could not accept back.
  const hash = (seed: number): string => {
    let value = seed >>> 0;
    for (let index = 0; index < payload.length; index++) {
      value ^= payload.charCodeAt(index);
      value = Math.imul(value, 16777619);
    }
    return (value >>> 0).toString(36);
  };
  return `mapping_${lens}_${hash(2166136261)}${hash(3339675911)}`;
};

const mappingCandidate = (
  isolation: ExplicitIsolation,
  lens: MappingSignatureCandidate["lens"],
  inputSpace: KnownScalarValueSpace | null
): MappingSignatureCandidate => {
  const names = Array.from(new Set(isolation.inputs)).sort();
  const inputs: MappingInputSpace[] = names.map((symbol) => ({
    symbol,
    space: inputSpace ?? "real",
  }));
  const context: ExpressionSemanticContext = inputSpace
    ? { symbolSpaces: Object.fromEntries(names.map((name) => [name, inputSpace])) }
    : {};
  const analyzed = analyzeExpressionSemantics(isolation.expression, context);
  return {
    id: signatureId(isolation, lens, inputs, analyzed.valueSpace),
    lens,
    recommended: lens === "constant" || lens === "default-real",
    inputs,
    output: {
      symbol: isolation.output,
      space: analyzed.valueSpace,
    },
    effectiveDomainRequirements: analyzed.requirements,
    range: analyzeExactRange(isolation.expression, inputs),
    evidence: analyzed.evidence,
    principalBranches: analyzed.principalBranches,
  };
};

/**
 * Mapping candidates use lazy commitment:
 * - a constant isolation has no invented input;
 * - every symbolic mapping gets a familiar real lens;
 * - the complex lens is an explicit alternative;
 * - neither variable spelling nor the output's name selects a realm.
 */
export function mappingSignatureCandidates(
  isolation: ExplicitIsolation
): MappingSignatureCandidate[] {
  const inputs = Array.from(new Set(isolation.inputs)).sort();
  if (inputs.length === 0) {
    return [mappingCandidate(isolation, "constant", null)];
  }
  return [
    mappingCandidate(isolation, "default-real", "real"),
    mappingCandidate(isolation, "complex-alternative", "complex"),
  ];
}

/** One-call API for the symbol book, mapping picker, and MCP serializer. */
export function analyzeIsolationSemantics(
  isolation: ExplicitIsolation
): IsolationSemantics {
  return {
    output: isolation.output,
    inputs: Array.from(new Set(isolation.inputs)).sort(),
    expression: analyzeExpressionSemantics(isolation.expression),
    inferredMemberships: inferIsolationMemberships(isolation),
    mappingCandidates: mappingSignatureCandidates(isolation),
  };
}
