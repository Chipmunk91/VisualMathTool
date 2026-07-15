/**
 * The mathematical-operation sanity suite (owner's "sanity check part 1").
 * Pure layer only — model arithmetic, the tree simplifier, and the tree
 * moves — no browser. Gesture-level scenarios live in the Playwright
 * suites; the full scenario matrix is docs/testing/math-op-scenarios.md.
 *
 * Run: npx tsx scripts/test-mathops.ts
 */
import { leaf, combine, scaleNum, scaleDen, group, cloneState } from "../src/tools/equation-builder/model";
import {
  tc,
  tv,
  tadd,
  tmul,
  tpow,
  tfn,
  simplify,
  printNode,
  printTreeEq,
  evalNode,
  keyOf,
  flatToTree,
  type TreeEq,
  type TNode,
} from "../src/tools/equation-builder/tree";
import {
  applyToolT,
  cancelFactorT,
  divideBothT,
  moveTermsT,
  multiplyBothT,
  normalizeOnLoad,
  raiseBothT,
  rootBothT,
  thawExpLn,
  type TreeMoveResult,
  type TreeOutcome,
} from "../src/tools/equation-builder/treemoves";
import { CATALOG } from "../src/tools/equation-builder/catalog";
import { parseEquation } from "../src/tools/equation-builder/parse";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail?: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? `  [${detail}]` : ""}`);
  cond ? pass++ : fail++;
};
const simp = (name: string, node: TNode, want: string) => {
  const got = printNode(simplify(node));
  check(name, got === want, `got ${got}, want ${want}`);
};
const simplifyEval = (node: TNode, x: number): number => evalNode(simplify(node), { x });
const outcomeText = (r: TreeMoveResult): string => {
  if (r === null) return "(null)";
  if (typeof r === "string") return `refusal: ${r}`;
  const o: TreeOutcome = r;
  if (o.treeNext) return printTreeEq(o.treeNext);
  return `${printNode(flatToTree(o.flatNext!.left))} = ${printNode(flatToTree(o.flatNext!.right))}`;
};
const move = (name: string, r: TreeMoveResult, want: string, wantPill?: string) => {
  const got = outcomeText(r);
  check(name, got === want, `got ${got}, want ${want}`);
  if (wantPill !== undefined) {
    const pill = r !== null && typeof r !== "string" ? (r.pill ?? "(none)") : "(refused)";
    check(`${name} — pill`, pill === wantPill, `got ${pill}, want ${wantPill}`);
  }
};

console.log("\n== A. model arithmetic: combine / scale (flat layer) ==");
{
  const twoX = leaf(2, 1), minus3 = leaf(-3), minus7 = leaf(-7);
  const right = combine([minus7, scaleNum(minus3, -1)]);
  check("A1 move-merge arithmetic: −7 + 3 = −4", right.length === 1 && right[0].num === -4 && right[0].den === 1);
  check("A2 sink id preserved (resident absorbs mover)", right[0].id === minus7.id);
  check("A3 untouched term keeps id through combine", combine([twoX])[0].id === twoX.id);
  const halves = combine([scaleDen(leaf(2, 1), 2), scaleDen(leaf(-7), 2)]);
  check("A4 divide-both scaling: 2x/2 → x, −7/2 stays", halves.some((t) => t.num === 1 && t.den === 1 && t.power === 1) && halves.some((t) => t.num === -7 && t.den === 2));
  const merged = combine([leaf(1, 1, 2), leaf(1, 1, 3)]);
  check("A5 like terms add exactly: x/2 + x/3 = 5x/6", merged.length === 1 && merged[0].num === 5 && merged[0].den === 6);
  check("A6 zero terms vanish", combine([leaf(3), leaf(-3), leaf(1, 1)]).every((t) => !(t.power === 0 && t.num !== 0)));
  check("A7 emptied side becomes a lone 0", combine([leaf(3), leaf(-3)])[0].num === 0);
  const g = group(2, [leaf(1, 1), leaf(3)]);
  const passed = combine([g]);
  check("A8 group passthrough keeps identity", passed[0].id === g.id && passed[0].kind === "group");
  const unwrapped = combine([{ ...g, num: 1 }]);
  check("A9 factor-1 group unwraps, inner ids kept", unwrapped.some((t) => t.id === g.inner[0].id));
  const st = { left: [leaf(2, 1)], right: [leaf(4)] };
  check("A10 history snapshots preserve ids", cloneState(st).left[0].id === st.left[0].id);
  const pm = { ...leaf(2), pm: true };
  check("A11 terminal ± only flips, never scales", (scaleNum(pm, -1) as typeof pm).pm === true && scaleNum(pm, -1).num === 2);
}

console.log("\n== B. simplifier: rational + power laws ==");
simp("B1 6/2 folds to 3", tmul(tc(6), tpow(tc(2), -1)), "3");
simp("B2 like addends merge: x/2 + x/3", tadd(tmul(tc(1, 2), tv("x")), tmul(tc(1, 3), tv("x"))), "5/6x");
simp("B3 zero annihilates a product", tmul(tc(0), tv("x"), tfn("sin", tv("x"))), "0");
simp("B4 x·x² merges within a sign class", tmul(tv("x"), tpow(tv("x"), 2)), "x³");
simp("B5 x³/x² honestly stays (0 in domain gap)", tmul(tpow(tv("x"), 3), tpow(tv("x"), -2)), "x³/x²");
{
  const assume = new Set([keyOf(tv("x"))]);
  const got = printNode(simplify(tmul(tpow(tv("x"), 3), tpow(tv("x"), -2)), assume));
  check("B6 …but cancels under a declared x ≠ 0", got === "x", got);
}
simp("B7 √4 folds exactly", tfn("sqrt", tc(4)), "2");
simp("B8 8^(1/3) folds exactly", tpow(tc(8), tc(1, 3)), "2");
simp("B9 (−8)^(1/3) = −2 (odd roots keep sign)", tpow(tc(-8), tc(1, 3)), "−2");
simp("B10 x⁰ with x unknown stays honest? — const base folds", tpow(tc(5), tc(0)), "1");
simp("B11 (b²)³ = b⁶", tpow(tpow(tv("x"), 2), 3), "x⁶");
simp("B12 (ab)² distributes", tpow(tmul(tv("x"), tv("y")), 2), "x²·y²");

console.log("\n== C. simplifier: exponential laws ==");
simp("C1 e³·e⁻² = e", tmul(tfn("exp", tc(3)), tpow(tfn("exp", tc(2)), -1)), "e");
simp("C2 e²·e³ = e⁵", tmul(tfn("exp", tc(2)), tfn("exp", tc(3))), "e^5");
simp("C3 e²/e² = 1", tmul(tfn("exp", tc(2)), tpow(tfn("exp", tc(2)), -1)), "1");
simp("C4 (e^x)² = e^2x", tpow(tfn("exp", tv("x")), 2), "e^(2x)");
simp("C5 e^x·e² = e^(x+2)", tmul(tfn("exp", tv("x")), tfn("exp", tc(2))), "e^(x + 2)");
simp("C6 ln(e^u) = u", tfn("ln", tfn("exp", tv("x"))), "x");
simp("C7 e^0 = 1", tfn("exp", tc(0)), "1");
simp("C8 ln 1 = 0", tfn("ln", tc(1)), "0");

console.log("\n== D. simplifier: root laws (sign-aware) ==");
simp("D1 odd root distributes over a product", tpow(tmul(tfn("exp", tc(3)), tv("x"), tpow(tfn("sin", tv("x")), -1)), tc(1, 3)), "(e·x^(1/3))/(sin(x))^(1/3)");
simp("D2 (8x³)^(1/3) = 2x", tpow(tmul(tc(8), tpow(tv("x"), 3)), tc(1, 3)), "2x");
simp("D3 even root pulls out e^u only", tpow(tmul(tfn("exp", tc(2)), tv("x")), tc(1, 2)), "e·x^(1/2)");
simp("D4 even root refuses signed factors", tpow(tmul(tv("x"), tv("y")), tc(1, 2)), "(x·y)^(1/2)");
simp("D5 (x⁻¹)^(1/3) = x^(−1/3)", tpow(tpow(tv("x"), -1), tc(1, 3)), "x^(−1/3)");
simp("D6 (x^(1/3))³ = x (odd chain)", tpow(tpow(tv("x"), tc(1, 3)), 3), "x");
simp("D7 x² does NOT silently become |x| under √", tpow(tpow(tv("x"), 2), tc(1, 2)), "(x²)^(1/2)");

console.log("\n== E. tree moves: additive ==");
{
  const te: TreeEq = { left: tadd(tv("x"), tc(3)), right: tc(7) };
  move("E1 move +3 across: x + 3 = 7 → x = 4", moveTermsT(te, ["L1"], "left", "right"), "x = 4");
  move("E2 move x across: → 3 = 7 − x", moveTermsT(te, ["L0"], "left", "right"), "3 = −x + 7");
  check("E3 same-side move refuses", moveTermsT(te, ["L0"], "left", "left") === null);
}

console.log("\n== F. tree moves: multiplicative ==");
{
  const frac: TreeEq = { left: tmul(tfn("exp", tc(3)), tv("x"), tpow(tfn("sin", tv("x")), -1)), right: tv("y") };
  move("F1 multiply by the denominator", multiplyBothT(frac, tfn("sin", tv("x")), "sin(x)"), "e^3·x = y·sin(x)");
  move("F2 divide by e³ exactly", divideBothT(frac, tfn("exp", tc(3)), "e^3"), "x/sin(x) = e^(−3)·y");
  const withPill = divideBothT(frac, tv("x"), "x");
  move("F3 divide by x carries the pill", withPill, "e^3/sin(x) = y/x", "x ≠ 0");
  check("F4 divide by zero refuses", divideBothT(frac, tc(0), "0") === "can't divide by zero");
  check("F5 divide by one is a non-move", divideBothT(frac, tc(1), "1") === null);
  const cancel = divideBothT({ left: tmul(tc(3), tv("x")), right: tc(6) }, tc(3), "3");
  move("F6 divide by 3 cancels exactly", cancel, "x = 2");
}

console.log("\n== G. tree moves: roots and powers ==");
{
  const cube: TreeEq = { left: tpow(tadd(tv("x"), tc(1)), 3), right: tc(8) };
  move("G1 cube root of (x+1)³ = 8", rootBothT(cube, 3), "x + 1 = 2");
  const sq: TreeEq = { left: tpow(tadd(tv("x"), tc(1)), 2), right: tc(9) };
  move("G2 square root keeps the principal branch", rootBothT(sq, 2), "x + 1 = 3", "principal root");
  const rooted: TreeEq = { left: tpow(tadd(tv("x"), tc(1)), tc(1, 3)), right: tc(2) };
  move("G3 raising to 3 undoes a cube root", raiseBothT(rooted, 3), "x + 1 = 8");
  const halfRoot: TreeEq = { left: tpow(tadd(tv("x"), tc(1)), tc(1, 2)), right: tc(3) };
  move("G4 squaring carries check-roots", raiseBothT(halfRoot, 2), "x + 1 = 9", "check roots");
  check("G5 root n must be an integer ≥ 2", rootBothT(cube, 1) === null && raiseBothT(cube, 0) === null);
  const fracEq: TreeEq = { left: tmul(tfn("exp", tc(3)), tv("x"), tpow(tfn("sin", tv("x")), -1)), right: tv("y") };
  const rootedFrac = rootBothT(fracEq, 3);
  move("G6 cube root simplifies the exponential out", rootedFrac, "(e·x^(1/3))/(sin(x))^(1/3) = y^(1/3)");
  if (rootedFrac && typeof rootedFrac !== "string" && rootedFrac.treeNext) {
    move("G7 raise round-trips to the original", raiseBothT(rootedFrac.treeNext, 3), "(e^3·x)/sin(x) = y");
  } else {
    check("G7 raise round-trips to the original", false, "no tree state to raise");
  }
}

console.log("\n== I. cancellation: the gesture the simplifier refuses silently ==");
{
  const xp2 = tadd(tv("x"), tc(2));
  const redundant: TreeEq = { left: tmul(xp2, tpow(xp2, -1)), right: tv("y") };
  simp("I1 (x+2)/(x+2) honestly STAYS in the simplifier", tmul(xp2, tpow(xp2, -1)), "((x + 2))/((x + 2))");
  const cancelled = cancelFactorT(redundant, "L0", xp2, "x + 2");
  move("I2 the cancel gesture resolves it, pilled", cancelled, "1 = y", "x + 2 ≠ 0");
  const mismatch = cancelFactorT({ left: tmul(xp2, tpow(tfn("sin", tv("x")), -1)), right: tv("y") }, "L0", xp2, "x + 2");
  check("I3 a non-matching pair refuses", typeof mismatch === "string", String(mismatch));
  // constants (3/3) never persist — combine folds them — so the gesture
  // only ever fires on var-bearing pairs, always pilled
  const sinPair: TreeEq = { left: tmul(tfn("sin", tv("x")), tv("y"), tpow(tfn("sin", tv("x")), -1)), right: tc(2) };
  const sinCancel = cancelFactorT(sinPair, "L0", tfn("sin", tv("x")), "sin(x)");
  move("I4 sin(x)/sin(x) cancels with its pill", sinCancel, "y = 2", "sin(x) ≠ 0");
}

console.log("\n== H. tree tools: functions ==");
{
  const expEq: TreeEq = { left: tfn("exp", tv("x")), right: tc(5) };
  move("H1 ln thaws e^x = 5", applyToolT("ln", expEq), "x = ln(5)");
  const negRhs: TreeEq = { left: tv("x"), right: tc(-5) };
  const refused = applyToolT("ln", negRhs);
  check("H2 ln of a negative side refuses", typeof refused === "string", String(refused));
  const lnEq: TreeEq = { left: tfn("ln", tv("x")), right: tc(2) };
  move("H3 exp thaws ln(x) = 2", applyToolT("exp", lnEq), "x = e^2");
  const sq2: TreeEq = { left: tfn("sqrt", tadd(tv("x"), tc(1))), right: tc(3) };
  const squared = applyToolT("square", sq2);
  move("H4 squaring resolves a radical", squared, "x + 1 = 9", "check roots");
}

console.log("\n== J. sympy-style normalization: cancel + thaw, receipts attached ==");
{
  const xp2 = tadd(tv("x"), tc(2));
  const n1 = normalizeOnLoad({ left: tmul(xp2, tpow(xp2, -1)), right: tv("y") });
  check("J1 (x+2)/(x+2)=y loads as 1 = y", printTreeEq(n1.te) === "1 = y", printTreeEq(n1.te));
  check("J1 — pill", n1.pill === "x + 2 ≠ 0", n1.pill);
  const n2 = normalizeOnLoad({
    left: tfn("exp", tadd(tfn("ln", tv("x")), tc(5, 2))),
    right: tfn("exp", tmul(tc(1, 4), tv("y"))),
  });
  check("J2 e^(ln x + 5/2) thaws at load", printTreeEq(n2.te) === "e^(5/2)·x = e^(1/4y)", printTreeEq(n2.te));
  check("J2 — pill", n2.pill === "x > 0", n2.pill);
  const n3 = normalizeOnLoad({ left: tmul(tc(2), tv("x")), right: tc(10) });
  check("J3 a plain equation loads untouched", !n3.changed && printTreeEq(n3.te) === "2x = 10");
  // the MOVE path: any finalize-produced state thaws too, with the note
  const r = applyToolT("exp", { left: tadd(tfn("ln", tv("x")), tc(5, 2)), right: tmul(tc(1, 4), tv("y")) });
  const ok = r !== null && typeof r !== "string" && r.treeNext !== null;
  check("J4 exp tool thaws e^(ln x + …) via finalize", ok && printTreeEq(r.treeNext!) === "e^(5/2)·x = e^(1/4y)", ok ? printTreeEq((r as TreeOutcome).treeNext!) : String(r));
  check("J4 — pill", ok && (r as TreeOutcome).pill === "x > 0");
  const t = thawExpLn(tfn("exp", tfn("ln", tadd(tv("x"), tc(1)))));
  check("J5 bare e^(ln u) = u, reported", printNode(simplify(t.node)) === "x + 1" && t.thawed.join() === "x + 1");
}

console.log("\n== K. display correctness: parens keep text unambiguous ==");
simp("K1 −(x + 2) prints with parens", tmul(tc(-1), tadd(tv("x"), tc(2))), "−(x + 2)");
simp("K1b e^(5/2) parenthesizes a fractional exponent (was e^5/2 → (e^5)/2)", tfn("exp", tc(5, 2)), "e^(5/2)");
simp("K1c e^(−1/2) parenthesizes a negative exponent", tfn("exp", tc(-1, 2)), "e^(−1/2)");
simp("K1d e^5 (integer) stays bare", tfn("exp", tc(5)), "e^5");
simp("K1e e^x (variable) stays bare", tfn("exp", tv("x")), "e^x");
simp("K1f e^(2y) (compound) keeps its parens", tfn("exp", tmul(tc(2), tv("y"))), "e^(2y)");
simp("K2 −(x − 2) keeps the inner sign", tmul(tc(-1), tadd(tv("x"), tc(-2))), "−(x − 2)");
simp("K3 nested: 5 − (x + 2)", tadd(tc(5), tmul(tc(-1), tadd(tv("x"), tc(2)))), "−(x + 2) + 5");
simp("K4 a bare negated term needs no parens", tmul(tc(-2), tv("x")), "−2x");
check("K5 −(x + 2) still evaluates to −(x+2)", simplifyEval(tmul(tc(-1), tadd(tv("x"), tc(2))), 3) === -5);

console.log("\n== L. search catalog integrity ==");
{
  const names = new Set<string>();
  for (const entry of CATALOG) {
    check(`L catalog entry parses: ${entry.name}`, parseEquation(entry.text).ok);
    check(`L catalog name is unique: ${entry.name}`, !names.has(entry.name));
    names.add(entry.name);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
