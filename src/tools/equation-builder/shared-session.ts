import type { EquationDocument, EquationEvent } from "./document";
import {
  EquationSessionService,
  type EquationSessionState,
} from "./session";
import type {
  ApplyPreviewRequest,
  EquationApplyResult,
  EquationPreviewResult,
  EquationUpdateResult,
  PreviewActionRequest,
  SetProtocolViewRequest,
  UpdateProtocolSymbolRequest,
} from "./protocol";

export const SHARED_EQUATION_PROTOCOL_VERSION = "visualmath.shared-equation.v1" as const;
export const SHARED_SESSION_KEY_PATTERN = /^vms1_[A-Za-z0-9_-]{43}$/;

export const isSharedSessionKey = (value: string): boolean =>
  SHARED_SESSION_KEY_PATTERN.test(value);

export type SharedSessionChangeKind =
  | "created"
  | "applied"
  | "synchronized"
  | "context-updated";

export interface SharedSessionChange {
  kind: SharedSessionChangeKind;
  sequence: number;
  documentId: string;
  actor?: { kind: "human" | "ai"; name?: string };
  event?: EquationEvent;
}

export interface SharedSessionSnapshot {
  protocolVersion: typeof SHARED_EQUATION_PROTOCOL_VERSION;
  sessionKey: string;
  sequence: number;
  primaryDocumentId: string;
  createdAt: string;
  updatedAt: string;
  document: EquationDocument;
  snapshot: Exclude<ReturnType<EquationSessionService["snapshot"]>, { status: "error" }>;
  change: SharedSessionChange;
}

export type SharedSessionErrorCode =
  | "invalid_session"
  | "stale_sequence"
  | "document_mismatch"
  | "session_not_found";

export interface SharedSessionError {
  status: "error";
  code: SharedSessionErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface SharedSessionSyncRequest {
  expectedSequence: number;
  requestId: string;
  document: EquationDocument;
  actor: { kind: "human" | "ai"; name?: string };
}

export interface SharedSessionRecord {
  schemaVersion: 1;
  sessionKey: string;
  sequence: number;
  primaryDocumentId: string;
  createdAt: string;
  updatedAt: string;
  service: EquationSessionState;
  change: SharedSessionChange;
  synchronizedRequests: string[];
}

export interface SharedEquationSessionOptions {
  now?: () => Date;
  maxSynchronizedRequests?: number;
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const sessionError = (
  code: SharedSessionErrorCode,
  message: string,
  details?: Record<string, unknown>
): SharedSessionError => ({ status: "error", code, message, details });

const documentsEqual = (left: EquationDocument | null, right: EquationDocument | null): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const newestEvent = (
  before: EquationDocument | null,
  after: EquationDocument | null
): EquationEvent | undefined => {
  if (!after || after.history.length === 0) return undefined;
  if (!before) return after.history.at(-1);
  if (after.history.length !== before.history.length + 1) return undefined;
  const event = after.history.at(-1);
  return event?.beforeRevision === before.revision ? event : undefined;
};

/** Provider-neutral authority for one browser/AI equation session. */
export class SharedEquationSession {
  private record: SharedSessionRecord;
  private service: EquationSessionService;
  private readonly now: () => Date;
  private readonly maxSynchronizedRequests: number;

  constructor(record: SharedSessionRecord, options: SharedEquationSessionOptions = {}) {
    this.record = cloneJson(record);
    this.service = new EquationSessionService({
      state: this.record.service,
      maxPreviews: 50,
      maxAppliedRequests: 50,
    });
    this.now = options.now ?? (() => new Date());
    this.maxSynchronizedRequests = options.maxSynchronizedRequests ?? 500;
  }

  static create(
    sessionKey: string,
    document: EquationDocument,
    options: SharedEquationSessionOptions = {}
  ): SharedEquationSession {
    const now = (options.now ?? (() => new Date()))().toISOString();
    const service = new EquationSessionService({ maxPreviews: 50, maxAppliedRequests: 50 });
    const normalized = service.loadDocument(document);
    return new SharedEquationSession({
      schemaVersion: 1,
      sessionKey,
      sequence: 0,
      primaryDocumentId: normalized.documentId,
      createdAt: now,
      updatedAt: now,
      service: service.exportState(),
      change: {
        kind: "created",
        sequence: 0,
        documentId: normalized.documentId,
      },
      synchronizedRequests: [],
    }, options);
  }

  exportRecord(): SharedSessionRecord {
    this.record.service = this.service.exportState();
    return cloneJson(this.record);
  }

  private primaryDocument(): EquationDocument | null {
    return this.service.getDocument(this.record.primaryDocumentId);
  }

