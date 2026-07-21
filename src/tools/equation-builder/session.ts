import { z } from "zod";
import {
  equationRevision,
  makeEquationDocument,
  predicateFromText,
  reconcileSymbols,
  type EquationDocument,
  type EquationEvent,
} from "./document";
import {
  applyEquationCommand,
  executeEquationCommand,
  listApplicableEquationOperations,
  type ApplicableEquationOperation,
  type EquationCommand,
} from "./engine";
import { parseEquation } from "./parser";
import {
  ApplyPreviewRequestSchema,
  CreateEquationRequestSchema,
  DifferentiationActionArgumentsSchema,
  EmptyActionArgumentsSchema,
  EQUATION_PROTOCOL_VERSION,
  IntegrationActionArgumentsSchema,
  PreviewActionRequestSchema,
  SetProtocolViewRequestSchema,
  UpdateProtocolSymbolRequestSchema,
  type ApplyPreviewRequest,
  type CalculusContextDescriptor,
  type EquationActionDescriptor,
  type EquationActionKind,
  type EquationApplyResult,
  type EquationCreateResult,
  type DifferentiationActionArguments,
  type EquationPreviewResult,
  type EquationServiceError,
  type EquationServiceErrorCode,
  type EquationSymbolReference,
  type EquationUpdateResult,
  type IntegrationActionArguments,
  type ProtocolDocumentSnapshot,
  type ProtocolRelationAnalysis,
} from "./protocol";
import { analyzeRelation } from "./relation";
import { cloneTreeEq } from "./tree";

interface InventoryEntry {
  descriptor: EquationActionDescriptor;
  command?: EquationCommand;
}

interface StoredPreview {
  documentId: string;
  action: EquationActionDescriptor;
  command: EquationCommand;
  result: Extract<ReturnType<typeof applyEquationCommand>, { status: "applied" }>;
  consumed: boolean;
}

export interface EquationSessionServiceOptions {
  idFactory?: () => string;
  now?: () => Date;
  maxPreviews?: number;
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const defaultIdFactory = (): string => {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return randomUuid ? randomUuid() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

const errorResult = (
  code: EquationServiceErrorCode,
  message: string,
  details?: Record<string, unknown>
): EquationServiceError => ({ status: "error", code, message, details });

const schemaIssues = (error: z.ZodError): Record<string, unknown> => ({
  issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
});

const jsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema) as Record<string, unknown>;

const targetsForCommand = (command: EquationCommand): string[] => {
  if (command.type === "special-action") return [command.action.nodeId];
  if (command.type === "rewrite") return [command.targetId];
  if (command.type !== "gesture") return [];
  const payload = command.payload;
  if (payload.kind === "terms" || payload.kind === "factorGroup") return [...payload.ids];
  return "termId" in payload && payload.termId ? [payload.termId] : [];
};

const kindForOperation = (operation: ApplicableEquationOperation): EquationActionKind => {
  if (operation.command.type === "rewrite") return "rewrite";
  if (operation.command.type === "special-action") return "special";
  if (operation.command.type === "gesture" && operation.command.payload.kind === "tool") {
    return "transform";
  }
  return "algebra";
};

const warningsForCommand = (document: EquationDocument, command: EquationCommand): string[] => {
  const result = executeEquationCommand(document.equation, command);
  if (!result || typeof result === "string") return [];
  const warnings: string[] = [];
  if (result.pill) warnings.push(`Requires ${result.pill}.`);
  if (result.dangerous && !result.pill) warnings.push("This operation may change the solution set.");
  return warnings;
};

const symbolsForProtocol = (document: EquationDocument): EquationSymbolReference[] =>
  document.symbols.map(({ id, name, meaning, unit }) => ({ id, name, meaning, unit }));

const calculusContext = (document: EquationDocument): CalculusContextDescriptor => ({
  scope: {
    kind: "relation",
    description: "Apply the operator to both sides of the relation; no source or target side is inferred.",
  },
  operationVariableChoices: symbolsForProtocol(document),
  roleChoices: symbolsForProtocol(document),
  rolePolicy: "classify-every-other-symbol",
});

const calculusInputSchema = (
  document: EquationDocument,
  operation: "differentiate" | "integrate"
): Record<string, unknown> => {
  const base = cloneJson(jsonSchema(
    operation === "differentiate"
      ? DifferentiationActionArgumentsSchema
      : IntegrationActionArgumentsSchema
  ));
  const symbolIds = document.symbols.map((symbol) => symbol.id);
  const properties = (base.properties ?? {}) as Record<string, Record<string, unknown>>;
  properties.withRespectToSymbolId = {
    ...(properties.withRespectToSymbolId ?? {}),
    enum: symbolIds,
    description: "Stable ID of the variable of operation.",
  };
  properties.roles = {
    type: "object",
    description: "Classify every symbol except the operation variable.",
    propertyNames: { enum: symbolIds },
    additionalProperties: { enum: ["dependent", "held-constant"] },
  };
  base.properties = properties;
  return base;
};

const normalizedDocument = (document: EquationDocument): EquationDocument =>
  makeEquationDocument(cloneTreeEq(document.equation), {
    documentId: document.documentId,
    symbols: cloneJson(document.symbols),
    assumptions: cloneJson(document.assumptions),
    history: cloneJson(document.history),
    presentation: document.presentation ? cloneJson(document.presentation) : undefined,
  });

/**
 * Transport-neutral document/session boundary. React, DOM coordinates and MCP
 * transports are deliberately absent; all adapters call this same service.
 */
export class EquationSessionService {
  readonly protocolVersion = EQUATION_PROTOCOL_VERSION;
  private readonly documents = new Map<string, EquationDocument>();
  private readonly previews = new Map<string, StoredPreview>();
  private readonly appliedRequests = new Map<string, EquationApplyResult>();
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly maxPreviews: number;

