/**
 * Semantic command boundary shared by pointer UI and AI adapters. Commands
 * contain no coordinates; geometry is translated into a gesture before it
 * reaches this module.
 */
import { opposite, type Side } from "./model";
import {
  equationRevision,
  predicateFromText,
  type EquationDocument,
  type EquationCommandTrace,
  type EquationEvent,
  type SymbolRecord,
} from "./document";
import { computeTreeOperation, type DragPayload, type DropTarget } from "./operations";
import { applyRewrite, detectRewritesEq } from "./rewrites";
import { applySpecialActionT, type SpecialActionRef } from "./specialactions";
import { listSpecialOperations, TOOL_ROWS, TOOL_ROW_ORDER } from "./registry";
import { addendsOf, cloneTreeEq, printNode, type TreeEq } from "./tree";
import { finalize, type TreeMoveResult, type TreeOutcome } from "./treemoves";
import { treeFactorLayout } from "./treeunits";
import {
  differentiateRelation,
  integrateRelation,
  type DifferentiationContext,
  type IntegrationContext,
} from "./calculus";
import type { RelationAnalysis, ViewSpec } from "./relation";
import { treeMoveStory } from "./treeanimation";
import type { EquationProtocolApi } from "./protocol";

export type EquationCommand =
  | { type: "gesture"; payload: DragPayload; target: DropTarget }
  | { type: "special-action"; action: SpecialActionRef }
  | { type: "rewrite"; side: Side; targetId: string; kind: "expand" | "factor" | "identity" }
  | { type: "differentiate"; context: DifferentiationContext }
  | { type: "integrate"; context: IntegrationContext };

export interface EquationCommandRequest {
  requestId: string;
  expectedRevision: string;
  actor: { kind: "human" | "ai"; name?: string };
  command: EquationCommand;
}

export type EquationCommandResult =
  | { status: "applied"; outcome: TreeOutcome; event: EquationEvent }
  | { status: "rejected"; reason: string }
  | { status: "stale"; revision: string };

/** Browser/MCP adapters expose this contract; React is not part of it. */
export interface EquationToolApi {
  /** Versioned transport-neutral contract used by browser and MCP adapters. */
  protocol: EquationProtocolApi;
  getDocument(): EquationDocument;
  analyzeRelation(): RelationAnalysis;
  setViewSpec(spec: ViewSpec | null): boolean;
  inspectNodes(): { id: string; kind: string; expression: string }[];
  listApplicableOperations(): ApplicableEquationOperation[];
  previewCommand(request: EquationCommandRequest): EquationCommandResult;
  applyCommand(request: EquationCommandRequest): EquationCommandResult;
  updateSymbol(symbolId: string, patch: Partial<Omit<SymbolRecord, "id">>): boolean;
}

export interface ApplicableEquationOperation {
  id: string;
  label: string;
  command: EquationCommand;
}

declare global {
  interface Window {
    visualMathEquation?: EquationToolApi;
  }
}

const traceFor = (command: EquationCommand): EquationCommandTrace => {
  switch (command.type) {
    case "gesture": {
      const payload = command.payload;
      const targets =
        payload.kind === "terms" || payload.kind === "factorGroup"
          ? payload.ids
          : "termId" in payload
            ? [payload.termId]
            : [];
      return {
        type: command.type,
        ruleId: `gesture.${payload.kind}.${command.target.kind}`,
        targets,
        arguments: { payload, target: command.target },
      };
    }
    case "special-action":
      return {
        type: command.type,
        ruleId: `special.${command.action.kind}`,
        targets: [command.action.nodeId],
        arguments: { side: command.action.side, n: command.action.n },
      };
    case "rewrite":
      return {
        type: command.type,
        ruleId: `rewrite.${command.kind}`,
        targets: [command.targetId],
        arguments: { side: command.side },
      };
    case "differentiate":
      return {
        type: command.type,
        ruleId: `calculus.differentiate.${command.context.mode}`,
        targets: [],
        arguments: { context: command.context },
      };
    case "integrate":
      return {
        type: command.type,
        ruleId: `calculus.integrate.${command.context.mode}`,
        targets: [],
        arguments: { context: command.context },
      };
  }
};

export function executeEquationCommand(equation: TreeEq, command: EquationCommand): TreeMoveResult {
  if (command.type === "gesture") return computeTreeOperation(equation, command.payload, command.target);
  if (command.type === "special-action") return applySpecialActionT(equation, command.action);
  if (command.type === "differentiate") {
    const result = differentiateRelation(equation, command.context);
    if (typeof result === "string") return result;
    return finalize(result.equation.left, result.equation.right, result.label, {
      note: result.note,
      pill: result.pill,
      dangerous: !!result.pill,
    });
  }
  if (command.type === "integrate") {
    const result = integrateRelation(equation, command.context);
    if (typeof result === "string") return result;
    return finalize(result.equation.left, result.equation.right, result.label, {
      note: result.note,
      pill: result.pill,
      dangerous: !!result.pill,
    });
  }
  const candidate = detectRewritesEq(equation).find(
    ({ side, rewrite }) =>
      side === command.side && rewrite.before.id === command.targetId && rewrite.kind === command.kind
  );
  if (!candidate) return "that rewrite is not available at this revision";
  const rewritten = applyRewrite(equation[command.side], candidate.rewrite);
  return finalize(
    command.side === "left" ? rewritten : equation.left,
    command.side === "right" ? rewritten : equation.right,
    candidate.rewrite.label,
    candidate.rewrite.pill
      ? {
          dangerous: true,
          note: `This identity is valid where ${candidate.rewrite.pill}.`,
          pill: candidate.rewrite.pill,
        }
      : undefined
  );
}

