import assert from "node:assert/strict";
import {
  analyzeExpressionSemantics,
  analyzeIsolationSemantics,
  mappingSignatureCandidates,
  type MappingSignatureCandidate,
} from "../src/tools/equation-builder/semantics";
import {
  analyzeRelation,
  type ExplicitIsolation,
} from "../src/tools/equation-builder/relation";
import { parseEquation } from "../src/tools/equation-builder/parser";
import {
  freshNodeId,
  tadd,
  tc,
  tfn,
  tmul,
  tpow,
  tv,
  type TNode,
} from "../src/tools/equation-builder/tree";

let passed = 0;
const check = (name: string, assertion: () => void) => {
  assertion();
  passed++;
  console.log(`PASS ${name}`);
};

// These helpers intentionally construct the forward-compatible vocabulary
// directly. They keep this contract runnable both before and after the parser
// learns `i`, `abs`, and the other complex functions.
const named = (name: "pi" | "i"): TNode => ({
  id: freshNodeId(),
  kind: "named",
  name,
} as TNode);

const call = (fn: string, arg: TNode): TNode => ({
  id: freshNodeId(),
  kind: "fn",
  fn,
  arg,
} as TNode);

const isolation = (
  output: string,
  expression: TNode,
  inputs: string[]
): ExplicitIsolation => ({
  output,
  expression,
  inputs,
  sourceSide: "left",
});

const candidate = (
  candidates: MappingSignatureCandidate[],
  lens: MappingSignatureCandidate["lens"]
): MappingSignatureCandidate => {
  const found = candidates.find((item) => item.lens === lens);
  assert.ok(found, `missing ${lens} candidate`);
  return found;
};

console.log("== expression realm inference ==");

check("a bare symbol remains unknown regardless of its spelling", () => {
  assert.equal(analyzeExpressionSemantics(tv("x")).valueSpace, "unknown");
  assert.equal(analyzeExpressionSemantics(tv("z")).valueSpace, "unknown");
});

check("real constants stay real and i forces the complex realm", () => {
  assert.equal(analyzeExpressionSemantics(tc(3)).valueSpace, "real");
  assert.equal(analyzeExpressionSemantics(named("pi")).valueSpace, "real");
  const imaginary = analyzeExpressionSemantics(named("i"));
  assert.equal(imaginary.valueSpace, "complex");
  assert.equal(imaginary.evidence.some((item) => item.kind === "imaginary-unit"), true);
});

check("complex syntax promotes a compound constant", () => {
  const value = tadd(tc(3), tmul(tc(4), named("i")));
  assert.equal(analyzeExpressionSemantics(value).valueSpace, "complex");
});

check("sqrt(-1) is a complex-only closed expression with a principal branch", () => {
  const squareRoot = tfn("sqrt", tc(-1));
  const result = analyzeExpressionSemantics(squareRoot);
  assert.equal(result.valueSpace, "complex");
  assert.deepEqual(result.closedValue, { kind: "complex", re: 0, im: 1 });
  assert.deepEqual(
    result.principalBranches.map((branch) => ({
      operation: branch.operation,
      convention: branch.convention,
      active: branch.active,
    })),
    [{ operation: "sqrt", convention: "principal", active: true }]
  );
});

check("the familiar real odd root does not get needlessly promoted", () => {
  const cubeRoot = tpow(tc(-8), tc(1, 3));
  const result = analyzeExpressionSemantics(cubeRoot);
  assert.equal(result.valueSpace, "real");
  assert.deepEqual(result.closedValue, { kind: "real", value: -2 });
  assert.equal(result.requirements.some((item) => item.kind === "nonnegative"), false);
});

check("an unresolved sqrt is lazy until a mapping lens supplies the realm", () => {
  const x = tv("x");
  const squareRoot = tfn("sqrt", x);
  assert.equal(analyzeExpressionSemantics(squareRoot).valueSpace, "unknown");

  const real = analyzeExpressionSemantics(squareRoot, { symbolSpaces: { x: "real" } });
  assert.equal(real.valueSpace, "real");
  assert.equal(real.requirements.some((item) => item.kind === "nonnegative"), true);
  assert.equal(real.principalBranches.at(-1)?.active, false);

  const complex = analyzeExpressionSemantics(squareRoot, { symbolSpaces: { x: "complex" } });
  assert.equal(complex.valueSpace, "complex");
  assert.equal(complex.principalBranches.at(-1)?.active, true);
});