  constructor(options: EquationSessionServiceOptions = {}) {
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.now = options.now ?? (() => new Date());
    this.maxPreviews = options.maxPreviews ?? 500;
  }

  createEquation(input: unknown): EquationCreateResult {
    const parsedInput = CreateEquationRequestSchema.safeParse(input);
    if (!parsedInput.success) {
      return errorResult("invalid_request", "The equation request is malformed.", schemaIssues(parsedInput.error));
    }
    const parsedEquation = parseEquation(parsedInput.data.text);
    if (!parsedEquation.ok) {
      return errorResult("invalid_request", parsedEquation.message, { stage: parsedEquation.stage });
    }
    const documentId = parsedInput.data.documentId ?? `eq_${this.idFactory()}`;
    if (this.documents.has(documentId)) {
      return errorResult("document_exists", `Document ${documentId} already exists.`);
    }
    const document = makeEquationDocument(parsedEquation.tree, { documentId });
    this.documents.set(documentId, document);
    return {
      status: "created",
      protocolVersion: EQUATION_PROTOCOL_VERSION,
      document: cloneJson(document),
    };
  }

  /** Synchronize an existing browser/share document into the service. */
  loadDocument(document: EquationDocument): EquationDocument {
    const normalized = normalizedDocument(document);
    const previous = this.documents.get(normalized.documentId);
    this.documents.set(normalized.documentId, normalized);
    if (previous && previous.revision !== normalized.revision) {
      this.previews.forEach((preview, token) => {
        if (preview.documentId === normalized.documentId && !preview.consumed) this.previews.delete(token);
      });
    }
    return cloneJson(normalized);
  }

  getDocument(documentId: string): EquationDocument | null {
    const document = this.documents.get(documentId);
    return document ? cloneJson(document) : null;
  }

  listDocumentIds(): string[] {
    return Array.from(this.documents.keys()).sort();
  }

  analyze(documentId: string): ProtocolRelationAnalysis | EquationServiceError {
    const document = this.documents.get(documentId);
    if (!document) return errorResult("document_not_found", `Document ${documentId} was not found.`);
    return {
      relation: analyzeRelation(document.equation),
      symbols: symbolsForProtocol(document),
    };
  }

  private inventory(document: EquationDocument): InventoryEntry[] {
    const entries = listApplicableEquationOperations(document.equation).map<InventoryEntry>((operation) => ({
      descriptor: {
        id: operation.id,
        label: operation.label,
        kind: kindForOperation(operation),
        revision: document.revision,
        targets: targetsForCommand(operation.command),
        inputSchema: jsonSchema(EmptyActionArgumentsSchema),
        warnings: warningsForCommand(document, operation.command),
      },
      command: operation.command,
    }));
    if (document.symbols.length > 0) {
      entries.push(
        {
          descriptor: {
            id: "calculus:differentiate",
            label: "Differentiate both sides with an explicit context",
            kind: "differentiate",
            revision: document.revision,
            targets: [document.equation.left.id, document.equation.right.id],
            inputSchema: calculusInputSchema(document, "differentiate"),
            context: calculusContext(document),
            warnings: [],
          },
        },
        {
          descriptor: {
            id: "calculus:integrate",
            label: "Integrate both sides with an explicit context",
            kind: "integrate",
            revision: document.revision,
            targets: [document.equation.left.id, document.equation.right.id],
            inputSchema: calculusInputSchema(document, "integrate"),
            context: calculusContext(document),
            warnings: [],
          },
        }
      );
    }
    return entries;
  }