export function applyEquationCommand(
  equation: TreeEq,
  request: EquationCommandRequest
): EquationCommandResult {
  const beforeRevision = equationRevision(equation);
  if (request.expectedRevision !== beforeRevision) return { status: "stale", revision: beforeRevision };
  const result = executeEquationCommand(equation, request.command);
  if (!result || typeof result === "string") {
    return { status: "rejected", reason: result ?? "the command has no effect here" };
  }
  const outcome = request.command.type === "gesture" && !result.story
    ? { ...result, story: treeMoveStory(equation, request.command.payload, request.command.target) }
    : result;
  const afterRevision = equationRevision(outcome.treeNext);
  const trace = traceFor(request.command);
  const event: EquationEvent = {
    id: `event_${request.requestId}`,
    requestId: request.requestId,
    actor: request.actor,
    operation: trace,
    beforeRevision,
    afterRevision,
    before: cloneTreeEq(equation),
    intermediate: outcome.treeIntermediate ? cloneTreeEq(outcome.treeIntermediate) : undefined,
    after: cloneTreeEq(outcome.treeNext),
    assumptionsAdded: outcome.pill ? [predicateFromText(outcome.pill)] : [],
    explanation: outcome.note ?? outcome.label,
    animation: outcome.story,
    createdAt: new Date().toISOString(),
  };
  return { status: "applied", outcome, event };
}

export function inspectEquationNodes(equation: TreeEq): { id: string; kind: string; expression: string }[] {
  const nodes: { id: string; kind: string; expression: string }[] = [];
  const walk = (node: TreeEq["left"]) => {
    nodes.push({ id: node.id, kind: node.kind, expression: printNode(node) });
    if (node.kind === "add") node.terms.forEach(walk);
    else if (node.kind === "mul") node.factors.forEach(walk);
    else if (node.kind === "pow") { walk(node.base); walk(node.exp); }
    else if (node.kind === "fn") walk(node.arg);
    else if (node.kind === "derivative") walk(node.expression);
    else if (node.kind === "integral") {
      walk(node.integrand);
      if (node.bounds) { walk(node.bounds.lower); walk(node.bounds.upper); }
    }
  };
  walk(equation.left);
  walk(equation.right);
  return nodes;
}

/** Enumerate the concrete legal actions an AI can take at this revision. */
export function listApplicableEquationOperations(equation: TreeEq): ApplicableEquationOperation[] {
  const candidates: ApplicableEquationOperation[] = [];
  for (const side of ["left", "right"] as const) {
    const destination = opposite(side);
    for (const addend of addendsOf(equation[side])) {
      candidates.push({
        id: `move:${addend.id}:${destination}`,
        label: `Move ${printNode(addend)} to the ${destination}`,
        command: {
          type: "gesture",
          payload: { kind: "terms", ids: [addend.id], from: side },
          target: { kind: "side", side: destination },
        },
      });
      candidates.push({
        id: `divide:${addend.id}`,
        label: `Divide both sides by ${printNode(addend)}`,
        command: {
          type: "gesture",
          payload: { kind: "terms", ids: [addend.id], from: side },
          target: { kind: "under", termId: equation[destination].id, side: destination },
        },
      });
      const layout = treeFactorLayout(addend.id, addend);
      for (const factor of layout.numerator) {
        candidates.push({
          id: `divide-factor:${factor.id}`,
          label: `Divide both sides by ${printNode(factor.expr)}`,
          command: {
            type: "gesture",
            payload: {
              kind: factor.role === "coef" ? "coef" : "numer",
              termId: factor.id,
              from: side,
            },
            target: { kind: "side", side: destination },
          },
        });
      }
      for (const factor of layout.denominator) {
        candidates.push({
          id: `multiply-factor:${factor.id}`,
          label: `Multiply both sides by ${printNode(factor.expr)}`,
          command: {
            type: "gesture",
            payload: { kind: "den", termId: factor.id, from: side },
            target: { kind: "side", side: destination },
          },
        });
      }
    }

  }

  // Special actions come from the registry's tree walk — the SAME
  // anchorsForNode() the renderer derives its tap surfaces from, so an AI
  // caller discovers exactly what a hand can tap (minus the dry-run-filtered
  // teaching refusals below).
  for (const { id, label, action } of listSpecialOperations(equation)) {
    candidates.push({ id, label, command: { type: "special-action", action } });
  }

  for (const { side, rewrite } of detectRewritesEq(equation)) {
    candidates.push({
      id: `rewrite:${rewrite.kind}:${rewrite.before.id}`,
      label: rewrite.label,
      command: { type: "rewrite", side, targetId: rewrite.before.id, kind: rewrite.kind },
    });
  }

  for (const tool of TOOL_ROW_ORDER) {
    candidates.push({
      id: `tool:${tool}`,
      label: TOOL_ROWS[tool].protocolLabel,
      command: {
        type: "gesture",
        payload: { kind: "tool", tool },
        target: { kind: "side", side: "left" },
      },
    });
  }

  return candidates.filter((candidate) => {
    const result = executeEquationCommand(equation, candidate.command);
    return !!result && typeof result !== "string";
  });
}
