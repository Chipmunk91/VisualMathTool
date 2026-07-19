import assert from "node:assert/strict";
import { EquationSessionService } from "../src/tools/equation-builder/session";
import type {
  EquationActionDescriptor,
  EquationAppliedResult,
  EquationCreatedResult,
  EquationPreviewedResult,
  EquationServiceError,
} from "../src/tools/equation-builder/protocol";

let sequence = 0;
const service = new EquationSessionService({
  idFactory: () => `test_${++sequence}`,
  now: () => new Date("2026-01-02T03:04:05.000Z"),
});

const expectCreated = (value: ReturnType<EquationSessionService["createEquation"]>) => {
  assert.equal(value.status, "created", value.status === "error" ? value.message : undefined);
  return value as EquationCreatedResult;
};

const expectPreviewed = (value: ReturnType<EquationSessionService["previewAction"]>) => {
  assert.equal(value.status, "previewed", value.status === "error" ? value.message : undefined);
  return value as EquationPreviewedResult;
};

const expectApplied = (value: ReturnType<EquationSessionService["applyPreview"]>) => {
  assert.equal(value.status, "applied", value.status === "error" ? value.message : undefined);
  return value as EquationAppliedResult;
};

const expectError = (
  value: { status: string },
  code: EquationServiceError["code"]
) => {
  assert.equal(value.status, "error");
  assert.equal((value as EquationServiceError).code, code);
};

const actionsFor = (documentId: string): EquationActionDescriptor[] => {
  const actions = service.listActions(documentId);
  assert.ok(Array.isArray(actions));
  return actions;
};

// Arbitrary identifiers stay distinct and receive durable symbol IDs.
const calculusDocument = expectCreated(service.createEquation({
  text: "z = x*y + t",
  documentId: "calculus-document",
}));
const originalEquation = calculusDocument.document.equation;
const symbols = Object.fromEntries(
  calculusDocument.document.symbols.map((symbol) => [symbol.name, symbol.id])
);
assert.deepEqual(Object.keys(symbols).sort(), ["t", "x", "y", "z"]);
assert.equal(new Set(Object.values(symbols)).size, 4);

const calculusActions = actionsFor(calculusDocument.document.documentId);
assert.ok(calculusActions.some((action) => action.id === "calculus:differentiate"));
assert.ok(calculusActions.some((action) => action.id === "calculus:integrate"));

// A model may not let symbol position silently choose calculus semantics.
const incompleteCalculus = service.previewAction({
  documentId: calculusDocument.document.documentId,
  expectedRevision: calculusDocument.document.revision,
  actionId: "calculus:differentiate",
  arguments: {},
  actor: { kind: "ai", name: "protocol-test" },
});
expectError(incompleteCalculus, "needs_context");

const calculusPreview = expectPreviewed(service.previewAction({
  documentId: calculusDocument.document.documentId,
  expectedRevision: calculusDocument.document.revision,
  actionId: "calculus:differentiate",
  arguments: {
    mode: "partial",
    withRespectToSymbolId: symbols.x,
    roles: {
      [symbols.z]: "dependent",
      [symbols.y]: "held-constant",
      [symbols.t]: "held-constant",
    },
  },
  actor: { kind: "ai", name: "protocol-test" },
}));
assert.deepEqual(service.getDocument(calculusDocument.document.documentId)?.equation, originalEquation);
assert.notEqual(calculusPreview.beforeRevision, calculusPreview.afterRevision);
assert.equal(calculusPreview.action.revision, calculusDocument.document.revision);

const calculusApplied = expectApplied(service.applyPreview({
  documentId: calculusDocument.document.documentId,
  previewToken: calculusPreview.previewToken,
  requestId: "differentiate-1",
  actor: { kind: "ai", name: "protocol-test" },
}));
assert.equal(calculusApplied.document.history.length, 1);
assert.equal(calculusApplied.event.actor.kind, "ai");
assert.equal(calculusApplied.event.operation.ruleId, "calculus.differentiate.partial");
assert.equal(
  calculusApplied.document.symbols.find((symbol) => symbol.name === "x")?.id,
  symbols.x
);

// Symbol metadata and graph interpretation use stable IDs/candidate IDs, not side position.
const symbolUpdated = service.updateSymbol({
  documentId: calculusApplied.document.documentId,
  expectedRevision: calculusApplied.document.revision,
  symbolId: symbols.x,
  patch: { meaning: "input coordinate", unit: "m", assumptions: ["x > 0"] },
  actor: { kind: "human", name: "tester" },
});
assert.equal(symbolUpdated.status, "updated");
if (symbolUpdated.status === "updated") {
  const x = symbolUpdated.document.symbols.find((symbol) => symbol.id === symbols.x);
  assert.equal(x?.meaning, "input coordinate");
  assert.equal(x?.unit, "m");
  assert.equal(x?.assumptions[0]?.expression, "x > 0");
}

