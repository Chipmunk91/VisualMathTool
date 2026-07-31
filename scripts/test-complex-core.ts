/**
 * Focused contract for the complex scalar vertical slice.
 *
 * Run: npm run test:complex
 */
import { parseEquation } from "../src/tools/equation-builder/parser";
import {
  ensureTreeIds,
  displayedProductUnits,
  evalClosedNode,
  evalNode,
  evalScalarNode,
  printNode,
  printTreeEq,
  simplify,
  tc,
  tfn,
  tmul,
  tpow,
  tv,
  type TNode,
  type TreeEq,
} from "../src/tools/equation-builder/tree";
import type { EvalResult, ScalarValue } from "../src/tools/equation-builder/scalar";
import {
  applyEquationCommand,
  executeEquationCommand,
  listApplicableEquationOperations,
} from "../src/tools/equation-builder/engine";
import { equationRevision } from "../src/tools/equation-builder/document";
import {
  applyToolT,
  normalizeOnLoad,
  raiseBothT,
  rootBothT,
} from "../src/tools/equation-builder/treemoves";
import { applySpecialActionT } from "../src/tools/equation-builder/specialactions";
import { treeFactorLayout } from "../src/tools/equation-builder/treeunits";

let passed = 0;
let failed = 0;

const check = (name: string, condition: boolean, detail = "") => {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? `  [${detail}]` : ""}`);
  }
};

const parsed = (text: string): TreeEq => {
  const result = parseEquation(text);
  if (!result.ok) throw new Error(`${text}: ${result.message}`);
  return result.tree;
};

const valueOf = (text: string): EvalResult => evalClosedNode(parsed(`answer = ${text}`).right);

const close = (actual: number, expected: number, epsilon = 1e-10): boolean =>
  Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected));

const isReal = (result: EvalResult, expected: number): boolean =>
  result.ok &&
  result.value.kind === "real" &&
  close(result.value.value, expected);

const isComplex = (result: EvalResult, re: number, im: number): boolean =>
  result.ok &&
  result.value.kind === "complex" &&
  close(result.value.re, re) &&
  close(result.value.im, im);

console.log("\n== parser and compatibility ==");
{
  const modern = parsed("x = i");
  check(
    "C1 newly parsed i is the named imaginary constant",
    modern.right.kind === "named" && modern.right.name === "i"
  );

  const oldVariable = ensureTreeIds({
    kind: "var",
    name: "i",
    symbolId: "legacy_i",
  } as TNode);
  check(
    "C2 a serialized legacy variable named i remains a variable",
    oldVariable.kind === "var" &&
      oldVariable.name === "i" &&
      oldVariable.symbolId === "legacy_i"
  );

  check(
    "C3 pencil-style 3+4i parses without an explicit multiplication sign",
    isComplex(valueOf("3 + 4i"), 3, 4)
  );

  check(
    "C4 real/imag aliases canonicalize to re/im",
    printTreeEq(parsed("x = real(z)")) === "x = re(z)" &&
      printTreeEq(parsed("x = imag(z)")) === "x = im(z)"
  );

  check(
    "C5 textbook Re/Im capitalization canonicalizes to re/im",
    printTreeEq(parsed("x = Re(z)")) === "x = re(z)" &&
      printTreeEq(parsed("x = Im(z)")) === "x = im(z)"
  );
}

console.log("\n== real-first principal-complex evaluation ==");
{
  const negativeSquareRoot = valueOf("sqrt(-1)");
  check(
    "E1 sqrt(-1) continues to the principal complex value i",
    isComplex(negativeSquareRoot, 0, 1) &&
      negativeSquareRoot.ok &&
      negativeSquareRoot.realm === "complex" &&
      negativeSquareRoot.usedComplexFallback
  );

  const oddRoot = valueOf("(-8)^(1/3)");
  check(
    "E2 a real odd root stays on the real interpretation",
    isReal(oddRoot, -2) &&
      oddRoot.ok &&
      oddRoot.realm === "real" &&
      !oddRoot.usedComplexFallback
  );

  check("E3 principal ln(-1) is i*pi", isComplex(valueOf("ln(-1)"), 0, Math.PI));
  check("E4 re(3+4i) returns a real 3", isReal(valueOf("re(3+4i)"), 3));
  check("E5 im(3+4i) returns a real 4", isReal(valueOf("im(3+4i)"), 4));
  check("E6 abs(3+4i) returns a real 5", isReal(valueOf("abs(3+4i)"), 5));
  check("E7 arg(i) returns pi/2", isReal(valueOf("arg(i)"), Math.PI / 2));
  check("E8 conj(3+4i) returns 3-4i", isComplex(valueOf("conj(3+4i)"), 3, -4));

  const withComplexEnvironment = evalScalarNode(
    parsed("answer = z^2").right,
    { z: { kind: "complex", re: 0, im: 2 } }
  );
  check("E9 environments accept serializable complex values", isReal(withComplexEnvironment, -4));

  const declaredButUnusedComplexInput = evalScalarNode(
    parsed("answer = (-2)^(1/3)").right,
    { z: { kind: "complex", re: 2, im: 1 } }
  );
  check(
    "E10 an unused complex input does not change a closed real-first value",
    isReal(declaredButUnusedComplexInput, -(2 ** (1 / 3))) &&
      declaredButUnusedComplexInput.ok &&
      declaredButUnusedComplexInput.realm === "real"
  );

  check(
    "E11 the legacy evaluator remains deliberately real-only",
    Number.isNaN(evalNode(parsed("x = i").right, {})) &&
      evalNode(parsed("x = sqrt(4)").right, {}) === 2
  );
  check("E12 Euler's identity evaluates on the principal complex continuation", isReal(valueOf("e^(i*pi)+1"), 0));
  const divideByZero = valueOf("1/0");
  check("E13 undefined values do not become complex infinities", !divideByZero.ok && divideByZero.code === "undefined");
}

console.log("\n== exact simplification and branch safety ==");
{
  check("S1 i^2 = -1", printTreeEq(parsed("x = i^2")) === "x = −1");
  check("S2 i^3 = -i", printTreeEq(parsed("x = i^3")) === "x = −i");
  check("S3 i^4 = 1", printTreeEq(parsed("x = i^4")) === "x = 1");
  check("S4 sqrt(-1) simplifies exactly to i", printTreeEq(parsed("x = sqrt(-1)")) === "x = i");
  check(
    "S5 a non-square negative rational keeps an exact i*sqrt(q) form",
    printTreeEq(parsed("x = sqrt(-2)")) === "x = i·√(2)"
  );

  const logExpUnknown = simplify(tfn("ln", tfn("exp", tv("z"))));
  check(
    "S6 principal Log(exp(z)) does not silently collapse for unknown z",
    printNode(logExpUnknown) === "ln(e^z)"
  );
  check(
    "S7 Log(exp(2)) still folds when the exponent is proven real",
    printNode(simplify(tfn("ln", tfn("exp", tc(2))))) === "2"
  );

  const poweredExp = simplify(tpow(tfn("exp", tv("z")), tv("w")));
  check(
    "S8 a symbolic power of exp(z) keeps its principal-branch structure",
    poweredExp.kind === "pow" && poweredExp.base.kind === "fn" && poweredExp.base.fn === "exp"
  );

  const symbolicProductRoot = simplify(tpow(tmul(tv("z"), tv("w")), tc(1, 3)));
  check(
    "S9 a symbolic product root is not distributed across complex factors",
    symbolicProductRoot.kind === "pow" && symbolicProductRoot.base.kind === "mul"
  );

  const complexEquation = parsed("i*x = 1");
  const divideByI = listApplicableEquationOperations(complexEquation).find(
    (operation) => operation.label === "Divide both sides by i"
  );
  const divided = divideByI
    ? applyEquationCommand(complexEquation, {
        requestId: "complex-divide-i",
        expectedRevision: equationRevision(complexEquation),
        actor: { kind: "human" },
        command: divideByI.command,
        standingAssumptions: [],
      })
    : null;
  check(
    "S10 named complex constants participate in ordinary factor operations",
    divided?.status === "applied" && printTreeEq(divided.outcome.treeNext) === "x = −i"
  );

  const closedLog = normalizeOnLoad(parsed("x = exp(ln(i))"));
  check(
    "S11 exp(Log i) thaws without inventing a real positivity assumption",
    printTreeEq(closedLog.te) === "x = i" && closedLog.pill === undefined
  );
  const undefinedLog = normalizeOnLoad(parsed("x = exp(ln(0))"));
  check(
    "S12 exp(Log 0) remains visibly undefined instead of collapsing to zero",
    printTreeEq(undefinedLog.te) === "x = e^(ln(0))" && !undefinedLog.changed
  );
  const symbolicComplexLog = normalizeOnLoad(parsed("x = exp(ln(i*y))"));
  check(
    "S13 a symbolic Log waits for the selected mapping lens at load",
    printTreeEq(symbolicComplexLog.te) === "x = e^(ln(i·y))" &&
      symbolicComplexLog.pill === undefined &&
      !symbolicComplexLog.changed
  );
  const explicitComplexExp = applyToolT(
    "exp",
    parsed("ln(z) = 4*i"),
    { scalarRealm: "complex", mappingSignatureId: "mapping_test_complex" }
  );
  check(
    "S13b explicit complex exp(Log z) records both nonzero domain and periodicity",
    explicitComplexExp !== null &&
      typeof explicitComplexExp !== "string" &&
      printTreeEq(explicitComplexExp.treeNext) === "z = e^(4i)" &&
      explicitComplexExp.pill?.includes("z ≠ 0") &&
      explicitComplexExp.pill?.includes("check periods") &&
      explicitComplexExp.note?.includes("2πi")
  );
  const complexExponential = parsed("e^(4*i) = y");
  const principalLog = applyToolT("ln", complexExponential);
  check(
    "S14 ln does not claim principal Log(exp z) equals z outside the real lens",
    principalLog !== null &&
      typeof principalLog !== "string" &&
      printTreeEq(principalLog.treeNext) === "ln(e^(4i)) = ln(y)" &&
      principalLog.pill === "sides ≠ 0 · principal branch"
  );
  const complexCube = parsed("(i*x)^3 = y");
  const principalCubeRoot = rootBothT(complexCube, 3);
  check(
    "S15 an odd complex root keeps its principal-branch structure",
    principalCubeRoot !== null &&
      typeof principalCubeRoot !== "string" &&
      printTreeEq(principalCubeRoot.treeNext) === "³√(−i·x³) = ³√(y)" &&
      principalCubeRoot.pill === "principal root"
  );
  const complexRootEquation = parsed("(i*x)^(1/3) = y");
  const raisedComplexRoot = raiseBothT(complexRootEquation, 3);
  check(
    "S16 raising a complex odd root records possible extra roots",
    raisedComplexRoot !== null &&
      typeof raisedComplexRoot !== "string" &&
      printTreeEq(raisedComplexRoot.treeNext) === "i·x = y³" &&
      raisedComplexRoot.pill === "check roots"
  );
  const complexSine = parsed("sin(i*x) = 2");
  const inverseComplexSine = applySpecialActionT(complexSine, {
    kind: "asin",
    nodeId: complexSine.left.id,
    side: "left",
  });
  check(
    "S17 inverse trig keeps its complex continuation instead of applying a real-only range rejection",
    inverseComplexSine !== null &&
      typeof inverseComplexSine !== "string" &&
      printTreeEq(inverseComplexSine.treeNext) === "i·x = arcsin(2)" &&
      inverseComplexSine.pill === "check branches"
  );
  const complexCoefficientEquation = parsed("(3 + 4*i)*x = y");
  const divideComplexCoefficient = listApplicableEquationOperations(complexCoefficientEquation).find(
    (operation) => operation.label === "Divide both sides by 4i + 3"
  );
  const dividedComplexCoefficient = divideComplexCoefficient
    ? applyEquationCommand(complexCoefficientEquation, {
        requestId: "complex-divide-coefficient",
        expectedRevision: equationRevision(complexCoefficientEquation),
        actor: { kind: "human" },
        command: divideComplexCoefficient.command,
        standingAssumptions: [],
      })
    : null;
  check(
    "S18 a closed nonzero complex coefficient cancels without a fake variable assumption",
    dividedComplexCoefficient?.status === "applied" &&
      printTreeEq(dividedComplexCoefficient.outcome.treeNext) === "x = y/((4i + 3))" &&
      dividedComplexCoefficient.outcome.pill === undefined
  );

  const logarithmProductEquation = parsed("y = ln(x*z)");
  const realLogRewrite = listApplicableEquationOperations(logarithmProductEquation)
    .find((operation) => operation.label === "ln(a·b) = ln a + ln b");
  const complexRewriteInventory = listApplicableEquationOperations(
    logarithmProductEquation,
    { scalarRealm: "complex", mappingSignatureId: "mapping|audit-complex" }
  );
  const forcedComplexRewrite = realLogRewrite
    ? applyEquationCommand(logarithmProductEquation, {
        requestId: "complex-real-log-rewrite",
        expectedRevision: equationRevision(logarithmProductEquation),
        actor: { kind: "ai" },
        command: realLogRewrite.command,
        operationContext: {
          scalarRealm: "complex",
          mappingSignatureId: "mapping|audit-complex",
        },
      })
    : null;
  check(
    "S19 principal-complex context neither advertises nor executes real-only log laws",
    !!realLogRewrite &&
      !complexRewriteInventory.some(
        (operation) => operation.label === "ln(a·b) = ln a + ln b"
      ) &&
      forcedComplexRewrite?.status === "rejected"
  );

  const blockedComplexDerivative = executeEquationCommand(
    parsed("y = x^x"),
    {
      type: "differentiate",
      context: {
        mode: "ordinary",
        withRespectTo: "x",
        dependent: ["y"],
        heldConstant: [],
      },
    },
    { scalarRealm: "complex", mappingSignatureId: "mapping|audit-complex" }
  );
  check(
    "S20 complex calculus stays inert until its derivative interpretation is explicit",
    typeof blockedComplexDerivative === "string" &&
      /holomorphic|Wirtinger/.test(blockedComplexDerivative),
    String(blockedComplexDerivative)
  );

  const complexExp = applyToolT(
    "exp",
    parsed("x = y"),
    { scalarRealm: "complex", mappingSignatureId: "test-complex-exp" }
  );
  check(
    "S21 exponentiating in the complex realm records exp periodicity",
    complexExp !== null &&
      typeof complexExp !== "string" &&
      complexExp.dangerous === true &&
      complexExp.pill === "check periods" &&
      complexExp.note?.includes("2πi") === true
  );

  const hiddenComplexArithmetic = parsed("f = re(e^(ln(i*t)))");
  const hiddenComplexInventory = listApplicableEquationOperations(
    hiddenComplexArithmetic,
    { scalarRealm: "real" }
  );
  check(
    "S22 a real-valued wrapper cannot hide complex arithmetic from branch safety",
    hiddenComplexInventory.every(
      (operation) => operation.label !== "ln(a·b) = ln a + ln b"
    ) &&
      hiddenComplexInventory.every(
        (operation) => operation.operationContext.scalarRealm === "complex"
      )
  );

  check(
    "S23 simplification preserves a principal branch after complex syntax folds",
    isComplex(valueOf("(i^2)^(1/3)"), 0.5, Math.sqrt(3) / 2)
  );

  const markedComplexRoot = rootBothT(
    parsed("z^3 = -8"),
    3,
    { scalarRealm: "complex", mappingSignatureId: "test-complex-root" }
  );
  check(
    "S24 a complex root operation cannot fall back to the real odd root",
    markedComplexRoot !== null &&
      typeof markedComplexRoot !== "string" &&
      markedComplexRoot.treeNext.right.kind === "pow" &&
      markedComplexRoot.treeNext.right.branch === "principal-complex" &&
      isComplex(
        evalClosedNode(markedComplexRoot.treeNext.right),
        1,
        Math.sqrt(3)
      )
  );

  const markedPrincipalCubeRoot = tpow(
    tc(-8),
    tc(1, 3),
    "principal-complex"
  );
  const reciprocalPrincipalRoot = applyToolT(
    "recip",
    { left: markedPrincipalCubeRoot, right: tc(1) },
    { scalarRealm: "complex", mappingSignatureId: "test-reciprocal-root" }
  );
  const reciprocalNode =
    reciprocalPrincipalRoot !== null &&
    typeof reciprocalPrincipalRoot !== "string"
      ? reciprocalPrincipalRoot.treeNext.left
      : null;
  check(
    "S25 reciprocal preserves a principal-complex root marker",
    reciprocalNode?.kind === "pow" &&
      reciprocalNode.branch === "principal-complex" &&
      isComplex(
        evalClosedNode(reciprocalNode),
        0.25,
        -Math.sqrt(3) / 4
      )
  );

  const markedNegativePower = tpow(
    tc(-8),
    tc(-1, 3),
    "principal-complex"
  );
  const displayedDenominator =
    displayedProductUnits(markedNegativePower).denominator[0]?.expr;
  const denominatorFactor =
    treeFactorLayout(markedNegativePower.id, markedNegativePower)
      .denominator[0]?.expr;
  check(
    "S26 denominator projection and drag layout retain the principal branch",
    displayedDenominator?.kind === "pow" &&
      displayedDenominator.branch === "principal-complex" &&
      denominatorFactor?.kind === "pow" &&
      denominatorFactor.branch === "principal-complex" &&
      isComplex(
        evalClosedNode(displayedDenominator),
        1,
        Math.sqrt(3)
      )
  );
}

console.log("\n== wire format ==");
{
  const source: ScalarValue = { kind: "complex", re: 3, im: -4 };
  const roundTrip = JSON.parse(JSON.stringify(source)) as ScalarValue;
  check(
    "W1 ScalarValue is plain JSON with no class-instance revival",
    roundTrip.kind === "complex" && roundTrip.re === 3 && roundTrip.im === -4
  );

  const evaluated = valueOf("sqrt(-1)");
  const restored = JSON.parse(JSON.stringify(evaluated)) as EvalResult;
  check(
    "W2 EvalResult preserves its realm and complex value through JSON",
    restored.ok &&
      restored.realm === "complex" &&
      restored.value.kind === "complex" &&
      restored.value.im === 1
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
