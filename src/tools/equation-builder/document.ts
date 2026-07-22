import type { MoveStory } from "./share";
import {
  cloneTreeEq,
  ensureTreeEqIds,
  keyOf,
  symbolIdForName,
  type TNode,
  type TreeEq,
} from "./tree";
import type { DifferentiationContext, IntegrationContext } from "./calculus";
import type { ViewSpec } from "./relation";

export interface Predicate {
  id: string;
  expression: string;
  source: "operation" | "human" | "ai";
}

export interface SymbolRecord {
  /** Stable identity used by tree occurrences and external commands. */
  id: string;
  name: string;
  meaning?: string;
  unit?: string;
  /**
   * Declared dependency edges: the NAMES this symbol is a function of
   * (y(x) → ["x"]). Durable knowledge like assumptions — calculus readiness
   * derives dependent/held classification from graph reachability instead
   * of asking per operation.
   */
  dependsOn?: string[];
  assumptions: Predicate[];
  provenance: {
    createdBy: "parser" | "human" | "ai";
    confirmedByHuman: boolean;
  };
}

export interface EquationCommandTrace {
  type: string;
  ruleId: string;
  targets: string[];
  arguments: Record<string, unknown>;
}

export interface EquationEvent {
  id: string;
  requestId: string;
  actor: { kind: "human" | "ai"; name?: string };
  operation: EquationCommandTrace;
  beforeRevision: string;
  afterRevision: string;
  before: TreeEq;
  intermediate?: TreeEq;
  after: TreeEq;
  assumptionsAdded: Predicate[];
  explanation: string;
  animation?: MoveStory;
  createdAt: string;
}

export interface EquationPresentation {
  functionView?: "mapping" | "slope" | "area";
  integrationBounds?: [number, number];
  probeValue?: number;
  planeProbe?: [number, number];
  viewSpec?: ViewSpec;
  lastDifferentiationContext?: DifferentiationContext;
  lastIntegrationContext?: IntegrationContext;
}

export interface EquationDocument {
  schemaVersion: 2;
  documentId: string;
  revision: string;
  equation: TreeEq;
  symbols: SymbolRecord[];
  assumptions: Predicate[];
  history: EquationEvent[];
  presentation?: EquationPresentation;
}

const stableHash = (text: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const equationRevision = (equation: TreeEq): string =>
  `rev_${stableHash(`${keyOf(equation.left)}=${keyOf(equation.right)}`)}`;

export const predicateFromText = (
  expression: string,
  source: Predicate["source"] = "operation"
): Predicate => ({
  id: `pred_${stableHash(expression)}`,
  expression,
  source,
});

const visitVariables = (node: TNode, visit: (node: Extract<TNode, { kind: "var" }>) => void) => {
  switch (node.kind) {
    case "var":
      visit(node);
      break;
    case "add":
      node.terms.forEach((term) => visitVariables(term, visit));
      break;
    case "mul":
      node.factors.forEach((factor) => visitVariables(factor, visit));
      break;
    case "pow":
      visitVariables(node.base, visit);
      visitVariables(node.exp, visit);
      break;
    case "fn":
      visitVariables(node.arg, visit);
      break;
    case "derivative":
      visitVariables(node.expression, visit);
      visit({
        id: node.id,
        kind: "var",
        name: node.variable.name,
        symbolId: node.variable.symbolId,
      });
      break;
    case "integral":
      visitVariables(node.integrand, visit);
      visit({
        id: node.id,
        kind: "var",
        name: node.variable.name,
        symbolId: node.variable.symbolId,
      });
      if (node.bounds) {
        visitVariables(node.bounds.lower, visit);
        visitVariables(node.bounds.upper, visit);
      }
      break;
  }
};

export function symbolsInEquation(equation: TreeEq): SymbolRecord[] {
  const found = new Map<string, { id: string; name: string }>();
  const collect = (node: TNode) =>
    visitVariables(node, (variable) => {
      const id = variable.symbolId || symbolIdForName(variable.name);
      if (!found.has(id)) found.set(id, { id, name: variable.name });
    });
  collect(equation.left);
  collect(equation.right);
  const records = Array.from(found.values()).map<SymbolRecord>(({ id, name }) => ({
    id,
    name,
    assumptions: [],
    provenance: { createdBy: "parser", confirmedByHuman: false },
  }));
  return records;
}

/** Preserve authored metadata while adding/removing records as the equation changes. */
export function reconcileSymbols(equation: TreeEq, current: SymbolRecord[]): SymbolRecord[] {
  const existing = new Map(current.map((record) => [record.id, record]));
  const presentNames = new Set(symbolsInEquation(equation).map((record) => record.name));
  return symbolsInEquation(equation).map((discovered) => {
    const authored = existing.get(discovered.id);
    if (!authored) return discovered;
    // Explicit reconstruction is also the v1 migration: stale role/domain
    // properties from older share links are intentionally dropped. Declared
    // dependency edges survive, pruned to symbols still in the equation.
    // v1 stored dependsOn as symbol IDS — those never match present names,
    // so the same prune that drops stale edges also migrates old records.
    const dependsOn = (Array.isArray(authored.dependsOn) ? authored.dependsOn : []).filter(
      (name) => presentNames.has(name) && name !== discovered.name
    );
    return {
      id: discovered.id,
      name: discovered.name,
      meaning: authored.meaning,
      unit: authored.unit,
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
      assumptions: Array.isArray(authored.assumptions) ? authored.assumptions : [],
      provenance: authored.provenance ?? discovered.provenance,
    };
  });
}

export function renameSymbol(equation: TreeEq, symbolId: string, nextName: string): TreeEq {
  const rename = (node: TNode): TNode => {
    switch (node.kind) {
      case "var":
        return node.symbolId === symbolId ? { ...node, name: nextName } : node;
      case "add":
        return { ...node, terms: node.terms.map(rename) };
      case "mul":
        return { ...node, factors: node.factors.map(rename) };
      case "pow":
        return { ...node, base: rename(node.base), exp: rename(node.exp) };
      case "fn":
        return { ...node, arg: rename(node.arg) };
      case "derivative":
        return {
          ...node,
          expression: rename(node.expression),
          variable: node.variable.symbolId === symbolId
            ? { ...node.variable, name: nextName }
            : node.variable,
        };
      case "integral":
        return {
          ...node,
          integrand: rename(node.integrand),
          variable: node.variable.symbolId === symbolId
            ? { ...node.variable, name: nextName }
            : node.variable,
          bounds: node.bounds
            ? { lower: rename(node.bounds.lower), upper: rename(node.bounds.upper) }
            : undefined,
        };
      default:
        return node;
    }
  };
  return ensureTreeEqIds({ left: rename(equation.left), right: rename(equation.right) });
}

export function makeEquationDocument(
  equation: TreeEq,
  options: Partial<Pick<EquationDocument, "documentId" | "symbols" | "assumptions" | "history" | "presentation">> = {}
): EquationDocument {
  const cloned = cloneTreeEq(equation);
  return {
    schemaVersion: 2,
    documentId: options.documentId ?? `eq_${stableHash(keyOf(cloned.left) + keyOf(cloned.right))}`,
    revision: equationRevision(cloned),
    equation: cloned,
    symbols: reconcileSymbols(cloned, options.symbols ?? []),
    assumptions: options.assumptions ?? [],
    history: options.history ?? [],
    presentation: options.presentation,
  };
}