const viewDocument = expectCreated(service.createEquation({
  text: "z = x*y + t",
  documentId: "view-document",
}));
const analysis = service.analyze(viewDocument.document.documentId);
assert.ok(!("status" in analysis));
if (!("status" in analysis)) {
  const candidate = analysis.relation.viewCandidates[0];
  assert.ok(candidate);
  const selected = service.setView({
    documentId: viewDocument.document.documentId,
    expectedRevision: viewDocument.document.revision,
    candidateId: candidate.id,
  });
  assert.equal(selected.status, "updated");
}
expectError(service.setView({
  documentId: viewDocument.document.documentId,
  expectedRevision: viewDocument.document.revision,
  candidateId: "invented:view",
}), "view_not_found");

// Concrete algebra actions are discovered, previewed, and then applied exactly once.
const algebraDocument = expectCreated(service.createEquation({
  text: "3*x = y",
  documentId: "algebra-document",
}));
const divideByThree = actionsFor(algebraDocument.document.documentId)
  .find((action) => action.label === "Divide both sides by 3");
assert.ok(divideByThree, "expected the engine to advertise divide-by-3");

expectError(service.previewAction({
  documentId: algebraDocument.document.documentId,
  expectedRevision: algebraDocument.document.revision,
  actionId: "invented:action",
  arguments: {},
  actor: { kind: "ai" },
}), "action_not_found");
expectError(service.previewAction({
  documentId: algebraDocument.document.documentId,
  expectedRevision: algebraDocument.document.revision,
  actionId: divideByThree.id,
  arguments: { surprise: true },
  actor: { kind: "ai" },
}), "invalid_request");

const algebraBefore = service.getDocument(algebraDocument.document.documentId);
const algebraPreview = expectPreviewed(service.previewAction({
  documentId: algebraDocument.document.documentId,
  expectedRevision: algebraDocument.document.revision,
  actionId: divideByThree.id,
  arguments: {},
  actor: { kind: "ai", name: "protocol-test" },
}));
assert.deepEqual(service.getDocument(algebraDocument.document.documentId), algebraBefore);

const applyRequest = {
  documentId: algebraDocument.document.documentId,
  previewToken: algebraPreview.previewToken,
  requestId: "apply-1",
  actor: { kind: "human" as const, name: "tester" },
};
const algebraApplied = expectApplied(service.applyPreview(applyRequest));
assert.ok(algebraApplied.event.animation, "gesture events must preserve a movement story");
assert.deepEqual(service.applyPreview(applyRequest), algebraApplied, "request IDs must be idempotent");
expectError(service.applyPreview({ ...applyRequest, requestId: "apply-2" }), "preview_consumed");

// A preview becomes stale when another preview wins the race.
const raceDocument = expectCreated(service.createEquation({
  text: "x + 1 = y",
  documentId: "race-document",
}));
const raceAction = actionsFor(raceDocument.document.documentId)
  .find((action) => action.kind === "algebra");
assert.ok(raceAction);
const firstRacePreview = expectPreviewed(service.previewAction({
  documentId: raceDocument.document.documentId,
  expectedRevision: raceDocument.document.revision,
  actionId: raceAction.id,
  arguments: {},
  actor: { kind: "ai" },
}));
const secondRacePreview = expectPreviewed(service.previewAction({
  documentId: raceDocument.document.documentId,
  expectedRevision: raceDocument.document.revision,
  actionId: raceAction.id,
  arguments: {},
  actor: { kind: "ai" },
}));
expectApplied(service.applyPreview({
  documentId: raceDocument.document.documentId,
  previewToken: secondRacePreview.previewToken,
  requestId: "race-winner",
  actor: { kind: "ai" },
}));
expectError(service.applyPreview({
  documentId: raceDocument.document.documentId,
  previewToken: firstRacePreview.previewToken,
  requestId: "race-loser",
  actor: { kind: "ai" },
}), "stale_revision");

// Idempotency is scoped to a document, so two clients may reuse a request ID safely.
const secondAlgebraDocument = expectCreated(service.createEquation({
  text: "2*x = y",
  documentId: "second-algebra-document",
}));
const divideByTwo = actionsFor(secondAlgebraDocument.document.documentId)
  .find((action) => action.label === "Divide both sides by 2");
assert.ok(divideByTwo);
const secondAlgebraPreview = expectPreviewed(service.previewAction({
  documentId: secondAlgebraDocument.document.documentId,
  expectedRevision: secondAlgebraDocument.document.revision,
  actionId: divideByTwo.id,
  arguments: {},
  actor: { kind: "ai" },
}));
const secondAlgebraApplied = expectApplied(service.applyPreview({
  documentId: secondAlgebraDocument.document.documentId,
  previewToken: secondAlgebraPreview.previewToken,
  requestId: "apply-1",
  actor: { kind: "ai" },
}));
assert.equal(secondAlgebraApplied.document.documentId, secondAlgebraDocument.document.documentId);

console.log("equation protocol contract: ok");
