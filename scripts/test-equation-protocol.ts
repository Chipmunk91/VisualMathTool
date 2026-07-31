import assert from "node:assert/strict";
import { EquationSessionService } from "../src/tools/equation-builder/session";
import { EQUATION_PROTOCOL_VERSION } from "../src/tools/equation-builder/protocol";
import type {
  EquationActionDescriptor,
  EquationAppliedResult,
  EquationCreatedResult,
  EquationPreviewedResult,
  EquationServiceError,
  ProtocolRelationAnalysis,
} from "../src/tools/equation-builder/protocol";
import { printTreeEq } from "../src/tools/equation-builder/tree";

let sequence = 0;
const service = new EquationSessionService({
  idFactory: () => `test_${++sequence}`,
  now: () => new Date("2026-01-02T03:04:05.000Z"),
});

const expectCreated = (value: ReturnType<EquationSessionService["createEquation"]>) => {
  assert.equal(value.status, "created", value.status === "error" ? value.message : undefined);
  const created = value as EquationCreatedResult;
  assert.equal(created.protocolVersion, EQUATION_PROTOCOL_VERSION);
  return created;
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

const analysisFor = (documentId: string): ProtocolRelationAnalysis => {
  const analysis = service.analyze(documentId);
  assert.ok(!("status" in analysis));
  return analysis as ProtocolRelationAnalysis;
};

assert.equal(EQUATION_PROTOCOL_VERSION, "visualmath.equation.v2");

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

// User-authored symbol names may approach the input limit, but advertised
// mapping IDs remain bounded and can be sent back through the protocol.
const longSymbol = "verylong".repeat(60);
const longIdentifierDocument = expectCreated(service.createEquation({
  text: `f(${longSymbol}) = ${longSymbol}^2`,
  documentId: "long-identifier-document",
}));
const longIdentifierAnalysis = analysisFor(longIdentifierDocument.document.documentId);
const longIdentifierView = longIdentifierAnalysis.relation.viewCandidates.find(
  (candidate) => candidate.spec.kind === "function-1d"
);
const longIdentifierMapping = longIdentifierAnalysis.semantics[0]?.mappingCandidates.find(
  (candidate) => candidate.lens === "complex-alternative"
);
assert.ok(longIdentifierView && longIdentifierMapping);
assert.ok(longIdentifierMapping.id.length <= 500);
assert.ok(longIdentifierMapping.id.length < longSymbol.length);
assert.equal(service.setView({
  documentId: longIdentifierDocument.document.documentId,
  expectedRevision: longIdentifierDocument.document.revision,
  candidateId: longIdentifierView.id,
  mappingSignatureId: longIdentifierMapping.id,
}).status, "updated");

// Complex-realm semantics are serialized beside structural relation analysis.
const squareRootDocument = expectCreated(service.createEquation({
  text: "x = sqrt(-1)",
  documentId: "complex-square-root",
}));
const squareRootAnalysis = analysisFor(squareRootDocument.document.documentId);
assert.equal(squareRootAnalysis.semantics?.length, 1);
assert.deepEqual(
  squareRootAnalysis.semantics?.[0].inferredMemberships.map(({ symbol, space }) => ({
    symbol,
    space,
  })),
  [{ symbol: "x", space: "complex" }]
);
assert.deepEqual(
  squareRootAnalysis.semantics?.[0].expression.closedValue,
  { kind: "complex", re: 0, im: 1 }
);

const explicitComplexDocument = expectCreated(service.createEquation({
  text: "z = 3 + 4*i",
  documentId: "explicit-complex",
}));
const explicitComplexAnalysis = analysisFor(explicitComplexDocument.document.documentId);
assert.deepEqual(
  explicitComplexAnalysis.semantics?.[0].inferredMemberships.map(({ symbol, space }) => ({
    symbol,
    space,
  })),
  [{ symbol: "z", space: "complex" }]
);
assert.deepEqual(
  explicitComplexAnalysis.semantics?.[0].expression.closedValue,
  { kind: "complex", re: 3, im: 4 }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(explicitComplexAnalysis.semantics)),
  explicitComplexAnalysis.semantics,
  "protocol semantics must remain plain JSON data"
);

