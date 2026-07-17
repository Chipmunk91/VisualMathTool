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
  tnamed,
  simplify,
  printNode,
  printTreeEq,
  evalNode,
  keyOf,
  addendsOf,
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
import { applySpecialActionT, specialActionLabel } from "../src/tools/equation-builder/specialactions";
import {
  isAtomicTreeFactorId,
  resolveTreeFactor,
  resolveTreeFactorGroup,
  treeMarqueeSelection,
  treeFactorLayout,
} from "../src/tools/equation-builder/treeunits";

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
  return printTreeEq(o.treeNext);
};
const move = (name: string, r: TreeMoveResult, want: string, wantPill?: string) => {
  const got = outcomeText(r);
  check(name, got === want, `got ${got}, want ${want}`);
  if (wantPill !== undefined) {
    const pill = r !== null && typeof r !== "string" ? (r.pill ?? "(none)") : "(refused)";
    check(`${name} — pill`, pill === wantPill, `got ${pill}, want ${wantPill}`);
  }
};
const parsedTree = (text: string): TreeEq => {
  const parsed = parseEquation(text);
  if (!parsed.ok) throw new Error(`test equation did not parse: ${text} — ${parsed.message}`);
  return parsed.tree;
};
const unitText = (te: TreeEq, id: string): string | null => {
  const unit = resolveTreeFactor(te, id);
  return unit ? printNode(unit.expr) : null;
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
simp("B2 like addends merge: x/2 + x/3", tadd(tmul(tc(1, 2), tv("x")), tmul(tc(1, 3), tv("x"))), "(5x)/6");
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
check(
  "B9b rational odd-root powers of negative bases evaluate over the reals",
  Math.abs(evalNode(tpow(tc(-8), tc(2, 3)), {}) - 4) < 1e-12 &&
    Math.abs(evalNode(tpow(tc(-8), tc(-2, 3)), {}) - 0.25) < 1e-12
);
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
simp("D1 odd root distributes over a product", tpow(tmul(tfn("exp", tc(3)), tv("x"), tpow(tfn("sin", tv("x")), -1)), tc(1, 3)), "(e·³√(x))/³√(sin(x))");
simp("D2 (8x³)^(1/3) = 2x", tpow(tmul(tc(8), tpow(tv("x"), 3)), tc(1, 3)), "2x");
simp("D3 even root pulls out e^u only", tpow(tmul(tfn("exp", tc(2)), tv("x")), tc(1, 2)), "e·√(x)");
simp("D4 even root refuses signed factors", tpow(tmul(tv("x"), tv("y")), tc(1, 2)), "√(x·y)");
simp("D5 (x⁻¹)^(1/3) = x^(−1/3)", tpow(tpow(tv("x"), -1), tc(1, 3)), "x^(−1/3)");
simp("D6 (x^(1/3))³ = x (odd chain)", tpow(tpow(tv("x"), tc(1, 3)), 3), "x");
simp("D7 x² does NOT silently become |x| under √", tpow(tpow(tv("x"), 2), tc(1, 2)), "√(x²)");

console.log("\n== E. tree moves: additive ==");
{
  const te: TreeEq = { left: tadd(tv("x"), tc(3)), right: tc(7) };
  const [xId, threeId] = addendsOf(te.left).map((addend) => addend.id);
  move("E1 move +3 across: x + 3 = 7 → x = 4", moveTermsT(te, [threeId], "left", "right"), "x = 4");
  move("E2 move x across: → 3 = 7 − x", moveTermsT(te, [xId], "left", "right"), "3 = −x + 7");
  check("E3 same-side move refuses", moveTermsT(te, [xId], "left", "left") === null);
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
  move("G6 cube root simplifies the exponential out", rootedFrac, "(e·³√(x))/³√(sin(x)) = ³√(y)");
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
  const cancelled = cancelFactorT(redundant, addendsOf(redundant.left)[0].id, xp2, "x + 2");
  move("I2 the cancel gesture resolves it, pilled", cancelled, "1 = y", "x + 2 ≠ 0");
  const mismatchEq = { left: tmul(xp2, tpow(tfn("sin", tv("x")), -1)), right: tv("y") };
  const mismatch = cancelFactorT(mismatchEq, addendsOf(mismatchEq.left)[0].id, xp2, "x + 2");
  check("I3 a non-matching pair refuses", typeof mismatch === "string", String(mismatch));
  // constants (3/3) never persist — combine folds them — so the gesture
  // only ever fires on var-bearing pairs, always pilled
  const sinPair: TreeEq = { left: tmul(tfn("sin", tv("x")), tv("y"), tpow(tfn("sin", tv("x")), -1)), right: tc(2) };
  const sinCancel = cancelFactorT(sinPair, addendsOf(sinPair.left)[0].id, tfn("sin", tv("x")), "sin(x)");
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
  check("J2 e^(ln x + 5/2) thaws at load", printTreeEq(n2.te) === "e^(5/2)·x = e^(y/4)", printTreeEq(n2.te));
  check("J2 — pill", n2.pill === "x > 0", n2.pill);
  const n3 = normalizeOnLoad({ left: tmul(tc(2), tv("x")), right: tc(10) });
  check("J3 a plain equation loads untouched", !n3.changed && printTreeEq(n3.te) === "2x = 10");
  // the MOVE path: any finalize-produced state thaws too, with the note
  const r = applyToolT("exp", { left: tadd(tfn("ln", tv("x")), tc(5, 2)), right: tmul(tc(1, 4), tv("y")) });
  const ok = r !== null && typeof r !== "string" && r.treeNext !== null;
  check("J4 exp tool thaws e^(ln x + …) via finalize", ok && printTreeEq(r.treeNext!) === "e^(5/2)·x = e^(y/4)", ok ? printTreeEq((r as TreeOutcome).treeNext!) : String(r));
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
simp("K6 rational product coefficients display below the shared bar", tmul(tc(1, 3), tfn("exp", tc(5)), tpow(tv("x"), -1)), "e^5/(3x)");
simp("K7 a reciprocal inside a denominator stays parenthesized", tmul(tc(729), tpow(tpow(tv("y"), -6), -1)), "729/(1/y⁶)");

console.log("\n== L. search catalog integrity ==");
{
  const names = new Set<string>();
  for (const entry of CATALOG) {
    check(`L catalog entry parses: ${entry.name}`, parseEquation(entry.text).ok);
    check(`L catalog name is unique: ${entry.name}`, !names.has(entry.name));
    names.add(entry.name);
  }
}

console.log("\n== L2. pencil-style cross-variable products ==");
{
  const xy = parsedTree("xy = 1");
  check("L2.1 xy parses as two multiplied variables", printTreeEq(xy) === "x·y = 1", printTreeEq(xy));
  check("L2.2 yx canonicalizes to the same product", printTreeEq(parsedTree("yx = 1")) === "x·y = 1");
  check("L2.3 a numeric coefficient works with juxtaposition", printTreeEq(parsedTree("2xy = 1")) === "2x·y = 1");
  check("L2.4 repeated variables simplify recursively", printTreeEq(parsedTree("xxy = 1")) === "x²·y = 1");
  check(
    "L2.5 a power binds to the adjacent variable",
    printTreeEq(parsedTree("xy^2 = 1")) === printTreeEq(parsedTree("x*y^2 = 1"))
  );
  check("L2.6 parentheses raise the complete product", printTreeEq(parsedTree("(xy)^2 = 1")) === "x²·y² = 1");
  const unknown = parseEquation("velocity = 1");
  check(
    "L2.7 unknown multi-letter symbols remain unsupported",
    !unknown.ok && unknown.stage === "convert" && unknown.message.includes('"velocity"')
  );

  const factorLayout = treeFactorLayout(xy.left.id, xy.left);
  const xFactor = factorLayout.numerator.find((unit) => printNode(unit.expr) === "x");
  const yFactor = factorLayout.numerator.find((unit) => printNode(unit.expr) === "y");
  check("L2.8 x and y receive independent semantic factor handles", Boolean(xFactor && yFactor));
  if (xFactor && yFactor) {
    move("L2.9 moving x divides the other side", divideBothT(xy, xFactor.expr, "x"), "y = 1/x", "x ≠ 0");
    move("L2.10 moving y divides the other side", divideBothT(xy, yFactor.expr, "y"), "x = 1/y", "y ≠ 0");
  }
}

console.log("\n== M. symbol operations: displayed factor contract ==");
{
  const inventory = (layout: ReturnType<typeof treeFactorLayout>) =>
    [...layout.numerator, ...layout.denominator].map((u) => `${u.role}:${printNode(u.expr)}`).join(" | ");
  const unitByText = (layout: ReturnType<typeof treeFactorLayout>, text: string, zone?: "n" | "d") =>
    [...layout.numerator, ...layout.denominator].find(
      (unit) => printNode(unit.expr) === text && (!zone || unit.zone === zone)
    );

  // Owner-reported regression: both right-side factors must be independently
  // draggable, while the exponent remains a nested structural action.
  const reported = parsedTree("e^3*x = sin(y)*e^5/sqrt(3)");
  check("M1 reported equation reaches the expected tree", printTreeEq(reported) === "e^3·x = (e^5·sin(y))/√(3)", printTreeEq(reported));

  const reportedLeft = addendsOf(reported.left)[0];
  const reportedRight = addendsOf(reported.right)[0];
  const left = treeFactorLayout(reportedLeft.id, reportedLeft);
  const right = treeFactorLayout(reportedRight.id, reportedRight);
  check(
    "M2 every left product factor is its own unit",
    inventory(left) === "coef:e^3 | numer:x",
    inventory(left)
  );
  check(
    "M3 function, exponential, and radical resolve independently",
    inventory(right) === "coef:e^5 | numer:sin(y) | den:√(3)",
    inventory(right)
  );
  const wholeRight = right.wholeNumerator?.id ?? "";
  check("M4 the numerator gap resolves to the whole product", unitText(reported, wholeRight) === "e^5·sin(y)", unitText(reported, wholeRight) ?? "null");
  check("M5 old variable-specific ids are not minted by the factor contract", unitText(reported, "L0@x") === null);

  const sinY = resolveTreeFactor(reported, unitByText(right, "sin(y)")!.id)!;
  move(
    "M6 move only sin(y)",
    divideBothT(reported, sinY.expr, printNode(sinY.expr)),
    "(e^3·x)/sin(y) = e^5/√(3)",
    "sin(y) ≠ 0"
  );
  const e5 = resolveTreeFactor(reported, unitByText(right, "e^5")!.id)!;
  move(
    "M7 move only e^5",
    divideBothT(reported, e5.expr, printNode(e5.expr)),
    "e^(−2)·x = sin(y)/√(3)"
  );
  const sqrt3 = resolveTreeFactor(reported, unitByText(right, "√(3)", "d")!.id)!;
  move(
    "M8 move only denominator √3",
    multiplyBothT(reported, sqrt3.expr, printNode(sqrt3.expr)),
    "√(3)·e^3·x = e^5·sin(y)"
  );

  // The sign is a separate displayed glyph. The factor underneath it must
  // resolve to positive 2, not the old drop-side value of negative 2.
  const signed: TreeEq = {
    left: simplify(tmul(tc(-2), tfn("sin", tv("x")))),
    right: tv("y"),
  };
  const signedLayout = treeFactorLayout(signed.left.id, signed.left);
  const signedCoef = signedLayout.numerator[0];
  check(
    "M9 a signed product's visible coefficient resolves to its magnitude",
    printNode(signedCoef.expr) === "2" && unitText(signed, signedCoef.id) === "2",
    inventory(signedLayout)
  );
  move("M10 moving that visible 2 divides by +2", divideBothT(signed, signedCoef.expr, "2"), "−sin(x) = y/2");

  // A denominator-only product displays a literal 1 above the bar. That 1 is
  // not a meaningful factor move and must not get a phantom @N handle.
  const denominatorOnly: TreeEq = {
    left: simplify(tmul(tpow(tfn("sin", tv("x")), -1), tpow(tadd(tv("x"), tc(1)), -1))),
    right: tv("y"),
  };
  const denominatorLayout = treeFactorLayout(denominatorOnly.left.id, denominatorOnly.left);
  check(
    "M11 reciprocal-only products expose denominator factors without a phantom numerator",
    denominatorLayout.numerator.length === 0 &&
      denominatorLayout.denominator.length === 2 &&
      denominatorLayout.wholeNumerator === null &&
      denominatorLayout.wholeNumerator === null,
    inventory(denominatorLayout)
  );

  // Atomicity boundary: immediate powers/functions/groups are factors; their
  // bases, exponents, and arguments are syntax inside that unit.
  const composite: TreeEq = {
    left: simplify(
      tmul(
        tpow(tv("x"), 3),
        tfn("sin", tadd(tv("y"), tc(1))),
        tpow(tadd(tv("x"), tc(1)), -1)
      )
    ),
    right: tc(7),
  };
  const compositeLayout = treeFactorLayout(composite.left.id, composite.left);
  check(
    "M12 powers, functions, and grouped denominators stay atomic",
    inventory(compositeLayout) === "numer:x³ | numer:sin(y + 1) | den:x + 1",
    inventory(compositeLayout)
  );

  const constants: TreeEq = {
    left: simplify(tmul(tfn("exp", tc(5)), tfn("ln", tc(2)), tfn("sqrt", tc(3)))),
    right: tv("x"),
  };
  const constantLayout = treeFactorLayout(constants.left.id, constants.left);
  check(
    "M13 every constant-valued composite is a precise coefficient unit",
    constantLayout.numerator.length === 3 && constantLayout.numerator.every((u) => u.role === "coef"),
    inventory(constantLayout)
  );

  const oneFactorNode = tfn("sin", tv("x"));
  const oneFactor = treeFactorLayout(oneFactorNode.id, oneFactorNode);
  check("M14 a single factor has no redundant whole-numerator hitbox", oneFactor.wholeNumerator === null);
  check("M15 malformed ids resolve safely", unitText(reported, "factor:missing:n:missing") === null && unitText(reported, "not-a-handle") === null);

  // Generated shape matrix: run the same renderer/resolver/move contract over
  // the factor families students can currently type, rather than protecting
  // only the one reported equation.
  const shapes: [string, TNode][] = [
    ["variable", tv("x")],
    ["integer power", tpow(tv("x"), 3)],
    ["grouped sum", tadd(tv("x"), tc(2))],
    ["trig function", tfn("sin", tv("y"))],
    ["log function", tfn("ln", tadd(tv("x"), tc(2)))],
    ["radical", tfn("sqrt", tadd(tv("y"), tc(3)))],
    ["constant exponential", tfn("exp", tc(5))],
    ["variable exponential", tfn("exp", tadd(tv("x"), tc(1)))],
    ["variable exponent", tpow(tc(2), tv("x"))],
    ["powered function", tpow(tfn("sin", tv("y")), 2)],
  ];
  let matrixFailure = "";
  for (const [name, shape] of shapes) {
    const te: TreeEq = {
      left: simplify(tmul(tc(11), shape, tpow(tfn("cos", tadd(tv("y"), tc(2))), -1))),
      right: tfn("exp", tadd(tv("x"), tc(4))),
    };
    const layout = treeFactorLayout(te.left.id, te.left);
    const picked = layout.numerator.find((u) => keyOf(u.expr) === keyOf(simplify(shape)));
    const denominator = layout.denominator[0];
    const resolved = picked ? resolveTreeFactor(te, picked.id) : null;
    const divided = picked ? divideBothT(te, picked.expr, printNode(picked.expr)) : null;
    const multiplied = denominator ? multiplyBothT(te, denominator.expr, printNode(denominator.expr)) : null;
    if (
      !picked ||
      !resolved ||
      keyOf(resolved.expr) !== keyOf(picked.expr) ||
      !divided ||
      typeof divided === "string" ||
      !multiplied ||
      typeof multiplied === "string"
    ) {
      matrixFailure = `${name}: ${inventory(layout)}`;
      break;
    }
  }
  check(`M16 generated ${shapes.length}-shape factor matrix resolves and moves`, matrixFailure === "", matrixFailure);

  const screenshotEq = parsedTree("e^5/x = 3*e^2*sin(y)");
  const screenshotLeft = treeFactorLayout(screenshotEq.left.id, screenshotEq.left);
  const screenshotRight = treeFactorLayout(screenshotEq.right.id, screenshotEq.right);
  const threeId = unitByText(screenshotRight, "3")!.id;
  const e2Id = unitByText(screenshotRight, "e^2")!.id;
  const sinId = unitByText(screenshotRight, "sin(y)")!.id;
  const e5Id = unitByText(screenshotLeft, "e^5")!.id;
  const xDenId = unitByText(screenshotLeft, "x", "d")!.id;
  const coefficientAndExp = resolveTreeFactorGroup(screenshotEq, [threeId, e2Id]);
  check(
    "M17 a selected coefficient + exponential resolves as one numerator chunk",
    coefficientAndExp?.zone === "n" && printNode(coefficientAndExp.expr) === "3e^2",
    coefficientAndExp ? printNode(coefficientAndExp.expr) : "null"
  );
  move(
    "M18 moving 3e² together divides both sides by the selected product",
    coefficientAndExp && divideBothT(screenshotEq, coefficientAndExp.expr, printNode(coefficientAndExp.expr)),
    "e^3/(3x) = sin(y)"
  );
  const expAndSin = resolveTreeFactorGroup(screenshotEq, [e2Id, sinId]);
  move(
    "M19 moving e²sin(y) together preserves the unselected 3",
    expAndSin && divideBothT(screenshotEq, expAndSin.expr, printNode(expAndSin.expr)),
    "e^3/(x·sin(y)) = 3",
    "e^2·sin(y) ≠ 0"
  );
  check(
    "M20 mixed numerator/denominator selections are rejected as ambiguous",
    resolveTreeFactorGroup(screenshotEq, [e5Id, xDenId]) === null
  );
  check("M21 only exact factor ids enter a factor group", isAtomicTreeFactorId(e2Id) && !isAtomicTreeFactorId(screenshotRight.wholeNumerator?.id ?? ""));
  check(
    "M21b marquee policy preserves an exact factor chunk instead of its addend",
    treeMarqueeSelection(screenshotEq, [e2Id, sinId], [screenshotEq.right.id]).join(",") === [e2Id, sinId].join(",")
  );
  check(
    "M21c an ambiguous mixed-zone marquee falls back to its owning addend",
    treeMarqueeSelection(screenshotEq, [e5Id, xDenId], []).join(",") === screenshotEq.left.id
  );

  const dividedByThree = divideBothT(screenshotEq, tc(3), "3");
  const dividedTree = dividedByThree && typeof dividedByThree !== "string" ? dividedByThree.treeNext : null;
  check(
    "M22 moving 3 lands it beside x in the displayed denominator",
    !!dividedTree && printTreeEq(dividedTree) === "e^5/(3x) = e^2·sin(y)",
    dividedTree ? printTreeEq(dividedTree) : String(dividedByThree)
  );
  if (dividedTree) {
    const dividedLeft = addendsOf(dividedTree.left)[0];
    const layout = treeFactorLayout(dividedLeft.id, dividedLeft);
    check(
      "M23 the landed 3 and x are independently selectable denominator factors",
      inventory(layout) === "coef:e^5 | den:3 | den:x",
      inventory(layout)
    );
    const denominatorGroup = resolveTreeFactorGroup(dividedTree, layout.denominator.map((unit) => unit.id));
    move(
      "M24 moving a selected denominator chunk multiplies by its exact product",
      denominatorGroup && multiplyBothT(dividedTree, denominatorGroup.expr, printNode(denominatorGroup.expr)),
      "e^5 = 3e^2·x·sin(y)"
    );
  } else {
    check("M23 the landed 3 and x are independently selectable denominator factors", false, "no tree result");
    check("M24 moving a selected denominator chunk multiplies by its exact product", false, "no tree result");
  }
}

console.log("\n== N. symbolic constants: pi ==");
{
  const piEq = parsedTree("x*pi = y");
  check("N1 typed pi enters tree mode and prints as π", printTreeEq(piEq) === "π·x = y", printTreeEq(piEq));
  check("N1b a typed π glyph is accepted too", printTreeEq(parsedTree("π*x = y")) === "π·x = y");
  check("N2 π evaluates exactly as the runtime constant", Math.abs(evalNode(tnamed("pi"), {}) - Math.PI) < 1e-12);
  const piLeft = addendsOf(piEq.left)[0];
  const layout = treeFactorLayout(piLeft.id, piLeft);
  check(
    "N3 π is an independently movable symbolic coefficient",
    layout.numerator[0]?.role === "coef" && printNode(layout.numerator[0].expr) === "π",
    layout.numerator.map((unit) => `${unit.role}:${printNode(unit.expr)}`).join(" | ")
  );
  move("N4 moving π divides both sides without a domain pill", divideBothT(piEq, tnamed("pi"), "π"), "x = y/π");
  simp("N5 π/π cancels because π is provably nonzero", tmul(tnamed("pi"), tpow(tnamed("pi"), -1)), "1");
}

console.log("\n== O. contextual special-symbol actions ==");
{
  const sqrtAlias = parsedTree("sqrt(x + 1) = 3");
  check(
    "O1 sqrt input normalizes to the canonical reciprocal power",
    sqrtAlias.left.kind === "pow" &&
      sqrtAlias.left.exp.kind === "const" &&
      sqrtAlias.left.exp.num === 1 &&
      sqrtAlias.left.exp.den === 2 &&
      printTreeEq(sqrtAlias) === "√(x + 1) = 3",
    printTreeEq(sqrtAlias)
  );
  check(
    "O2 general reciprocal powers print as indexed radicals",
    printTreeEq(parsedTree("(x + 1)^(1/3) = y")) === "³√(x + 1) = y"
  );

  const expEq = parsedTree("e^x = 5");
  move(
    "O3 tapping e applies ln to both sides",
    applySpecialActionT(expEq, { kind: "ln", nodeId: expEq.left.id, side: "left" }),
    "x = ln(5)"
  );

  const cubeExp = parsedTree("e^3 = y");
  move(
    "O4 tapping exponent 3 takes the cube root",
    applySpecialActionT(cubeExp, { kind: "root", n: 3, nodeId: cubeExp.left.id, side: "left" }),
    "e = ³√(y)"
  );

  const cubeRoot = parsedTree("(x + 1)^(1/3) = y");
  move(
    "O5 tapping an indexed radical raises both sides",
    applySpecialActionT(cubeRoot, { kind: "raise", n: 3, nodeId: cubeRoot.left.id, side: "left" }),
    "x + 1 = y³"
  );

  const sinEq = parsedTree("sin(x) = 1/2");
  move(
    "O6 tapping sin applies the principal arcsin operation",
    applySpecialActionT(sinEq, { kind: "asin", nodeId: sinEq.left.id, side: "left" }),
    "x = arcsin(1/2)",
    "check branches"
  );
  const nestedSin = parsedTree("3*sin(x) = y");
  const nestedSinAction = applySpecialActionT(nestedSin, {
    kind: "asin",
    nodeId: nestedSin.left.id,
    side: "left",
  });
  check(
    "O6b inverse trig asks the student to isolate a multiplied function first",
    typeof nestedSinAction === "string" && nestedSinAction.includes("isolate sin"),
    String(nestedSinAction)
  );
  const outOfRange = parsedTree("sin(x) = 2");
  const outOfRangeAction = applySpecialActionT(outOfRange, {
    kind: "asin",
    nodeId: outOfRange.left.id,
    side: "left",
  });
  check(
    "O6c arcsin rejects a known out-of-range side",
    typeof outOfRangeAction === "string" && outOfRangeAction.includes("between −1 and 1"),
    String(outOfRangeAction)
  );

  const lnEq = parsedTree("ln(x) = 2");
  move(
    "O7 tapping ln exponentiates both sides",
    applySpecialActionT(lnEq, { kind: "exp", nodeId: lnEq.left.id, side: "left" }),
    "x = e^2"
  );
  check(
    "O8 inverse trig names parse and print",
    printTreeEq(parsedTree("arccos(x) = arctan(y)")) === "arccos(x) = arctan(y)"
  );
  check(
    "O9 each special anchor advertises one concise operation",
    specialActionLabel({ kind: "root", n: 5, nodeId: cubeExp.left.id, side: "left" }) ===
      "Take the 5th root of both sides"
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