  listActions(documentId: string): EquationActionDescriptor[] | EquationServiceError {
    const document = this.documents.get(documentId);
    if (!document) return errorResult("document_not_found", `Document ${documentId} was not found.`);
    return this.inventory(document).map(({ descriptor }) => cloneJson(descriptor));
  }

  private resolveCalculusCommand(
    document: EquationDocument,
    actionId: "calculus:differentiate" | "calculus:integrate",
    rawArguments: Record<string, unknown>
  ): EquationCommand | EquationServiceError {
    const parsed = actionId === "calculus:differentiate"
      ? DifferentiationActionArgumentsSchema.safeParse(rawArguments)
      : IntegrationActionArgumentsSchema.safeParse(rawArguments);
    if (!parsed.success) {
      return errorResult(
        "needs_context",
        "Choose the calculus mode, operation variable, and a role for every other symbol.",
        schemaIssues(parsed.error)
      );
    }
    const data = parsed.data as DifferentiationActionArguments | IntegrationActionArguments;
    const operationVariable = document.symbols.find(
      (symbol) => symbol.id === data.withRespectToSymbolId
    );
    if (!operationVariable) {
      return errorResult("needs_context", "The operation variable is not present in this document.", {
        withRespectToSymbolId: data.withRespectToSymbolId,
      });
    }
    const known = new Map(document.symbols.map((symbol) => [symbol.id, symbol]));
    const expectedRoleIds = document.symbols
      .filter((symbol) => symbol.id !== operationVariable.id)
      .map((symbol) => symbol.id);
    const suppliedRoleIds = Object.keys(data.roles);
    const missing = expectedRoleIds.filter((symbolId) => !(symbolId in data.roles));
    const invalid = suppliedRoleIds.filter(
      (symbolId) => symbolId === operationVariable.id || !known.has(symbolId)
    );
    if (missing.length > 0 || invalid.length > 0) {
      return errorResult(
        "needs_context",
        "Classify every non-operation symbol exactly once.",
        { missingSymbolIds: missing, invalidSymbolIds: invalid }
      );
    }
    const dependent = expectedRoleIds
      .filter((symbolId) => data.roles[symbolId] === "dependent")
      .map((symbolId) => known.get(symbolId)!.name);
    const heldConstant = expectedRoleIds
      .filter((symbolId) => data.roles[symbolId] === "held-constant")
      .map((symbolId) => known.get(symbolId)!.name);
    if (dependent.length === 0 && !data.treatAsIdentity) {
      return errorResult(
        "needs_context",
        "Mark at least one dependent symbol or explicitly confirm that the relation is an identity."
      );
    }
    if (actionId === "calculus:differentiate") {
      const differentiation = data as DifferentiationActionArguments;
      return {
        type: "differentiate",
        context: {
          mode: differentiation.mode,
          withRespectTo: operationVariable.name,
          dependent,
          heldConstant,
          treatAsIdentity: differentiation.treatAsIdentity,
        },
      };
    }
    const integration = data as IntegrationActionArguments;
    return {
      type: "integrate",
      context: {
        mode: integration.mode,
        withRespectTo: operationVariable.name,
        dependent,
        heldConstant,
        treatAsIdentity: integration.treatAsIdentity,
        bounds: integration.bounds
          ? [integration.bounds.lower, integration.bounds.upper]
          : undefined,
      },
    };
  }