const squareFunctionDocument = expectCreated(service.createEquation({
  text: "f(x) = x^2",
  documentId: "square-function",
}));
const squareFunctionAnalysis = analysisFor(squareFunctionDocument.document.documentId);
const signatures = squareFunctionAnalysis.semantics?.[0].mappingCandidates ?? [];
const realSignature = signatures.find((signature) => signature.lens === "default-real");
const complexSignature = signatures.find((signature) => signature.lens === "complex-alternative");
assert.deepEqual(realSignature?.inputs, [{ symbol: "x", space: "real" }]);
assert.equal(realSignature?.output.space, "real");
assert.deepEqual(realSignature?.range, {
  status: "exact",
  set: { kind: "real", subset: "nonnegative" },
  rule: "square",
});
assert.deepEqual(complexSignature?.inputs, [{ symbol: "x", space: "complex" }]);
assert.equal(complexSignature?.output.space, "complex");
assert.deepEqual(complexSignature?.range, {
  status: "exact",
  set: { kind: "complex", subset: "all" },
  rule: "square",
});
const squareView = squareFunctionAnalysis.relation.viewCandidates.find(
  (candidate) => candidate.spec.kind === "function-1d"
);
assert.ok(squareView && complexSignature);
const selectedComplexView = service.setView({
  documentId: squareFunctionDocument.document.documentId,
  expectedRevision: squareFunctionDocument.document.revision,
  candidateId: squareView.id,
  mappingSignatureId: complexSignature.id,
  complexDisplay: "polar",
});
assert.equal(selectedComplexView.status, "updated");
if (selectedComplexView.status === "updated") {
  assert.equal(selectedComplexView.document.presentation?.mappingSignatureId, complexSignature.id);
  assert.equal(selectedComplexView.document.presentation?.complexDisplay, "polar");
}
expectError(service.setView({
  documentId: squareFunctionDocument.document.documentId,
  expectedRevision: squareFunctionDocument.document.revision,
  candidateId: squareView.id,
  mappingSignatureId: "mapping|invented",
}), "mapping_not_found");

// A selected complex mapping is operation semantics, not merely graph styling.
// The exact lens travels through action discovery, preview, and the event trace.
const cubeFunctionDocument = expectCreated(service.createEquation({
  text: "f(x) = x^3",
  documentId: "complex-cube-function",
}));
const cubeAnalysis = analysisFor(cubeFunctionDocument.document.documentId);
const cubeView = cubeAnalysis.relation.viewCandidates.find(
  (candidate) => candidate.spec.kind === "function-1d"
);
const cubeComplexMapping = cubeAnalysis.semantics[0]?.mappingCandidates.find(
  (candidate) => candidate.lens === "complex-alternative"
);
assert.ok(cubeView && cubeComplexMapping);

const realCubeRoot = actionsFor(cubeFunctionDocument.document.documentId)
  .find((action) => action.label === "Take the cube root of both sides");
assert.ok(realCubeRoot);
assert.deepEqual(realCubeRoot.operationContext, { scalarRealm: "real" });
const realCubePreview = expectPreviewed(service.previewAction({
  documentId: cubeFunctionDocument.document.documentId,
  expectedRevision: cubeFunctionDocument.document.revision,
  actionId: realCubeRoot.id,
  arguments: {},
  operationContext: realCubeRoot.operationContext,
  actor: { kind: "ai", name: "protocol-test" },
}));
assert.equal(printTreeEq(realCubePreview.after), "³√(f) = x");
assert.deepEqual(realCubePreview.warnings, []);

const cubeViewUpdate = service.setView({
  documentId: cubeFunctionDocument.document.documentId,
  expectedRevision: cubeFunctionDocument.document.revision,
  candidateId: cubeView.id,
  mappingSignatureId: cubeComplexMapping.id,
});
assert.equal(cubeViewUpdate.status, "updated");
expectError(service.applyPreview({
  documentId: cubeFunctionDocument.document.documentId,
  previewToken: realCubePreview.previewToken,
  requestId: "stale-real-lens-preview",
  actor: { kind: "ai" },
}), "needs_context");
const complexCubeRoot = actionsFor(cubeFunctionDocument.document.documentId)
  .find((action) => action.label === "Take the cube root of both sides");
assert.ok(complexCubeRoot);
assert.deepEqual(complexCubeRoot.operationContext, {
  scalarRealm: "complex",
  mappingSignatureId: cubeComplexMapping.id,
});
assert.ok(complexCubeRoot.warnings.some((warning) => warning.includes("principal root")));

expectError(service.previewAction({
  documentId: cubeFunctionDocument.document.documentId,
  expectedRevision: cubeFunctionDocument.document.revision,
  actionId: complexCubeRoot.id,
  arguments: {},
  operationContext: { scalarRealm: "real" },
  actor: { kind: "ai" },
}), "needs_context");

