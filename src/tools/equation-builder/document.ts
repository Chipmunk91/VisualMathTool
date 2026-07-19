import type { MoveStory } from "./share";
import {
  cloneTreeEq,
  ensureTreeEqIds,
  keyOf,
  symbolIdForName,
  type TNode,
  type TreeEq,
} from "./tree";

export type SymbolRole = "independent" | "dependent" | "parameter" | "unknown";
export type SymbolDomain = "real" | "integer" | "complex";

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
  role: SymbolRole;
  domain: SymbolDomain;
  unit?: string;
  dependsOn: string[];
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
}

export interface EquationDocument {
  schemaVersion: 1;
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
  }
};

const defaultRole = (name: string): SymbolRole =>
  name === "x" ? "independent" : name === "y" ? "dependent" : "unknown";

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
    role: defaultRole(name),
    domain: "real",
    dependsOn: [],
    assumptions: [],
    provenance: { createdBy: "parser", confirmedByHuman: false },
  }));
  const x = records.find((record) => record.name === "x");
  const y = records.find((record) => record.name === "y");
  if (x && y && y.role === "dependent") y.dependsOn = [x.id];
  return records;
}

/** Preserve authored metadata while adding/removing records as the equation changes. */
export function reconcileSymbols(equation: TreeEq, current: SymbolRecord[]): SymbolRecord[] {
  const existing = new Map(current.map((record) => [record.id, record]));
  return symbolsInEquation(equation).map((discovered) => existing.get(discovered.id) ?? discovered);
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
    schemaVersion: 1,
    documentId: options.documentId ?? `eq_${stableHash(keyOf(cloned.left) + keyOf(cloned.right))}`,
    revision: equationRevision(cloned),
    equation: cloned,
    symbols: reconcileSymbols(cloned, options.symbols ?? []),
    assumptions: options.assumptions ?? [],
    history: options.history ?? [],
    presentation: options.presentation,
  };
}