  previewAction(input: unknown): EquationPreviewResult {
    const parsedRequest = PreviewActionRequestSchema.safeParse(input);
    if (!parsedRequest.success) {
      return errorResult("invalid_request", "The preview request is malformed.", schemaIssues(parsedRequest.error));
    }
    const request = parsedRequest.data;
    const document = this.documents.get(request.documentId);
    if (!document) return errorResult("document_not_found", `Document ${request.documentId} was not found.`);
    if (request.expectedRevision !== document.revision) {
      return errorResult("stale_revision", "The equation changed before this preview.", {
        expectedRevision: request.expectedRevision,
        currentRevision: document.revision,
      });
    }
    const entry = this.inventory(document).find(({ descriptor }) => descriptor.id === request.actionId);
    if (!entry) {
      return errorResult("action_not_found", `Action ${request.actionId} is not available at this revision.`);
    }
    let command = entry.command;
    if (request.actionId === "calculus:differentiate" || request.actionId === "calculus:integrate") {
      const resolved = this.resolveCalculusCommand(document, request.actionId, request.arguments);
      if ("status" in resolved) return resolved;
      command = resolved;
    } else {
      const parsedArguments = EmptyActionArgumentsSchema.safeParse(request.arguments);
      if (!parsedArguments.success) {
        return errorResult("invalid_request", "This action does not accept arguments.", schemaIssues(parsedArguments.error));
      }
    }
    if (!command) return errorResult("action_not_found", `Action ${request.actionId} has no executable command.`);
    const previewToken = `preview_${this.idFactory()}`;
    const applied = applyEquationCommand(document.equation, {
      requestId: previewToken,
      expectedRevision: document.revision,
      actor: request.actor,
      command,
      standingAssumptions: Array.from(
        new Set([
          ...document.assumptions.map((assumption) => assumption.expression),
          ...document.symbols.flatMap((symbol) => symbol.assumptions.map((assumption) => assumption.expression)),
        ])
      ),
    });
    if (applied.status === "stale") {
      return errorResult("stale_revision", "The equation changed before this preview.", {
        currentRevision: applied.revision,
      });
    }
    if (applied.status === "rejected") {
      const code = request.actionId.startsWith("calculus:") ? "needs_context" : "operation_rejected";
      return errorResult(code, applied.reason);
    }
    while (this.previews.size >= this.maxPreviews) {
      const oldest = this.previews.keys().next().value as string | undefined;
      if (!oldest) break;
      this.previews.delete(oldest);
    }
    this.previews.set(previewToken, {
      documentId: document.documentId,
      action: entry.descriptor,
      command,
      result: applied,
      consumed: false,
    });
    return {
      status: "previewed",
      protocolVersion: EQUATION_PROTOCOL_VERSION,
      previewToken,
      action: cloneJson(entry.descriptor),
      beforeRevision: applied.event.beforeRevision,
      afterRevision: applied.event.afterRevision,
      before: cloneTreeEq(applied.event.before),
      intermediate: applied.event.intermediate ? cloneTreeEq(applied.event.intermediate) : undefined,
      after: cloneTreeEq(applied.event.after),
      assumptionsAdded: cloneJson(applied.event.assumptionsAdded),
      warnings: [
        ...entry.descriptor.warnings,
        ...applied.event.assumptionsAdded.map((assumption) => `Requires ${assumption.expression}.`),
      ].filter((warning, index, warnings) => warnings.indexOf(warning) === index),
      explanation: applied.event.explanation,
    };
  }

  applyPreview(input: unknown): EquationApplyResult {
    const parsedRequest = ApplyPreviewRequestSchema.safeParse(input);
    if (!parsedRequest.success) {
      return errorResult("invalid_request", "The apply request is malformed.", schemaIssues(parsedRequest.error));
    }
    const request: ApplyPreviewRequest = parsedRequest.data;
    const idempotencyKey = `${request.documentId}:${request.requestId}`;
    const prior = this.appliedRequests.get(idempotencyKey);
    if (prior) return cloneJson(prior);
    const preview = this.previews.get(request.previewToken);
    if (!preview || preview.documentId !== request.documentId) {
      return errorResult("preview_not_found", "That preview token does not belong to this document.");
    }
    if (preview.consumed) return errorResult("preview_consumed", "That preview has already been applied.");
    const document = this.documents.get(request.documentId);
    if (!document) return errorResult("document_not_found", `Document ${request.documentId} was not found.`);
    if (document.revision !== preview.result.event.beforeRevision) {
      return errorResult("stale_revision", "The equation changed after the preview.", {
        previewRevision: preview.result.event.beforeRevision,
        currentRevision: document.revision,
      });
    }
    const event: EquationEvent = {
      ...cloneJson(preview.result.event),
      id: `event_${request.requestId}`,
      requestId: request.requestId,
      actor: request.actor,
      createdAt: this.now().toISOString(),
    };
    const assumptions = [...document.assumptions];
    for (const assumption of event.assumptionsAdded) {
      if (!assumptions.some((current) => current.id === assumption.id)) assumptions.push(assumption);
    }
    const nextEquation = cloneTreeEq(event.after);
    const nextDocument: EquationDocument = {
      ...document,
      revision: equationRevision(nextEquation),
      equation: nextEquation,
      symbols: reconcileSymbols(nextEquation, document.symbols),
      assumptions,
      history: [...document.history, event],
    };
    this.documents.set(document.documentId, nextDocument);
    preview.consumed = true;
    const result: EquationApplyResult = {
      status: "applied",
      protocolVersion: EQUATION_PROTOCOL_VERSION,
      previewToken: request.previewToken,
      document: cloneJson(nextDocument),
      event: cloneJson(event),
    };
    this.appliedRequests.set(idempotencyKey, result);
    return cloneJson(result);
  }