check("principal argument is real-valued but its branch is active for complex input", () => {
  const result = analyzeExpressionSemantics(call("arg", tv("z")), {
    symbolSpaces: { z: "complex" },
  });
  assert.equal(result.valueSpace, "real");
  assert.equal(result.principalBranches.at(-1)?.active, true);
});

check("principal complex atan excludes its two finite singularities", () => {
  const result = analyzeExpressionSemantics(tfn("atan", tv("z")), {
    symbolSpaces: { z: "complex" },
  });
  const exclusion = result.requirements.find(
    (requirement) => requirement.kind === "excluded-values"
  );
  assert.deepEqual(exclusion, {
    kind: "excluded-values",
    nodeId: exclusion?.nodeId,
    expressionKey: '{"kind":"var","name":"z"}',
    values: [
      { kind: "complex", re: 0, im: 1 },
      { kind: "complex", re: 0, im: -1 },
    ],
    appliesTo: "complex",
  });
});

console.log("\n== isolation membership ==");

check("x = sqrt(-1) infers x in the complex realm", () => {
  const result = analyzeIsolationSemantics(isolation("x", tfn("sqrt", tc(-1)), []));
  assert.deepEqual(
    result.inferredMemberships.map(({ symbol, space, status }) => ({ symbol, space, status })),
    [{ symbol: "x", space: "complex", status: "inferred" }]
  );
});

check("z = 3 + 4i infers z in the complex realm", () => {
  const result = analyzeIsolationSemantics(
    isolation("z", tadd(tc(3), tmul(tc(4), named("i"))), [])
  );
  assert.equal(result.inferredMemberships[0]?.space, "complex");
  assert.equal(result.mappingCandidates.length, 1);
  assert.equal(result.mappingCandidates[0].range.status, "exact");
  assert.equal(result.mappingCandidates[0].range.set.kind, "singleton");
});

check("real-valued complex operations infer a real output", () => {
  const result = analyzeIsolationSemantics(isolation("r", call("abs", tv("z")), ["z"]));
  assert.equal(result.expression.valueSpace, "real");
  assert.equal(result.inferredMemberships[0]?.space, "real");
});

console.log("\n== mapping signatures and exact ranges ==");

check("square gets a default real lens and a complex alternative", () => {
  const candidates = mappingSignatureCandidates(isolation("y", tpow(tv("x"), 2), ["x"]));
  assert.equal(candidates.length, 2);

  const real = candidate(candidates, "default-real");
  assert.deepEqual(real.inputs, [{ symbol: "x", space: "real" }]);
  assert.equal(real.output.space, "real");
  assert.deepEqual(real.range, {
    status: "exact",
    set: { kind: "real", subset: "nonnegative" },
    rule: "square",
  });

  const complex = candidate(candidates, "complex-alternative");
  assert.deepEqual(complex.inputs, [{ symbol: "x", space: "complex" }]);
  assert.equal(complex.output.space, "complex");
  assert.deepEqual(complex.range, {
    status: "exact",
    set: { kind: "complex", subset: "all" },
    rule: "square",
  });
});

check("exp knows its exact real and complex ranges", () => {
  const candidates = mappingSignatureCandidates(isolation("y", tfn("exp", tv("x")), ["x"]));
  assert.deepEqual(candidate(candidates, "default-real").range, {
    status: "exact",
    set: { kind: "real", subset: "positive" },
    rule: "exponential",
  });
  assert.deepEqual(candidate(candidates, "complex-alternative").range, {
    status: "exact",
    set: { kind: "complex", subset: "nonzero" },
    rule: "exponential",
  });
});

check("absolute value over C has nonnegative-real output and range", () => {
  const candidates = mappingSignatureCandidates(isolation("r", call("abs", tv("z")), ["z"]));
  const complex = candidate(candidates, "complex-alternative");
  assert.equal(complex.output.space, "real");
  assert.deepEqual(complex.range, {
    status: "exact",
    set: { kind: "real", subset: "nonnegative" },
    rule: "absolute-value",
  });
});

