/**
 * Tests for the rewrite-suggestion engine (src/tools/equation-builder/rewrites.ts).
 * Product UI currently exposes the factoring subset; this suite verifies the
 * complete pure rewrite engine independently of presentation.
 *
 * Run: npx tsx scripts/test-rewrites.ts
 */
import { tc, tv, tadd, tmul, tpow, tfn, simplify, printNode, evalNode, type TNode } from "../src/tools/equation-builder/tree";
import { detectRewrites, detectFactorizationsEq, applyRewrite, verifyRewrite, describeRewrite, type Rewrite } from "../src/tools/equation-builder/rewrites";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail?: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? `  [${detail}]` : ""}`);
  cond ? pass++ : fail++;
};

// find a candidate whose `after`, simplified, prints as `want`
const findAfter = (rs: Rewrite[], want: string) => rs.find((r) => printNode(simplify(r.after)) === want);
const kinds = (rs: Rewrite[]) => rs.map((r) => `${r.kind}:${printNode(simplify(r.after))}`);

console.log("== detection: expansion ==");
{
  const n = tmul(tc(2), tadd(tv("x"), tc(3))); // 2(x+3)
  const rs = detectRewrites(n);
  check("2(x+3) offers distribute → 2x + 6", !!findAfter(rs, "2x + 6"), kinds(rs).join(" | "));
}
{
  const n = tpow(tadd(tv("x"), tc(1)), 2); // (x+1)^2
  const rs = detectRewrites(n);
  check("(x+1)² offers expand → x² + 2x + 1", !!findAfter(rs, "x² + 2x + 1"), kinds(rs).join(" | "));
}
{
  const n = tmul(tadd(tv("x"), tc(1)), tadd(tv("x"), tc(2))); // (x+1)(x+2)
  const rs = detectRewrites(n);
  check("(x+1)(x+2) FOILs → x² + 3x + 2", !!findAfter(rs, "x² + 3x + 2"), kinds(rs).join(" | "));
}

console.log("\n== detection: factoring ==");
{
  const n = tadd(tmul(tc(2), tv("x")), tc(6)); // 2x + 6
  const rs = detectRewrites(n);
  check("2x + 6 offers factor → 2(x + 1)... (2·(x+3))", rs.some((r) => r.kind === "factor"), kinds(rs).join(" | "));
  const f = rs.find((r) => r.kind === "factor")!;
  check("  factored form is value-equal to 2x + 6", verifyRewrite(f) === "ok");
}
{
  const n = tadd(tpow(tv("x"), 2), tmul(tc(3), tv("x")), tc(2)); // x² + 3x + 2
  const rs = detectRewrites(n);
  const q = rs.find((r) => r.kind === "factor" && printNode(simplify(r.after)).includes("("));
  check("x² + 3x + 2 offers quadratic factor", !!q, kinds(rs).join(" | "));
  if (q) check("  quadratic factoring is value-equal", verifyRewrite(q) === "ok");
}
{
  const n = tadd(tpow(tv("x"), 2), tmul(tc(3), tv("x")), tc(4)); // x² + 3x + 4 (irrational roots)
  const rs = detectRewrites(n);
  check("x² + 3x + 4 offers NO quadratic factor (irrational roots)", !rs.some((r) => r.label.includes("quadratic")));
}
{
  const n = tadd(tmul(tc(6), tpow(tv("x"), 2)), tmul(tc(9), tv("x"))); // 6x² + 9x
  const rs = detectRewrites(n);
  const f = rs.find((r) => r.kind === "factor");
  check("6x² + 9x factors out 3x", !!f && verifyRewrite(f) === "ok", f ? describeRewrite(f) : "none");
}

console.log("\n== detection: identity rewrites (with pills) ==");
{
  const n = tfn("ln", tmul(tv("x"), tv("y"))); // ln(x·y)
  const rs = detectRewrites(n);
  const r = rs.find((x) => x.kind === "identity");
  check("ln(x·y) offers ln x + ln y", !!r, kinds(rs).join(" | "));
  check("  carries the x, y > 0 pill", r?.pill === "x, y > 0", r?.pill);
  check("  value-equal on the shared domain", !!r && verifyRewrite(r) === "ok");
}
{
  const n = tfn("ln", tpow(tv("x"), 2)); // ln(x²)
  const rs = detectRewrites(n);
  const r = rs.find((x) => x.kind === "identity");
  check("ln(x²) offers 2·ln x", !!r && printNode(simplify(r.after)) === "2ln(x)", r ? describeRewrite(r) : "none");
  check("  carries the x > 0 pill", r?.pill === "x > 0", r?.pill);
}
{
  const n = tfn("sin", tmul(tc(-1), tv("x"))); // sin(−x)
  const rs = detectRewrites(n);
  const r = rs.find((x) => x.kind === "identity");
  check("sin(−x) offers −sin x", !!r && printNode(simplify(r.after)) === "−sin(x)", r ? describeRewrite(r) : "none");
  check("  odd-function rewrite has no pill", r?.pill === undefined);
  check("  value-equal", !!r && verifyRewrite(r) === "ok");
}
{
  const n = tfn("cos", tmul(tc(-1), tv("x"))); // cos(−x)
  const rs = detectRewrites(n);
  const r = rs.find((x) => x.kind === "identity");
  check("cos(−x) offers cos x (even)", !!r && printNode(simplify(r.after)) === "cos(x)", r ? describeRewrite(r) : "none");
}

console.log("\n== focused product surface ==");
{
  const te = {
    left: tmul(tc(2), tadd(tv("x"), tc(3))),
    right: tadd(tpow(tv("x"), 2), tmul(tc(3), tv("x")), tc(2)),
  };
  const candidates = detectFactorizationsEq(te);
  check(
    "factorization detection excludes expansion and identity suggestions",
    candidates.length > 0 && candidates.every(({ side, rewrite }) => side === "right" && rewrite.kind === "factor"),
    candidates.map(({ side, rewrite }) => `${side}:${rewrite.kind}:${rewrite.label}`).join(" | ")
  );
}

console.log("\n== application: apply and land the rewrite ==");
{
  const n = tmul(tc(2), tadd(tv("x"), tc(3))); // 2(x+3)
  const rs = detectRewrites(n);
  const r = findAfter(rs, "2x + 6")!;
  const applied = simplify(applyRewrite(n, r));
  check("applying distribute yields 2x + 6", printNode(applied) === "2x + 6", printNode(applied));
}
{
  // a nested target: 3 + ln(x·y) — the rewrite must apply INSIDE, not clobber
  const n = tadd(tc(3), tfn("ln", tmul(tv("x"), tv("y"))));
  const rs = detectRewrites(n);
  const r = rs.find((x) => x.kind === "identity")!;
  const applied = simplify(applyRewrite(n, r));
  check("nested identity applies in place: 3 + ln x + ln y", printNode(applied).includes("ln(x)") && printNode(applied).includes("+ 3"), printNode(applied));
}
{
  // Two identical-looking subtrees still have different semantic identities.
  // Choosing the second highlight must never rewrite the first occurrence.
  const first = tmul(tc(2), tadd(tv("x"), tc(3)));
  const second = tmul(tc(2), tadd(tv("x"), tc(3)));
  const n = tadd(first, second);
  const rs = detectRewrites(n).filter((r) => r.label === "distribute");
  const target = rs.find((r) => r.before.id === second.id);
  check(
    "identical subtrees receive distinct rewrite candidates by semantic id",
    rs.some((r) => r.before.id === first.id) && !!target,
    rs.map((r) => r.before.id).join(" | ")
  );
  const applied = target ? applyRewrite(n, target) : n;
  check(
    "choosing the second identical subtree rewrites only that occurrence",
    applied.kind === "add" && applied.terms[0].kind === "mul" && applied.terms[1].kind === "add",
    printNode(applied)
  );
}

console.log("\n== the honesty guard: every detected candidate is value-preserving ==");
{
  const samples: TNode[] = [
    tmul(tc(2), tadd(tv("x"), tc(3))),
    tpow(tadd(tv("x"), tc(1)), 2),
    tmul(tadd(tv("x"), tc(1)), tadd(tv("x"), tc(2))),
    tadd(tmul(tc(6), tpow(tv("x"), 2)), tmul(tc(9), tv("x"))),
    tadd(tpow(tv("x"), 2), tmul(tc(3), tv("x")), tc(2)),
    tfn("ln", tmul(tv("x"), tv("y"))),
    tfn("ln", tpow(tv("x"), 3)),
    tfn("sin", tmul(tc(-1), tv("x"))),
    tfn("tan", tmul(tc(-1), tv("y"))),
    tadd(tmul(tc(4), tv("x")), tmul(tc(8), tv("y")), tc(12)),
  ];
  let all = 0, bad = 0;
  for (const s of samples) {
    for (const r of detectRewrites(s)) {
      all++;
      if (verifyRewrite(r) === "violated") { bad++; console.log(`  NOT value-preserving: ${describeRewrite(r)}`); }
    }
  }
  check(`all ${all} detected candidates are value-preserving`, bad === 0, `${bad} bad`);
}

console.log("\n== no false positives: a bare/atomic expression offers nothing ==");
{
  check("x offers no rewrites", detectRewrites(tv("x")).length === 0);
  check("2x offers no rewrites", detectRewrites(tmul(tc(2), tv("x"))).length === 0);
  check("x + 3 (coprime, no common factor) offers no factor", !detectRewrites(tadd(tv("x"), tc(3))).some((r) => r.kind === "factor"));
}

console.log("\n== adversarial: every candidate over random trees is value-preserving ==");
{
  let seed = 0x51ed;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const gen = (d: number): TNode => {
    if (d <= 0 || rnd() < 0.3) return rnd() < 0.5 ? tv(rnd() < 0.5 ? "x" : "y") : tc(ri(-4, 5));
    const r = rnd();
    if (r < 0.25) return tadd(gen(d - 1), gen(d - 1));
    if (r < 0.5) return tmul(gen(d - 1), gen(d - 1));
    if (r < 0.7) return tpow(gen(d - 1), tc(ri(-2, 3)));
    return tfn((["ln", "sin", "cos", "tan"] as const)[ri(0, 3)], gen(d - 1));
  };
  let all = 0, bad = 0, appliedBad = 0;
  for (let i = 0; i < 5000; i++) {
    const n = gen(ri(2, 4));
    let rs: Rewrite[];
    try { rs = detectRewrites(n); } catch (e) { console.log(`  detect THREW on ${printNode(n)}: ${e}`); bad++; continue; }
    for (const r of rs) {
      all++;
      if (verifyRewrite(r) === "violated") {
        if (bad < 8) console.log(`  candidate NOT value-preserving: ${describeRewrite(r)}`);
        bad++;
        continue;
      }
      // applying it must keep the WHOLE expression value-equal
      const before = n, after = applyRewrite(n, r);
      const pts: [number, number][] = [[1.7, 2.3], [0.9, 3.1], [3.2, 1.4], [2.1, 0.7]];
      for (const [x, y] of pts) {
        const a = evalNodeSafe(before, x, y), b = evalNodeSafe(after, x, y);
        if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a))) {
          if (appliedBad < 8) console.log(`  APPLY changed value: ${printNode(before)} --${r.label}--> ${printNode(after)}`);
          appliedBad++;
          break;
        }
      }
    }
  }
  check(`${all} candidates over 5000 random trees, all value-preserving`, bad === 0);
  check(`applying any candidate never changed the expression's value`, appliedBad === 0);
}

function evalNodeSafe(n: TNode, x: number, y: number): number {
  try { return evalNode(n, { x, y }); } catch { return NaN; }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