  updateSymbol(input: unknown): EquationUpdateResult {
    const parsedRequest = UpdateProtocolSymbolRequestSchema.safeParse(input);
    if (!parsedRequest.success) {
      return errorResult("invalid_request", "The symbol update is malformed.", schemaIssues(parsedRequest.error));
    }
    const request = parsedRequest.data;
    const document = this.documents.get(request.documentId);
    if (!document) return errorResult("document_not_found", `Document ${request.documentId} was not found.`);
    if (document.revision !== request.expectedRevision) {
      return errorResult("stale_revision", "The equation changed before the symbol update.", {
        currentRevision: document.revision,
      });
    }
    if (!document.symbols.some((symbol) => symbol.id === request.symbolId)) {
      return errorResult("symbol_not_found", `Symbol ${request.symbolId} was not found.`);
    }
    const source = request.actor.kind === "ai" ? "ai" : "human";
    const symbols = document.symbols.map((symbol) => {
      if (symbol.id !== request.symbolId) return symbol;
      return {
        ...symbol,
        meaning: request.patch.meaning === null ? undefined : request.patch.meaning ?? symbol.meaning,
        unit: request.patch.unit === null ? undefined : request.patch.unit ?? symbol.unit,
        assumptions: request.patch.assumptions
          ? request.patch.assumptions.map((text) => predicateFromText(text, source))
          : symbol.assumptions,
        provenance: {
          ...symbol.provenance,
          confirmedByHuman: request.actor.kind === "human" || symbol.provenance.confirmedByHuman,
        },
      };
    });
    const nextDocument = { ...document, symbols };
    this.documents.set(document.documentId, nextDocument);
    return {
      status: "updated",
      protocolVersion: EQUATION_PROTOCOL_VERSION,
      document: cloneJson(nextDocument),
    };
  }

  setView(input: unknown): EquationUpdateResult {
    const parsedRequest = SetProtocolViewRequestSchema.safeParse(input);
    if (!parsedRequest.success) {
      return errorResult("invalid_request", "The view request is malformed.", schemaIssues(parsedRequest.error));
    }
    const request = parsedRequest.data;
    const document = this.documents.get(request.documentId);
    if (!document) return errorResult("document_not_found", `Document ${request.documentId} was not found.`);
    if (document.revision !== request.expectedRevision) {
      return errorResult("stale_revision", "The equation changed before the view update.", {
        currentRevision: document.revision,
      });
    }
    const analysis = analyzeRelation(document.equation);
    const viewSpec = request.candidateId === null
      ? undefined
      : analysis.viewCandidates.find((candidate) => candidate.id === request.candidateId)?.spec;
    if (request.candidateId !== null && !viewSpec) {
      return errorResult("view_not_found", `View ${request.candidateId} is not valid at this revision.`);
    }
    const nextDocument: EquationDocument = {
      ...document,
      presentation: {
        ...document.presentation,
        viewSpec,
      },
    };
    this.documents.set(document.documentId, nextDocument);
    return {
      status: "updated",
      protocolVersion: EQUATION_PROTOCOL_VERSION,
      document: cloneJson(nextDocument),
    };
  }

  snapshot(documentId: string): ProtocolDocumentSnapshot | EquationServiceError {
    const document = this.documents.get(documentId);
    if (!document) return errorResult("document_not_found", `Document ${documentId} was not found.`);
    const analysis = this.analyze(documentId);
    const actions = this.listActions(documentId);
    if ("status" in analysis) return analysis;
    if (!Array.isArray(actions)) return actions;
    return {
      protocolVersion: EQUATION_PROTOCOL_VERSION,
      document: cloneJson(document),
      analysis: cloneJson(analysis),
      actions: cloneJson(actions),
    };
  }
}
