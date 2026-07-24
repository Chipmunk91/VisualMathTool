import { freeVarsIn, type TNode, type TreeEq } from "./tree";

/**
 * A relation is always symmetric: left = right. Explicit functions, implicit
 * curves and one-variable equations are interpretations of that relation,
 * never alternate equation models.
 */
export interface ExplicitIsolation {
  output: string;
  expression: TNode;
  sourceSide: "left" | "right";
  inputs: string[];
}

export type ViewSpec =
  | {
      kind: "function-1d";
      input: string;
      output: string;
      fixed: Record<string, number>;
    }
  | {
      kind: "relation-1d";
      input: string;
      fixed: Record<string, number>;
    }
  | {
      kind: "implicit-2d";
      horizontal: string;
      vertical: string;
      fixed: Record<string, number>;
    }
  | {
      kind: "scalar-field-2d";
      horizontal: string;
      vertical: string;
      output: string;
      fixed: Record<string, number>;
    };

export interface ViewCandidate {
  id: string;
  label: string;
  spec: ViewSpec;
  reason: "explicit-isolation" | "one-variable-relation" | "implicit-relation";
}

export interface CalculusCandidate {
  withRespectTo: string;
  /** Possible dependents are suggestions only. A calculus command must name them explicitly. */
  possibleDependents: string[];
}

export interface RelationAnalysis {
  symbols: string[];
  hasUnresolvedOperators: boolean;
  isolations: ExplicitIsolation[];
  viewCandidates: ViewCandidate[];
  calculusCandidates: CalculusCandidate[];
}

const sorted = (values: Iterable<string>): string[] => Array.from(new Set(values)).sort();
const fixedValues = (names: string[]): Record<string, number> =>
  Object.fromEntries(names.map((name) => [name, 1]));

const containsUnresolvedOperator = (node: TNode): boolean => {
  switch (node.kind) {
    case "derivative":
    case "integral":
      return true;
    case "add":
      return node.terms.some(containsUnresolvedOperator);
    case "mul":
      return node.factors.some(containsUnresolvedOperator);
    case "pow":
      return containsUnresolvedOperator(node.base) || containsUnresolvedOperator(node.exp);
    case "fn":
      return containsUnresolvedOperator(node.arg);
    default:
      return false;
  }
};

const candidateId = (spec: ViewSpec): string => {
  switch (spec.kind) {
    case "function-1d":
      return `function:${spec.output}:${spec.input}`;
    case "relation-1d":
      return `relation:${spec.input}`;
    case "implicit-2d":
      return `implicit:${spec.horizontal}:${spec.vertical}`;
    case "scalar-field-2d":
      return `field:${spec.output}:${spec.horizontal}:${spec.vertical}`;
  }
};

const viewLabel = (spec: ViewSpec): string => {
  const held = Object.keys(spec.fixed);
  const suffix = held.length > 0 ? `; hold ${held.join(", ")}` : "";
  switch (spec.kind) {
    case "function-1d":
      return `${spec.output} against ${spec.input}${suffix}`;
    case "relation-1d":
      return `relation along ${spec.input}${suffix}`;
    case "implicit-2d":
      return `implicit curve in ${spec.horizontal}, ${spec.vertical}${suffix}`;
    case "scalar-field-2d":
      return `${spec.output} over ${spec.horizontal}, ${spec.vertical}${suffix}`;
  }
};

/** Pure structural analysis: no solving and no preferred x/y convention. */
export function analyzeRelation(equation: TreeEq): RelationAnalysis {
  // Free occurrences only: a definite integral's spent dummy is not a symbol
  // of the relation, while a symbolic bound (∫₀ᵘ) is.
  const symbols = sorted([...Array.from(freeVarsIn(equation.left)), ...Array.from(freeVarsIn(equation.right))]);
  const hasUnresolvedOperators =
    containsUnresolvedOperator(equation.left) || containsUnresolvedOperator(equation.right);
  const isolations: ExplicitIsolation[] = [];
  const detect = (candidate: TNode, expression: TNode, sourceSide: "left" | "right") => {
    if (candidate.kind !== "var") return;
    const expressionSymbols = freeVarsIn(expression);
    if (expressionSymbols.has(candidate.name)) return;
    isolations.push({
      output: candidate.name,
      expression,
      sourceSide,
      inputs: sorted(expressionSymbols),
    });
  };
  detect(equation.left, equation.right, "left");
  detect(equation.right, equation.left, "right");

  const viewCandidates: ViewCandidate[] = [];
  const addView = (spec: ViewSpec, reason: ViewCandidate["reason"]) => {
    if (hasUnresolvedOperators) return;
    const id = candidateId(spec);
    if (viewCandidates.some((candidate) => candidate.id === id)) return;
    viewCandidates.push({ id, label: viewLabel(spec), spec, reason });
  };

  for (const isolation of isolations) {
    for (const input of isolation.inputs) {
      addView(
        {
          kind: "function-1d",
          input,
          output: isolation.output,
          fixed: fixedValues(isolation.inputs.filter((name) => name !== input)),
        },
        "explicit-isolation"
      );
    }
    if (isolation.inputs.length === 2) {
      addView(
        {
          kind: "scalar-field-2d",
          horizontal: isolation.inputs[0],
          vertical: isolation.inputs[1],
          output: isolation.output,
          fixed: {},
        },
        "explicit-isolation"
      );
    }
  }

  if (symbols.length === 1) {
    addView({ kind: "relation-1d", input: symbols[0], fixed: {} }, "one-variable-relation");
  }

  // Every pair is a legitimate 2-D slice. The user chooses which symbols
  // vary; all remaining symbols become explicit fixed parameters.
  if (symbols.length >= 2) {
    for (let first = 0; first < symbols.length; first++) {
      for (let second = first + 1; second < symbols.length; second++) {
        const horizontal = symbols[first];
        const vertical = symbols[second];
        addView(
          {
            kind: "implicit-2d",
            horizontal,
            vertical,
            fixed: fixedValues(symbols.filter((name) => name !== horizontal && name !== vertical)),
          },
          "implicit-relation"
        );
      }
    }
  }

  return {
    symbols,
    hasUnresolvedOperators,
    isolations,
    viewCandidates,
    calculusCandidates: symbols.map((withRespectTo) => ({
      withRespectTo,
      possibleDependents: symbols.filter((name) => name !== withRespectTo),
    })),
  };
}