const complexCubePreview = expectPreviewed(service.previewAction({
  documentId: cubeFunctionDocument.document.documentId,
  expectedRevision: cubeFunctionDocument.document.revision,
  actionId: complexCubeRoot.id,
  arguments: {},
  operationContext: complexCubeRoot.operationContext,
  actor: { kind: "ai", name: "protocol-test" },
}));
assert.equal(printTreeEq(complexCubePreview.after), "³√(f) = ³√(x³)");
assert.deepEqual(complexCubePreview.operationContext, complexCubeRoot.operationContext);
assert.ok(complexCubePreview.warnings.some((warning) => warning.includes("principal root")));
const complexCubeApplied = expectApplied(service.applyPreview({
  documentId: cubeFunctionDocument.document.documentId,
  previewToken: complexCubePreview.previewToken,
  requestId: "complex-cube-apply",
  actor: { kind: "ai", name: "protocol-test" },
}));
assert.deepEqual(
  complexCubeApplied.event.operation.arguments.operationContext,
  complexCubeRoot.operationContext
);

const exponentialDocument = expectCreated(service.createEquation({
  text: "f(z) = exp(z)",
  documentId: "complex-exponential-function",
}));
const exponentialAnalysis = analysisFor(exponentialDocument.document.documentId);
const exponentialView = exponentialAnalysis.relation.viewCandidates.find(
  (candidate) => candidate.spec.kind === "function-1d"
);
const exponentialComplexMapping = exponentialAnalysis.semantics[0]?.mappingCandidates.find(
  (candidate) => candidate.lens === "complex-alternative"
);
assert.ok(exponentialView && exponentialComplexMapping);
assert.equal(service.setView({
  documentId: exponentialDocument.document.documentId,
  expectedRevision: exponentialDocument.document.revision,
  candidateId: exponentialView.id,
  mappingSignatureId: exponentialComplexMapping.id,
}).status, "updated");
const complexLn = actionsFor(exponentialDocument.document.documentId)
  .find((action) => action.label === "Take ln of both sides");
assert.ok(complexLn);
assert.deepEqual(complexLn.operationContext, {
  scalarRealm: "complex",
  mappingSignatureId: exponentialComplexMapping.id,
});
assert.ok(complexLn.warnings.some((warning) => warning.includes("principal branch")));
assert.ok(!complexLn.warnings.some((warning) => warning.includes("> 0")));
const complexLnPreview = expectPreviewed(service.previewAction({
  documentId: exponentialDocument.document.documentId,
  expectedRevision: exponentialDocument.document.revision,
  actionId: complexLn.id,
  arguments: {},
  operationContext: complexLn.operationContext,
  actor: { kind: "ai", name: "protocol-test" },
}));
assert.equal(printTreeEq(complexLnPreview.after), "ln(f) = ln(e^z)");
assert.ok(complexLnPreview.warnings.some((warning) => warning.includes("principal branch")));

const blockedComplexCalculus = service.previewAction({
  documentId: exponentialDocument.document.documentId,
  expectedRevision: exponentialDocument.document.revision,
  actionId: "calculus:differentiate",
  arguments: {},
  operationContext: complexLn.operationContext,
  actor: { kind: "ai" },
});
expectError(blockedComplexCalculus, "needs_context");
if (blockedComplexCalculus.status === "error") {
  assert.match(blockedComplexCalculus.message, /holomorphic|Wirtinger/);
}

