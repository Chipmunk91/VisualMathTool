import { z } from "zod";
import type { EquationDocument, EquationEvent, SymbolRecord } from "./document";
import type { RelationAnalysis, ViewSpec } from "./relation";
import type { TreeEq } from "./tree";

export const EQUATION_PROTOCOL_VERSION = "visualmath.equation.v1" as const;

const IdentifierSchema = z.string().trim().min(1).max(256);
const RevisionSchema = z.string().trim().min(1).max(256);

export const EquationActorSchema = z.object({
  kind: z.enum(["human", "ai"]),
  name: z.string().trim().min(1).max(160).optional(),
}).strict();

export const CreateEquationRequestSchema = z.object({
  text: z.string().trim().min(3).max(20_000),
  documentId: IdentifierSchema.optional(),
}).strict();

export const DocumentRequestSchema = z.object({
  documentId: IdentifierSchema,
}).strict();

export const PreviewActionRequestSchema = z.object({
  documentId: IdentifierSchema,
  expectedRevision: RevisionSchema,
  actionId: IdentifierSchema,
  arguments: z.record(z.string(), z.unknown()).default({}),
  actor: EquationActorSchema,
}).strict();

export const ApplyPreviewRequestSchema = z.object({
  documentId: IdentifierSchema,
  previewToken: IdentifierSchema,
  requestId: IdentifierSchema,
  actor: EquationActorSchema,
}).strict();

export const UpdateProtocolSymbolRequestSchema = z.object({
  documentId: IdentifierSchema,
  expectedRevision: RevisionSchema,
  symbolId: IdentifierSchema,
  patch: z.object({
    meaning: z.string().max(1_000).nullable().optional(),
    unit: z.string().max(160).nullable().optional(),
    assumptions: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  }).strict(),
  actor: EquationActorSchema,
}).strict();

export const SetProtocolViewRequestSchema = z.object({
  documentId: IdentifierSchema,
  expectedRevision: RevisionSchema,
  candidateId: z.string().trim().min(1).max(500).nullable(),
}).strict();

export const EmptyActionArgumentsSchema = z.object({}).strict();

const CalculusRoleSchema = z.enum(["dependent", "held-constant"]);

const CalculusBaseSchema = z.object({
  withRespectToSymbolId: IdentifierSchema,
  roles: z.record(IdentifierSchema, CalculusRoleSchema),
  treatAsIdentity: z.boolean().optional(),
});

export const DifferentiationActionArgumentsSchema = CalculusBaseSchema.extend({
  mode: z.enum(["ordinary", "partial", "implicit", "total"]),
}).strict();

export const IntegrationActionArgumentsSchema = CalculusBaseSchema.extend({
  mode: z.enum(["ordinary", "partial"]),
  bounds: z.object({
    lower: z.number().finite(),
    // A string upper bound ACCUMULATES: the integral runs to a newborn
    // symbol (∫₀ᵘ). Name legality is validated by the calculus context.
    upper: z.union([z.number().finite(), z.string().trim().min(1).max(8)]),
  }).strict().optional(),
}).strict();

export type EquationActor = z.infer<typeof EquationActorSchema>;
export type CreateEquationRequest = z.infer<typeof CreateEquationRequestSchema>;
export type PreviewActionRequest = z.infer<typeof PreviewActionRequestSchema>;
export type ApplyPreviewRequest = z.infer<typeof ApplyPreviewRequestSchema>;
export type UpdateProtocolSymbolRequest = z.infer<typeof UpdateProtocolSymbolRequestSchema>;
export type SetProtocolViewRequest = z.infer<typeof SetProtocolViewRequestSchema>;
export type DifferentiationActionArguments = z.infer<typeof DifferentiationActionArgumentsSchema>;
export type IntegrationActionArguments = z.infer<typeof IntegrationActionArgumentsSchema>;

export interface EquationSymbolReference {
  id: string;
  name: string;
  meaning?: string;
  unit?: string;
}

export interface ProtocolRelationAnalysis {
  relation: RelationAnalysis;
  symbols: EquationSymbolReference[];
}

export type EquationActionKind =
  | "algebra"
  | "transform"
  | "special"
  | "rewrite"
  | "differentiate"
  | "integrate";

export interface CalculusContextDescriptor {
  scope: { kind: "relation"; description: string };
  operationVariableChoices: EquationSymbolReference[];
  roleChoices: EquationSymbolReference[];
  rolePolicy: "classify-every-other-symbol";
}

export interface EquationActionDescriptor {
  id: string;
  label: string;
  kind: EquationActionKind;
  revision: string;
  targets: string[];
  inputSchema: Record<string, unknown>;
  context?: CalculusContextDescriptor;
  warnings: string[];
}

export type EquationServiceErrorCode =
  | "invalid_request"
  | "document_not_found"
  | "document_exists"
  | "stale_revision"
  | "action_not_found"
  | "needs_context"
  | "operation_rejected"
  | "preview_not_found"
  | "preview_consumed"
  | "symbol_not_found"
  | "view_not_found";

export interface EquationServiceError {
  status: "error";
  code: EquationServiceErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface EquationCreatedResult {
  status: "created";
  protocolVersion: typeof EQUATION_PROTOCOL_VERSION;
  document: EquationDocument;
}

export interface EquationPreviewedResult {
  status: "previewed";
  protocolVersion: typeof EQUATION_PROTOCOL_VERSION;
  previewToken: string;
  action: EquationActionDescriptor;
  beforeRevision: string;
  afterRevision: string;
  before: TreeEq;
  intermediate?: TreeEq;
  after: TreeEq;
  assumptionsAdded: EquationEvent["assumptionsAdded"];
  warnings: string[];
  explanation: string;
}

export interface EquationAppliedResult {
  status: "applied";
  protocolVersion: typeof EQUATION_PROTOCOL_VERSION;
  previewToken: string;
  document: EquationDocument;
  event: EquationEvent;
}

export interface EquationUpdatedResult {
  status: "updated";
  protocolVersion: typeof EQUATION_PROTOCOL_VERSION;
  document: EquationDocument;
}

export type EquationCreateResult = EquationCreatedResult | EquationServiceError;
export type EquationPreviewResult = EquationPreviewedResult | EquationServiceError;
export type EquationApplyResult = EquationAppliedResult | EquationServiceError;
export type EquationUpdateResult = EquationUpdatedResult | EquationServiceError;

export interface EquationProtocolApi {
  readonly version: typeof EQUATION_PROTOCOL_VERSION;
  getDocument(): EquationDocument;
  analyze(): ProtocolRelationAnalysis;
  listActions(): EquationActionDescriptor[];
  previewAction(request: PreviewActionRequest): EquationPreviewResult;
  applyPreview(request: ApplyPreviewRequest): EquationApplyResult;
  updateSymbol(request: UpdateProtocolSymbolRequest): EquationUpdateResult;
  setView(request: SetProtocolViewRequest): EquationUpdateResult;
}

export interface ProtocolDocumentSnapshot {
  protocolVersion: typeof EQUATION_PROTOCOL_VERSION;
  document: EquationDocument;
  analysis: ProtocolRelationAnalysis;
  actions: EquationActionDescriptor[];
}

/** Presentation types remain domain types; protocol callers choose advertised candidates. */
export type ProtocolViewSpec = ViewSpec;
export type ProtocolSymbolRecord = SymbolRecord;