export function isolationForView(
  analysis: RelationAnalysis,
  spec: Extract<ViewSpec, { kind: "function-1d" | "scalar-field-2d" }>
): ExplicitIsolation | null {
  return analysis.isolations.find((isolation) => isolation.output === spec.output) ?? null;
}

export function isViewSpecValid(spec: ViewSpec, analysis: RelationAnalysis): boolean {
  const known = new Set(analysis.symbols);
  const fixedNames = Object.keys(spec.fixed);
  if (fixedNames.some((name) => !known.has(name) || !Number.isFinite(spec.fixed[name]))) return false;
  switch (spec.kind) {
    case "function-1d": {
      const isolation = isolationForView(analysis, spec);
      return !!isolation && isolation.inputs.includes(spec.input) &&
        fixedNames.every((name) => isolation.inputs.includes(name) && name !== spec.input) &&
        isolation.inputs.every((name) => name === spec.input || fixedNames.includes(name));
    }
    case "scalar-field-2d": {
      const isolation = isolationForView(analysis, spec);
      return !!isolation && spec.horizontal !== spec.vertical &&
        isolation.inputs.includes(spec.horizontal) && isolation.inputs.includes(spec.vertical) &&
        fixedNames.every((name) =>
          isolation.inputs.includes(name) && name !== spec.horizontal && name !== spec.vertical
        ) &&
        isolation.inputs.every((name) =>
          name === spec.horizontal || name === spec.vertical || fixedNames.includes(name)
        );
    }
    case "relation-1d":
      return known.has(spec.input) && fixedNames.every((name) => name !== spec.input) &&
        analysis.symbols.every((name) => name === spec.input || fixedNames.includes(name));
    case "implicit-2d":
      return spec.horizontal !== spec.vertical && known.has(spec.horizontal) && known.has(spec.vertical) &&
        fixedNames.every((name) => name !== spec.horizontal && name !== spec.vertical) &&
        analysis.symbols.every((name) =>
          name === spec.horizontal || name === spec.vertical || fixedNames.includes(name)
        );
  }
}

/**
 * Auto-select only when the interpretation is genuinely unique. Multivariable
 * alternatives remain unselected until a human or API caller chooses one.
 */
export function unambiguousView(analysis: RelationAnalysis): ViewSpec | null {
  if (analysis.hasUnresolvedOperators) return null;
  if (analysis.isolations.length === 1) {
    const isolation = analysis.isolations[0];
    if (isolation.inputs.length === 1) {
      return {
        kind: "function-1d",
        input: isolation.inputs[0],
        output: isolation.output,
        fixed: {},
      };
    }
    if (isolation.inputs.length === 2) {
      return {
        kind: "scalar-field-2d",
        horizontal: isolation.inputs[0],
        vertical: isolation.inputs[1],
        output: isolation.output,
        fixed: {},
      };
    }
  }
  if (analysis.symbols.length === 1) {
    return { kind: "relation-1d", input: analysis.symbols[0], fixed: {} };
  }
  if (analysis.symbols.length === 2 && analysis.isolations.length === 0) {
    return {
      kind: "implicit-2d",
      horizontal: analysis.symbols[0],
      vertical: analysis.symbols[1],
      fixed: {},
    };
  }
  return null;
}

export const viewSpecKey = (spec: ViewSpec | null | undefined): string =>
  spec ? JSON.stringify(spec) : "none";
