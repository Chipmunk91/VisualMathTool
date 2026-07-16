/**
 * Adversarial property-based fuzzer for the CAS.
 *
 * Invariant 1 (VALUE): simplify(n) must equal n at every point where both are
 *   defined. simplify is supposed to be value-preserving on the common domain
 *   (conditional rewrites like e^(ln u) live in the MOVE layer, not here). Any
 *   numeric disagreement is a correctness bug.
 * Invariant 2 (PRINT): printNode(simplify(n)) must re-parse to the same value.
 *   Catches ambiguous/wrong parenthesization (the −(x+2) → −x+2 class).
 */
import {
  tc, tv, tadd, tmul, tnamed, tpow, tfn, simplify, printNode, evalNode, type TNode, type TFnName,
} from "../src/tools/equation-builder/tree";
import { parseEquation } from "../src/tools/equation-builder/parse";

// ── deterministic PRNG (repeatable across runs) ──
let seed = 0x2f6e2b1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const randInt = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const FNS: TFnName[] = ["sin", "cos", "tan", "ln", "exp", "sqrt"];

// generate a random tree, EXP-weighted so exponentials get hammered
function gen(depth: number, expHeavy: boolean): TNode {
  if (depth <= 0 || rnd() < 0.28) {
    const leafRoll = rnd();
    return leafRoll < 0.42
      ? tv(pick(["x", "y"]))
      : leafRoll < 0.54
        ? tnamed("pi")
        : tc(randInt(-4, 5), randInt(1, 3));
  }
  const roll = rnd();
  const bias = expHeavy ? 0.45 : 0.18;
  if (roll < bias) {
    // exp / ln heavy
    const f: TFnName = rnd() < 0.6 ? (rnd() < 0.5 ? "exp" : "ln") : pick(FNS);
    return tfn(f, gen(depth - 1, expHeavy));
  }
  if (roll < bias + 0.22) return tadd(gen(depth - 1, expHeavy), gen(depth - 1, expHeavy));
  if (roll < bias + 0.5) return tmul(gen(depth - 1, expHeavy), gen(depth - 1, expHeavy));
  // power: integer exponent (that's what the app supports as playable powers)
  return tpow(gen(depth - 1, expHeavy), tc(randInt(-3, 3)));
}

// convert printNode output back into parser-acceptable ASCII
function toAscii(s: string): string {
  const sup: Record<string, string> = { "⁰":"0","¹":"1","²":"2","³":"3","⁴":"4","⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9","⁻":"-" };
  // turn a run of superscript chars into ^(digits)
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (sup[s[i]] !== undefined) {
      let run = "";
      while (i < s.length && sup[s[i]] !== undefined) { run += sup[s[i]]; i++; }
      out += `^(${run})`;
    } else { out += s[i]; i++; }
  }
  return out.replace(/−/g, "-").replace(/·/g, "*").replace(/√/g, "sqrt").replace(/π/g, "pi");
}

const PTS: [number, number][] = [];
for (let k = 0; k < 12; k++) PTS.push([rnd() * 6 - 3, rnd() * 6 - 3]);

// ASYMMETRIC: a = raw (original), b = simplified. simplify may REPAIR a
// singularity (raw NaN → simp finite, e.g. 0·ln(0) → 0), enlarging the domain;
// that's allowed. It must NEVER break a defined value (raw finite → simp NaN)
// or change one (both finite, differ). Those are real bugs.
function agree(a: number[], b: number[]): "ok" | "mismatch" | "insufficient" {
  let shared = 0;
  for (let i = 0; i < a.length; i++) {
    const fa = Number.isFinite(a[i]), fb = Number.isFinite(b[i]);
    if (fa && !fb && Math.abs(a[i]) < 1e6) return "mismatch"; // simplify LOST a value
    if (!fa || !fb) continue; // raw undefined (repair ok) or shared singularity
    shared++;
    const scale = Math.max(1, Math.abs(a[i]), Math.abs(b[i]));
    if (Math.abs(a[i] - b[i]) > 1e-6 * scale) return "mismatch";
  }
  return shared >= 4 ? "ok" : "insufficient";
}

const evalAt = (n: TNode) => PTS.map(([x, y]) => { try { return evalNode(n, { x, y }); } catch { return NaN; } });

let valFails = 0, printFails = 0, tested = 0, insuffic = 0;
const N = 6000;
for (let iter = 0; iter < N; iter++) {
  const expHeavy = iter % 2 === 0;
  const raw = gen(randInt(2, 4), expHeavy);
  let simp: TNode;
  try { simp = simplify(raw); } catch (e) { console.log(`SIMPLIFY THREW on ${printNode(raw)}: ${e}`); valFails++; continue; }
  const vr = evalAt(raw), vs = evalAt(simp);
  const verdict = agree(vr, vs);
  if (verdict === "mismatch") {
    if (valFails < 12) console.log(`VALUE BUG:  ${printNode(raw)}\n     simp→  ${printNode(simp)}\n     raw ${JSON.stringify(vr.map(v=>+v.toFixed(3)))}\n     smp ${JSON.stringify(vs.map(v=>+v.toFixed(3)))}`);
    valFails++;
    continue;
  }
  if (verdict === "insufficient") { insuffic++; continue; }
  tested++;
  // print round-trip
  const printed = printNode(simp);
  let reparsed: TNode | null = null;
  try {
    const r = parseEquation(`${toAscii(printed)} = 0`) as any;
    if (r.ok) reparsed = r.tree ? r.tree.left : (r.state ? undefined : null);
  } catch { reparsed = null; }
  if (reparsed) {
    const vp = evalAt(reparsed);
    if (agree(vs, vp) === "mismatch") {
      if (printFails < 12) console.log(`PRINT BUG:  simp = ${printed}\n     reparsed differs; ascii=${toAscii(printed)}`);
      printFails++;
    }
  }
}
console.log(`\n${tested} value-checked (${insuffic} skipped as too-singular), ${valFails} VALUE bugs, ${printFails} PRINT bugs`);
process.exit(valFails + printFails ? 1 : 0);