check("an explicit i can produce R to C without making the input complex", () => {
  const expression = tfn("exp", tmul(named("i"), tv("t")));
  const candidates = mappingSignatureCandidates(isolation("z", expression, ["t"]));
  const real = candidate(candidates, "default-real");
  assert.deepEqual(real.inputs, [{ symbol: "t", space: "real" }]);
  assert.equal(real.output.space, "complex");
});

check("general principal complex powers exclude a zero base", () => {
  const expression = tpow(tv("z"), named("i"));
  const complex = candidate(
    mappingSignatureCandidates(isolation("f", expression, ["z"])),
    "complex-alternative"
  );
  assert.deepEqual(
    complex.effectiveDomainRequirements.map(({ kind, appliesTo, expressionKey }) => ({
      kind,
      appliesTo,
      expressionKey,
    })),
    [{
      kind: "nonzero",
      appliesTo: "complex",
      expressionKey: '{"kind":"var","name":"z"}',
    }]
  );
});

check("a positive real root remains defined at zero under the complex lens", () => {
  const expression = tpow(tv("z"), tc(1, 2));
  const complex = candidate(
    mappingSignatureCandidates(isolation("f", expression, ["z"])),
    "complex-alternative"
  );
  assert.equal(
    complex.effectiveDomainRequirements.some(
      (requirement) =>
        requirement.kind === "nonzero" &&
        requirement.expressionKey === '{"kind":"var","name":"z"}'
    ),
    false
  );
});

check("a proven nonzero constant power base adds no redundant domain receipt", () => {
  for (const expression of [
    tpow(named("i"), tv("z")),
    tpow(tc(2), tv("z")),
  ]) {
    const complex = candidate(
      mappingSignatureCandidates(isolation("f", expression, ["z"])),
      "complex-alternative"
    );
    assert.equal(complex.effectiveDomainRequirements.length, 0);
  }
});

check("a declared constant function retains its input and both mapping lenses", () => {
  const parsed = parseEquation("f(x) = 3");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error(parsed.message);
  const relation = analyzeRelation(parsed.tree, parsed.dependencies);
  assert.deepEqual(relation.symbols, ["f", "x"]);
  assert.deepEqual(relation.isolations[0]?.inputs, ["x"]);

  const semantic = analyzeIsolationSemantics(relation.isolations[0]);
  const real = candidate(semantic.mappingCandidates, "default-real");
  const complex = candidate(semantic.mappingCandidates, "complex-alternative");
  assert.deepEqual(real.inputs, [{ symbol: "x", space: "real" }]);
  assert.deepEqual(complex.inputs, [{ symbol: "x", space: "complex" }]);
  assert.equal(real.output.space, "real");
  assert.equal(complex.output.space, "real");
  assert.equal(real.range.status, "exact");
  assert.equal(complex.range.status, "exact");
  assert.deepEqual(
    real.range.status === "exact" && real.range.set.kind === "singleton"
      ? real.range.set.value
      : null,
    { kind: "real", value: 3 }
  );
});

check("unknown exact ranges stay explicitly unknown", () => {
  const candidates = mappingSignatureCandidates(
    isolation("y", tadd(tfn("sin", tv("x")), tv("x")), ["x"])
  );
  assert.deepEqual(candidate(candidates, "default-real").range, {
    status: "unknown",
    set: { kind: "unknown" },
    reason: "no-known-exact-rule",
  });
});

check("an undefined closed expression is not reported as a singleton range", () => {
  const item = isolation("y", tpow(tc(0), -1), []);
  const candidates = mappingSignatureCandidates(item);
  assert.equal(candidates[0].range.status, "unknown");
  assert.deepEqual(analyzeIsolationSemantics(item).inferredMemberships, []);
});

check("analysis is deterministic and JSON serializable", () => {
  const item = isolation("y", tpow(tv("x"), 2), ["x"]);
  const first = analyzeIsolationSemantics(item);
  const second = analyzeIsolationSemantics(item);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
});

console.log(`\n${passed} complex semantic assertions passed`);
