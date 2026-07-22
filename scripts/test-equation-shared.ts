import assert from "node:assert/strict";
import { makeEquationDocument, predicateFromText } from "../src/tools/equation-builder/document";
import { parseEquation } from "../src/tools/equation-builder/parser";
import {
  SharedEquationSession,
  type SharedSessionSnapshot,
} from "../src/tools/equation-builder/shared-session";

const sessionKey = `vms1_${"a".repeat(43)}`;
const parsed = parseEquation("3*x = y");
assert.ok(parsed.ok);
const document = makeEquationDocument(parsed.tree, { documentId: "shared-contract" });
const x = document.symbols.find((symbol) => symbol.name === "x");
assert.ok(x);
x.assumptions = [predicateFromText("x > 0", "human")];

const expectSnapshot = (
  value: ReturnType<SharedEquationSession["snapshot"]>
): SharedSessionSnapshot => {
  assert.ok(!("status" in value), "expected a shared-session snapshot");
  return value as SharedSessionSnapshot;
};

const authority = SharedEquationSession.create(sessionKey, document, {
  now: () => new Date("2026-07-22T00:00:00.000Z"),
});
const initial = expectSnapshot(authority.snapshot());
assert.equal(initial.sequence, 0);
assert.equal(initial.document.symbols.find((symbol) => symbol.name === "x")?.assumptions[0]?.expression, "x > 0");
const divide = initial.snapshot.actions.find((action) => action.label === "Divide both sides by 3");
assert.ok(divide);

const preview = authority.previewAction({
  documentId: initial.primaryDocumentId,
  expectedRevision: initial.document.revision,
  actionId: divide.id,
  arguments: {},
  actor: { kind: "ai", name: "shared-contract" },
});
assert.equal(preview.status, "previewed");
assert.equal(expectSnapshot(authority.snapshot()).sequence, 0, "preview must not mutate collaboration state");
if (preview.status !== "previewed") throw new Error("preview failed");

// Preview tokens and receipts survive process eviction.
const restored = new SharedEquationSession(authority.exportRecord(), {
  now: () => new Date("2026-07-22T00:01:00.000Z"),
});
const applied = restored.applyPreview({
  documentId: initial.primaryDocumentId,
  previewToken: preview.previewToken,
  requestId: "shared-apply-1",
  actor: { kind: "ai", name: "shared-contract" },
});
assert.equal(applied.status, "applied");
if (applied.status !== "applied") throw new Error("apply failed");
assert.ok(applied.event.animation, "the live browser must receive the semantic movement story");
const afterApply = expectSnapshot(restored.snapshot());
assert.equal(afterApply.sequence, 1);
assert.equal(afterApply.change.kind, "applied");
assert.equal(afterApply.change.event?.id, applied.event.id);
assert.equal(afterApply.document.symbols.find((symbol) => symbol.name === "x")?.assumptions[0]?.expression, "x > 0");

const repeated = restored.applyPreview({
  documentId: initial.primaryDocumentId,
  previewToken: preview.previewToken,
  requestId: "shared-apply-1",
  actor: { kind: "ai", name: "shared-contract" },
});
assert.deepEqual(repeated, applied);
assert.equal(expectSnapshot(restored.snapshot()).sequence, 1, "idempotent retry must not rebroadcast");

// Metadata changes use the collaboration sequence even when the math revision is unchanged.
const beforeMetadataRevision = afterApply.document.revision;
const symbolUpdate = restored.updateSymbol({
  expectedSequence: 1,
  documentId: afterApply.primaryDocumentId,
  expectedRevision: beforeMetadataRevision,
  symbolId: afterApply.document.symbols.find((symbol) => symbol.name === "x")!.id,
  patch: { meaning: "positive input" },
  actor: { kind: "ai", name: "shared-contract" },
});
assert.equal(symbolUpdate.status, "updated");
const afterMetadata = expectSnapshot(restored.snapshot());
assert.equal(afterMetadata.sequence, 2);
assert.equal(afterMetadata.document.revision, beforeMetadataRevision);
assert.equal(afterMetadata.change.kind, "context-updated");
const staleMetadata = restored.updateSymbol({
  expectedSequence: 1,
  documentId: afterMetadata.primaryDocumentId,
  expectedRevision: afterMetadata.document.revision,
  symbolId: afterMetadata.document.symbols.find((symbol) => symbol.name === "x")!.id,
  patch: { unit: "m" },
  actor: { kind: "ai", name: "shared-contract" },
});
assert.equal(staleMetadata.status, "error");
if (staleMetadata.status === "error") assert.equal(staleMetadata.code, "stale_sequence");

const browserDocument = {
  ...afterMetadata.document,
  presentation: { ...afterMetadata.document.presentation, probeValue: 4 },
};
const synchronized = restored.syncDocument({
  expectedSequence: 2,
  requestId: "browser-sync-1",
  document: browserDocument,
  actor: { kind: "human" },
});
assert.ok(!("status" in synchronized));
assert.equal((synchronized as SharedSessionSnapshot).sequence, 3);
assert.equal((synchronized as SharedSessionSnapshot).document.presentation?.probeValue, 4);
assert.deepEqual(restored.syncDocument({
  expectedSequence: 2,
  requestId: "browser-sync-1",
  document: browserDocument,
  actor: { kind: "human" },
}), synchronized, "browser retries must be idempotent");

const stale = restored.syncDocument({
  expectedSequence: 2,
  requestId: "browser-sync-stale",
  document: browserDocument,
  actor: { kind: "human" },
});
assert.ok("status" in stale);
if ("status" in stale) assert.equal(stale.code, "stale_sequence");

console.log("shared equation session contract: ok");
