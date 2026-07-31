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
import {
  addendsOf,
  cloneTreeEq,
  ensureTreeEqIds,
  evalClosedNode,
  keyOf,
  printNode,
  simplify,
  varsIn,
  type TNode,
  type TreeEq,
} from "./tree";
import { assumeKeysOf, factsFromAssumptions } from "./facts";
import { finalize, type TreeMoveResult, type TreeOutcome } from "./treemoves";
import { treeFactorLayout } from "./treeunits";
import { scalarIsZero, scalarParts } from "./scalar";
import {
  differentiateRelation,
  integrateRelation,
  type DifferentiationContext,
  type IntegrationContext,
} from "./calculus";
import type { RelationAnalysis, ViewSpec } from "./relation";
import { treeMoveStory } from "./treeanimation";
import type { EquationProtocolApi } from "./protocol";
import {
  expressionRequiresComplexScalars,
  type ScalarOperationContext,
} from "./semantics";

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
  /**
   * Scalar algebra selected for this operation. Omit it for the familiar
   * real-first default; typed complex syntax can still promote that default.
   */
  operationContext?: ScalarOperationContext;
  /**
   * Standing assumption texts (history pills, symbol-book predicates). Facts
   * parsed from them license conditional simplifications on the command's
   * result — a step that assumed x ≠ 0 keeps licensing x-cancels later.
   */
  standingAssumptions?: string[];
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
  operationContext: ScalarOperationContext;
}

/**
 * Structural factor/addend actions can be proven executable without running a
 * whole simplify pass for every advertised handle. This keeps action
 * discovery linear for long sums while matching divideBothT/multiplyBothT's
 * exact closed-value refusals.
 */
const usableMultiplicativeOperand = (node: TNode): boolean => {
  if (varsIn(node).size > 0) return true;
  const evaluated = evalClosedNode(node);
  if (!evaluated.ok || scalarIsZero(evaluated.value)) return false;
  const { re, im } = scalarParts(evaluated.value);
  return re !== 1 || im !== 0;
};

declare global {
  interface Window {
    visualMathEquation?: EquationToolApi;
  }
}

const traceFor = (
  command: EquationCommand,
  operationContext: ScalarOperationContext
): EquationCommandTrace => {
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
        arguments: { payload, target: command.target, operationContext },
      };
    }
    case "special-action":
      return {
        type: command.type,
        ruleId: `special.${command.action.kind}`,
        targets: [command.action.nodeId],
        arguments: {
          side: command.action.side,
          n: command.action.n,
          operationContext,
        },
      };
    case "rewrite":
      return {
        type: command.type,
        ruleId: `rewrite.${command.kind}`,
        targets: [command.targetId],
        arguments: { side: command.side, operationContext },
      };
    case "differentiate":
      return {
        type: command.type,
        ruleId: `calculus.differentiate.${command.context.mode}`,
        targets: [],
        arguments: { context: command.context, operationContext },
      };
    case "integrate":
      return {
        type: command.type,
        ruleId: `calculus.integrate.${command.context.mode}`,
        targets: [],
        arguments: { context: command.context, operationContext },
      };
  }
};

/**
 * Resolve the actual scalar algebra used by a command. A selected complex
 * lens opts in explicitly; typed complex syntax remains a one-way promotion
 * so a caller cannot accidentally force `i` through real-only identities.
 */
export function resolveScalarOperationContext(
  equation: TreeEq,
  requested?: ScalarOperationContext
): ScalarOperationContext {
  const typedComplex =
    expressionRequiresComplexScalars(equation.left) ||
    expressionRequiresComplexScalars(equation.right);
  return {
    scalarRealm:
      requested?.scalarRealm === "complex" || typedComplex
        ? "complex"
        : "real",
    ...(requested?.mappingSignatureId
      ? { mappingSignatureId: requested.mappingSignatureId }
      : {}),
  };
}

/**
 * Execute with an already-resolved scalar context.
 *
 * Keep this boundary private: callers that have not inspected the equation
 * must use `executeEquationCommand`, while inventory/apply paths can resolve
 * the equation's scalar semantics once and reuse that exact decision.
 */
function executeEquationCommandResolved(
  equation: TreeEq,
  command: EquationCommand,
  operationContext: ScalarOperationContext
): TreeMoveResult {
  if (command.type === "gesture") {
    return computeTreeOperation(
      equation,
      command.payload,
      command.target,
      operationContext
    );
  }
  if (command.type === "special-action") {
    return applySpecialActionT(equation, command.action, operationContext);
  }
  if (command.type === "differentiate") {
    if (operationContext.scalarRealm === "complex") {
      return "choose a complex-calculus interpretation first: holomorphic, real-component, or Wirtinger differentiation";
    }
    const result = differentiateRelation(equation, command.context);
    if (typeof result === "string") return result;
    return finalize(result.equation.left, result.equation.right, result.label, {
      note: result.note,
      pill: result.pill,
      dangerous: !!result.pill,
      operationContext,
    });
  }
  if (command.type === "integrate") {
    if (operationContext.scalarRealm === "complex") {
      return "choose a contour or explicit real-parameter interpretation before integrating in the complex realm";
    }
    const result = integrateRelation(equation, command.context);
    if (typeof result === "string") return result;
    return finalize(result.equation.left, result.equation.right, result.label, {
      note: result.note,
      pill: result.pill,
      dangerous: !!result.pill,
      operationContext,
    });
  }
  const candidate = detectRewritesEq(equation, operationContext).find(
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
          operationContext,
        }
      : { operationContext }
  );
}

