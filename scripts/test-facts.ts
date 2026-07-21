/**
 * Domain-fact contract (Phase C of docs/design/architecture-review.md).
 *
 * Standing assumptions — history pills and human-declared symbol facts —
 * parse back into simplifier licenses, and the engine applies them to every
 * command result: once a step assumed x ≠ 0, a later x/x folds without
 * asking again. The parse is a whitelist: pill text either matches the
 * machine-generated grammar exactly or licenses nothing.
 *
 * Run: npx tsx scripts/test-facts.ts
 */
import { assumeKeysOf, factsFromAssumptions } from "../src/tools/equation-builder/facts";
import {
  addendsOf,
  ensureTreeEqIds,
  keyOf,
  printNode,
  printTreeEq,
  simplify,
  tadd,
  tc,
  tmul,
  tpow,
  tv,
  type TreeEq,
} from "../src/tools/equation-builder/tree";
import { applyEquationCommand } from "../src/tools/equation-builder/engine";
import { equationRevision } from "../src/tools/equation-builder/document";

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log("== F. pill grammar → domain facts ==");
{
  const f1 = factsFromAssumptions(["x ≠ 0"]);
  check("F1 symbol nonzero pill parses", f1.nonzero.has(keyOf(tv("x"))) && f1.positive.size === 0);

  const f2 = factsFromAssumptions(["u, v > 0"]);
  check("F2 thawed-positivity list parses per symbol", f2.positive.has(keyOf(tv("u"))) && f2.positive.has(keyOf(tv("v"))));

  const f3 = factsFromAssumptions(["principal value", "check roots", "sides > 0", "branch +", "logarithm argument > 0"]);
  check("F3 non-symbolic pills license nothing", f3.nonzero.size === 0 && f3.positive.size === 0);

  const f4 = factsFromAssumptions(["x + 3 ≠ 0"]);
  check(
    "F4 expression pills round-trip through the parser",
    f4.nonzero.has(keyOf(simplify(tadd(tv("x"), tc(3))))),
    JSON.stringify(Array.from(f4.nonzero))
  );

  const f5 = factsFromAssumptions(["x ≠ 0 · principal value"]);
  check("F5 composite pills split on the move joiner", f5.nonzero.has(keyOf(tv("x"))) && f5.nonzero.size === 1);

  const f6 = factsFromAssumptions(["2 ≠ 0"]);
  check("F6 constant pills add no symbolic fact", f6.nonzero.size === 0);

  const f7 = factsFromAssumptions(["y′ > 0"]);
  check("F7 derivative-born symbols are valid fact subjects", f7.positive.has(keyOf(tv("y′"))));
}

console.log("== G. facts license the simplifier ==");
{
  const xOverX = tmul(tv("x"), tpow(tv("x"), -1));
  check("G1 x/x stays put unlicensed", printNode(simplify(xOverX)) !== "1", printNode(simplify(xOverX)));
  check(
    "G2 standing x ≠ 0 folds x/x to 1",
    printNode(simplify(xOverX, assumeKeysOf(factsFromAssumptions(["x ≠ 0"])))) === "1"
  );
  check(
    "G3 positivity implies nonzero for the license",
    printNode(simplify(xOverX, assumeKeysOf(factsFromAssumptions(["x > 0"])))) === "1"
  );
  const sumCancel = tmul(tadd(tv("x"), tc(3)), tpow(tadd(tv("x"), tc(3)), -1));
  check(
    "G4 expression facts license matching compound cancels",
    printNode(simplify(sumCancel, assumeKeysOf(factsFromAssumptions(["x + 3 ≠ 0"])))) === "1"
  );
  check(
    "G5 a fact about y licenses nothing about x",
    printNode(simplify(xOverX, assumeKeysOf(factsFromAssumptions(["y ≠ 0"])))) !== "1"
  );
}

console.log("== H. the engine applies standing facts to command results ==");
{
  // x/x + 1 = y, then move the 1 across. The move itself has no license to
  // fold x/x; the standing assumption does.
  const te: TreeEq = ensureTreeEqIds({
    left: tadd(tmul(tv("x"), tpow(tv("x"), -1)), tc(1)),
    right: tv("y"),
  });
  const one = addendsOf(te.left).find((addend) => printNode(addend) === "1")!;
  const request = {
    requestId: "facts-test",
    expectedRevision: equationRevision(te),
    actor: { kind: "human" as const },
    command: {
      type: "gesture" as const,
      payload: { kind: "terms" as const, ids: [one.id], from: "left" as const },
      target: { kind: "side" as const, side: "right" as const },
    },
  };

  const bare = applyEquationCommand(te, request);
  check(
    "H1 without standing facts the quotient survives the move",
    bare.status === "applied" && printTreeEq(bare.outcome.treeNext).includes("x"),
    bare.status === "applied" ? printTreeEq(bare.outcome.treeNext) : bare.status
  );

  const licensed = applyEquationCommand(te, { ...request, standingAssumptions: ["x ≠ 0"] });
  check(
    "H2 standing x ≠ 0 folds the result after the move",
    licensed.status === "applied" && printTreeEq(licensed.outcome.treeNext) === "1 = y − 1",
    licensed.status === "applied" ? printTreeEq(licensed.outcome.treeNext) : licensed.status
  );
  check(
    "H3 the un-licensed shape is preserved as the readable intermediate",
    licensed.status === "applied" &&
      !!licensed.outcome.treeIntermediate &&
      printTreeEq(licensed.outcome.treeIntermediate).includes("x")
  );
  check(
    "H4 irrelevant standing facts change nothing",
    (() => {
      const inert = applyEquationCommand(te, { ...request, standingAssumptions: ["z ≠ 0", "principal value"] });
      return (
        inert.status === "applied" &&
        bare.status === "applied" &&
        printTreeEq(inert.outcome.treeNext) === printTreeEq(bare.outcome.treeNext)
      );
    })()
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