const constantFunctionDocument = expectCreated(service.createEquation({
  text: "f(x) = 3",
  documentId: "constant-function",
}));
assert.deepEqual(
  constantFunctionDocument.document.symbols.map(({ name, dependsOn, parameter }) => ({
    name,
    dependsOn,
    parameter,
  })),
  [
    { name: "f", dependsOn: ["x"], parameter: undefined },
    { name: "x", dependsOn: undefined, parameter: true },
  ]
);
const constantFunctionAnalysis = analysisFor(constantFunctionDocument.document.documentId);
assert.deepEqual(constantFunctionAnalysis.relation.symbols, ["f", "x"]);
assert.deepEqual(constantFunctionAnalysis.relation.isolations[0]?.inputs, ["x"]);
assert.deepEqual(
  constantFunctionAnalysis.symbols.map(({ name, dependsOn }) => ({ name, dependsOn })),
  [
    { name: "f", dependsOn: ["x"] },
    { name: "x", dependsOn: undefined },
  ]
);
const constantSignatures = constantFunctionAnalysis.semantics[0].mappingCandidates;
assert.deepEqual(
  constantSignatures.map(({ lens, inputs, output, range }) => ({
    lens,
    inputs,
    outputSpace: output.space,
    rangeStatus: range.status,
    rangeKind: range.set.kind,
  })),
  [
    {
      lens: "default-real",
      inputs: [{ symbol: "x", space: "real" }],
      outputSpace: "real",
      rangeStatus: "exact",
      rangeKind: "singleton",
    },
    {
      lens: "complex-alternative",
      inputs: [{ symbol: "x", space: "complex" }],
      outputSpace: "real",
      rangeStatus: "exact",
      rangeKind: "singleton",
    },
  ]
);
const constantFunctionView = constantFunctionAnalysis.relation.viewCandidates.find(
  (candidate) => candidate.spec.kind === "function-1d"
);
assert.ok(constantFunctionView);
assert.equal(service.setView({
  documentId: constantFunctionDocument.document.documentId,
  expectedRevision: constantFunctionDocument.document.revision,
  candidateId: constantFunctionView.id,
}).status, "updated");

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

// Assumptions are part of preview semantics even though editing the symbol
// book does not alter the equation revision.
const assumptionDocument = expectCreated(service.createEquation({
  text: "x/x + 1 = y",
  documentId: "assumption-preview-document",
}));
const assumptionX = assumptionDocument.document.symbols.find(
  (symbol) => symbol.name === "x"
);
assert.ok(assumptionX);
const assumptionAdded = service.updateSymbol({
  documentId: assumptionDocument.document.documentId,
  expectedRevision: assumptionDocument.document.revision,
  symbolId: assumptionX.id,
  patch: { assumptions: ["x ≠ 0"] },
  actor: { kind: "human" },
});
assert.equal(assumptionAdded.status, "updated");
const moveOne = actionsFor(assumptionDocument.document.documentId).find(
  (action) => action.label === "Move 1 to the right"
);
assert.ok(moveOne);
const assumptionPreview = expectPreviewed(service.previewAction({
  documentId: assumptionDocument.document.documentId,
  expectedRevision: assumptionDocument.document.revision,
  actionId: moveOne.id,
  arguments: {},
  actor: { kind: "ai" },
}));
assert.equal(printTreeEq(assumptionPreview.after), "1 = y − 1");
const assumptionRemoved = service.updateSymbol({
  documentId: assumptionDocument.document.documentId,
  expectedRevision: assumptionDocument.document.revision,
  symbolId: assumptionX.id,
  patch: { assumptions: [] },
  actor: { kind: "human" },
});
assert.equal(assumptionRemoved.status, "updated");
expectError(service.applyPreview({
  documentId: assumptionDocument.document.documentId,
  previewToken: assumptionPreview.previewToken,
  requestId: "stale-assumption-preview",
  actor: { kind: "ai" },
}), "needs_context");

const assumptionRestored = service.updateSymbol({
  documentId: assumptionDocument.document.documentId,
  expectedRevision: assumptionDocument.document.revision,
  symbolId: assumptionX.id,
  patch: { assumptions: ["x ≠ 0"] },
  actor: { kind: "human" },
});
assert.equal(assumptionRestored.status, "updated");
const freshMoveOne = actionsFor(assumptionDocument.document.documentId).find(
  (action) => action.label === "Move 1 to the right"
);
assert.ok(freshMoveOne);
const freshAssumptionPreview = expectPreviewed(service.previewAction({
  documentId: assumptionDocument.document.documentId,
  expectedRevision: assumptionDocument.document.revision,
  actionId: freshMoveOne.id,
  arguments: {},
  actor: { kind: "ai" },
}));
const assumptionApplied = expectApplied(service.applyPreview({
  documentId: assumptionDocument.document.documentId,
  previewToken: freshAssumptionPreview.previewToken,
  requestId: "apply-with-standing-assumption",
  actor: { kind: "ai" },
}));
assert.deepEqual(
  assumptionApplied.event.assumptionsUsed?.map(({ expression, source }) => ({
    expression,
    source,
  })),
  [{ expression: "x ≠ 0", source: "human" }]
);
assert.ok(
  !assumptionApplied.document.symbols.some((symbol) => symbol.name === "x"),
  "x should leave the symbol book after the simplification"
);
assert.deepEqual(
  assumptionApplied.document.assumptions.map(({ expression, source }) => ({
    expression,
    source,
  })),
  [{ expression: "x ≠ 0", source: "human" }]
);

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