export function executeEquationCommand(
  equation: TreeEq,
  command: EquationCommand,
  requestedContext?: ScalarOperationContext
): TreeMoveResult {
  return executeEquationCommandResolved(
    equation,
    command,
    resolveScalarOperationContext(equation, requestedContext)
  );
}

/**
 * Re-simplify a command's result under the standing domain facts. A move's
 * own `assume` license is pointwise (the expression it just divided by);
 * this pass makes PAST declarations keep working — once a step assumed
 * x ≠ 0, a later x/x folds without asking again.
 */
const applyStandingFacts = (outcome: TreeOutcome, standing?: string[]): TreeOutcome => {
  if (!standing || standing.length === 0) return outcome;
  const keys = assumeKeysOf(factsFromAssumptions(standing));
  if (keys.size === 0) return outcome;
  const left = simplify(outcome.treeNext.left, keys);
  const right = simplify(outcome.treeNext.right, keys);
  if (keyOf(left) === keyOf(outcome.treeNext.left) && keyOf(right) === keyOf(outcome.treeNext.right)) {
    return outcome;
  }
  return {
    ...outcome,
    // the un-licensed result becomes the readable paper state when the move
    // didn't already stage one of its own
    treeIntermediate: outcome.treeIntermediate ?? outcome.treeNext,
    treeNext: ensureTreeEqIds({ left, right }),
  };
};

export function applyEquationCommand(
  equation: TreeEq,
  request: EquationCommandRequest
): EquationCommandResult {
  const beforeRevision = equationRevision(equation);
  if (request.expectedRevision !== beforeRevision) return { status: "stale", revision: beforeRevision };
  const operationContext = resolveScalarOperationContext(
    equation,
    request.operationContext
  );
  const result = executeEquationCommandResolved(
    equation,
    request.command,
    operationContext
  );
  if (!result || typeof result === "string") {
    return { status: "rejected", reason: result ?? "the command has no effect here" };
  }
  const licensed = applyStandingFacts(result, request.standingAssumptions);
  const outcome = request.command.type === "gesture" && !licensed.story
    ? { ...licensed, story: treeMoveStory(equation, request.command.payload, request.command.target) }
    : licensed;
  const afterRevision = equationRevision(outcome.treeNext);
  const trace = traceFor(request.command, operationContext);
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
    assumptionsUsed: Array.from(new Set(request.standingAssumptions ?? []))
      .sort()
      .map((assumption) => predicateFromText(assumption)),
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
export function listApplicableEquationOperations(
  equation: TreeEq,
  requestedContext?: ScalarOperationContext
): ApplicableEquationOperation[] {
  const operationContext = resolveScalarOperationContext(
    equation,
    requestedContext
  );
  const candidates: (Omit<
    ApplicableEquationOperation,
    "operationContext"
  > & { requiresDryRun: boolean })[] = [];
  for (const side of ["left", "right"] as const) {
    const destination = opposite(side);
    for (const addend of addendsOf(equation[side])) {
      candidates.push({
        id: `move:${addend.id}:${destination}`,
        label: `Move ${printNode(addend)} to the ${destination}`,
        requiresDryRun: false,
        command: {
          type: "gesture",
          payload: { kind: "terms", ids: [addend.id], from: side },
          target: { kind: "side", side: destination },
        },
      });
      if (usableMultiplicativeOperand(addend)) {
        candidates.push({
          id: `divide:${addend.id}`,
          label: `Divide both sides by ${printNode(addend)}`,
          requiresDryRun: false,
          command: {
            type: "gesture",
            payload: { kind: "terms", ids: [addend.id], from: side },
            target: { kind: "under", termId: equation[destination].id, side: destination },
          },
        });
      }
      const layout = treeFactorLayout(addend.id, addend);
      for (const factor of layout.numerator) {
        if (!usableMultiplicativeOperand(factor.expr)) continue;
        candidates.push({
          id: `divide-factor:${factor.id}`,
          label: `Divide both sides by ${printNode(factor.expr)}`,
          requiresDryRun: false,
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
        if (!usableMultiplicativeOperand(factor.expr)) continue;
        candidates.push({
          id: `multiply-factor:${factor.id}`,
          label: `Multiply both sides by ${printNode(factor.expr)}`,
          requiresDryRun: false,
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
    candidates.push({
      id,
      label,
      command: { type: "special-action", action },
      requiresDryRun: true,
    });
  }

  for (const { side, rewrite } of detectRewritesEq(
    equation,
    operationContext
  )) {
    candidates.push({
      id: `rewrite:${rewrite.kind}:${rewrite.before.id}`,
      label: rewrite.label,
      requiresDryRun: false,
      command: { type: "rewrite", side, targetId: rewrite.before.id, kind: rewrite.kind },
    });
  }

  for (const tool of TOOL_ROW_ORDER) {
    candidates.push({
      id: `tool:${tool}`,
      label: TOOL_ROWS[tool].protocolLabel,
      requiresDryRun: true,
      command: {
        type: "gesture",
        payload: { kind: "tool", tool },
        target: { kind: "side", side: "left" },
      },
    });
  }

  return candidates
    .filter((candidate) => {
      if (!candidate.requiresDryRun) return true;
      const result = executeEquationCommandResolved(
        equation,
        candidate.command,
        operationContext
      );
      return !!result && typeof result !== "string";
    })
    .map(({ requiresDryRun: _requiresDryRun, ...candidate }) => ({
      ...candidate,
      operationContext,
    }));
}