  snapshot(): SharedSessionSnapshot | SharedSessionError {
    const document = this.primaryDocument();
    if (!document) {
      return sessionError("invalid_session", "The shared session has no primary equation document.");
    }
    const snapshot = this.service.snapshot(document.documentId);
    if ("status" in snapshot) {
      return sessionError("invalid_session", snapshot.message, { cause: snapshot.code });
    }
    return {
      protocolVersion: SHARED_EQUATION_PROTOCOL_VERSION,
      sessionKey: this.record.sessionKey,
      sequence: this.record.sequence,
      primaryDocumentId: this.record.primaryDocumentId,
      createdAt: this.record.createdAt,
      updatedAt: this.record.updatedAt,
      document: cloneJson(document),
      snapshot: cloneJson(snapshot),
      change: cloneJson(this.record.change),
    };
  }

  private persistService(): void {
    this.record.service = this.service.exportState();
  }

  private recordDocumentChange(
    before: EquationDocument | null,
    kind: Exclude<SharedSessionChangeKind, "created">,
    actor?: { kind: "human" | "ai"; name?: string },
    explicitEvent?: EquationEvent
  ): boolean {
    const after = this.primaryDocument();
    this.persistService();
    if (documentsEqual(before, after) || !after) return false;
    this.record.sequence += 1;
    this.record.updatedAt = this.now().toISOString();
    const event = explicitEvent ?? newestEvent(before, after);
    this.record.change = {
      kind: event ? "applied" : kind,
      sequence: this.record.sequence,
      documentId: after.documentId,
      actor: event?.actor ?? actor,
      event: event ? cloneJson(event) : undefined,
    };
    return true;
  }

  syncDocument(request: SharedSessionSyncRequest): SharedSessionSnapshot | SharedSessionError {
    if (this.record.synchronizedRequests.includes(request.requestId)) return this.snapshot();
    if (request.expectedSequence !== this.record.sequence) {
      return sessionError("stale_sequence", "The shared equation changed before this browser update.", {
        expectedSequence: request.expectedSequence,
        currentSequence: this.record.sequence,
      });
    }
    if (request.document.documentId !== this.record.primaryDocumentId) {
      return sessionError("document_mismatch", "This document does not belong to the shared session.", {
        expectedDocumentId: this.record.primaryDocumentId,
        receivedDocumentId: request.document.documentId,
      });
    }
    const before = this.primaryDocument();
    this.service.loadDocument(request.document);
    this.recordDocumentChange(before, "synchronized", request.actor);
    this.record.synchronizedRequests.push(request.requestId);
    if (this.record.synchronizedRequests.length > this.maxSynchronizedRequests) {
      this.record.synchronizedRequests.splice(
        0,
        this.record.synchronizedRequests.length - this.maxSynchronizedRequests
      );
    }
    this.persistService();
    return this.snapshot();
  }

  previewAction(request: PreviewActionRequest): EquationPreviewResult {
    const result = this.service.previewAction(request);
    this.persistService();
    return result;
  }

  applyPreview(request: ApplyPreviewRequest): EquationApplyResult {
    const before = this.primaryDocument();
    const result = this.service.applyPreview(request);
    if (result.status === "applied") {
      this.recordDocumentChange(before, "synchronized", request.actor, result.event);
    } else {
      this.persistService();
    }
    return result;
  }

  updateSymbol(
    request: UpdateProtocolSymbolRequest & { expectedSequence?: number }
  ): EquationUpdateResult | SharedSessionError {
    if (request.expectedSequence !== undefined && request.expectedSequence !== this.record.sequence) {
      return sessionError("stale_sequence", "The shared context changed before this symbol update.", {
        expectedSequence: request.expectedSequence,
        currentSequence: this.record.sequence,
      });
    }
    const { expectedSequence: _expectedSequence, ...protocolRequest } = request;
    const before = this.primaryDocument();
    const result = this.service.updateSymbol(protocolRequest);
    if (result.status === "updated") {
      this.recordDocumentChange(before, "context-updated", protocolRequest.actor);
    } else {
      this.persistService();
    }
    return result;
  }

  setView(
    request: SetProtocolViewRequest & { expectedSequence?: number }
  ): EquationUpdateResult | SharedSessionError {
    if (request.expectedSequence !== undefined && request.expectedSequence !== this.record.sequence) {
      return sessionError("stale_sequence", "The shared context changed before this view update.", {
        expectedSequence: request.expectedSequence,
        currentSequence: this.record.sequence,
      });
    }
    const { expectedSequence: _expectedSequence, ...protocolRequest } = request;
    const before = this.primaryDocument();
    const result = this.service.setView(protocolRequest);
    if (result.status === "updated") {
      this.recordDocumentChange(before, "context-updated");
    } else {
      this.persistService();
    }
    return result;
  }
}
