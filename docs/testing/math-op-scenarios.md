# Mathematical-Operation Scenarios — the complete sanity matrix

Sanity check **part 1: mathematical operations**. Every operation the
playground can perform, with its expected result — including the honest
refusals, which are behavior to TEST, not bugs. Part 2 (animation/history)
is a separate pass.

**How to run:**

- Pure layer (no browser): `npx tsx scripts/test-mathops.ts` — sections A–M below.
- Rendered hitbox contract: `npx tsx scripts/test-symbol-handles.ts`.
- Gesture layer (Playwright vs `vite preview`): the scratchpad suites named
  in the Status column exercise the same operations through real drags.

Legend: ✅ = asserted in `scripts/test-mathops.ts` · 🖱 = asserted in a
browser suite · 📐 = honest refusal by design · ❌ = known gap (candidate work)

## A. Additive moves (terms crossing `=`)

| # | Setup | Operation | Expected | Status |
|---|---|---|---|---|
| A1 | `2x − 3 = −7` | drag `−3` across | `2x = −4` — mover flips sign, merges into resident | ✅ A1–A2, 🖱 shot-v2 |
| A2 | `x + 3 = 7` (tree) | move `+3` across | `x = 4` | ✅ E1 |
| A3 | `x + 3 = 7` (tree) | move the `x` across | `3 = −x + 7` — survives unmerged, sign flipped | ✅ E2 |
| A4 | any | drop back on the source side | move cancels (null) | ✅ E3 |
| A5 | `2x = −4` | drag `2x` away | `0 = …` — emptied side shows the lone 0 | ✅ A7, 🖱 test-hitunits (bar move) |
| A6 | marquee selection | selected block moves as one | all selected terms cross together | 🖱 test-pointer |

## B. Multiplicative moves (scaling both sides)

| # | Setup | Operation | Expected | Status |
|---|---|---|---|---|
| B1 | `2x = −4` | drag coefficient `2` across | `x = −2` — exact division, every term | ✅ F6, 🖱 shot-divform |
| B2 | `2x = −7` | same | `x = −7/2` — exact rationals, never decimals | ✅ A4 |
| B3 | `x/2 = 4` | drag denominator `2` across | `x = 8` — denominator multiplies | 🖱 test-pointer |
| B4 | `−x = 3` | drag the leading `−` | `x = −3` — negate both sides | 🖱 test-tools |
| B5 | `x·y = 6` (tree) | divide by `x` | `y = 6/x` **with pill `x ≠ 0`** — dangerous, solutions may hide | ✅ F3 |
| B6 | `1/x = 2` | drag the denominator `x` | `1 = 2x` | 🖱 test-tools |
| B7 | tree fraction | divide by one factor (`e³`) exactly | only that factor divides — not all constants lumped | ✅ F2, 🖱 test-hitunits |
| B8 | tree fraction | drag the `·` (numerator product) | divide by the whole product | 🖱 test-hitunits |
| B9 | tree fraction | drag denominator `sin(x)` beside the other side | `e³·x = y·sin(x)` — multiply both sides | ✅ F1, 🖱 test-hitunits |
| B10 | any | divide by 0 | 📐 refused: "can't divide by zero" | ✅ F4 |
| B11 | any | divide by 1 | non-move (nothing happens) | ✅ F5 |
| B12 | `x = ±√2` (terminal) | scale attempt | 📐 refused: frozen values can't be scaled | 🖱 test-max |
| B13 | `e^3*x = sin(y)*e^5/sqrt(3)` | drag only `sin(y)` or only `e^5` | exactly that factor divides both sides; the other numerator factor stays | ✅ M1–M8, ✅ S1–S4 |
| B14 | `−2sin(x) = y` (tree) | drag the visible `2` | divide by **+2**, not the separately rendered leading sign | ✅ M9–M10, ✅ S5 |
| B15 | reciprocal-only product | inspect/grab the literal numerator `1` | no phantom numerator-product handle; denominator factors remain independent | ✅ M11, ✅ S6 |

## C. Groups (parentheses)

| # | Setup | Operation | Expected | Status |
|---|---|---|---|---|
| C1 | `2(x + 3) = 8` | drop the `2` onto the parens | `2x + 6 = 8` — distributes | 🖱 test-pointer |
| C2 | `2(x + 3) = 8` | drag the `2` across | `x + 3 = 4` — factor divides both sides | 🖱 test-pointer |
| C3 | two same-side terms | drop coefficient on sibling | common factor pulled out (group forms) | 🖱 test-pointer |
| C4 | factor becomes 1 | — | group unwraps, inner terms released with their identity | ✅ A9 |
| C5 | `2(x+3) = 10` | drag the parens `( )` across | `2 = 10/(x+3)` **with pill `x + 3 ≠ 0`** — escapes to the tree engine (the result isn't flat-representable) | ✅ F-family, 🖱 test-cancel |
| C6 | `(x+2)/(x+2) = y` | typed input | `1 = y` **with pill `x + 2 ≠ 0`** — sympy-style load normalization cancels the pair, but stamps the assumption (the receipt), never assumes it silently | ✅ J1, 🖱 test-cancel |
| C7 | mid-derivation `(x+2)/(x+2)` (arises from a move, not typed) | drop the numerator `(x+2)` onto the denominator | `1` **with pill `x + 2 ≠ 0`** — the cancel GESTURE, for fractions the load pass didn't see | ✅ I2–I4 |
| C8 | `x/x = 1` | typed input | `1 = 1` (**Always true**) **with pill `x ≠ 0`** — same load normalization; the receipt keeps it honest | 🖱 test-tree |

## D. Powers and roots

| # | Setup | Operation | Expected | Status |
|---|---|---|---|---|
| D1 | `x³ = 8` (flat) | drag the exponent across | `x = 2` — odd root, unconditional | 🖱 test-max |
| D2 | `x² = 9` | √ tool | `x = ±3` — **both** branches kept, ± chooser | 🖱 test-tools |
| D3 | `(x+1)³ = 8` (tree) | drag the `3` across | `x + 1 = 2` | ✅ G1, 🖱 test-hitunits |
| D4 | `(x+1)² = 9` (tree) | drag the `2` across | `x + 1 = 3` **with pill `principal root`** — a negative branch may be lost | ✅ G2, 🖱 test-hitunits |
| D5 | rooted state | drag the `1/3` exponent across | raised to the 3rd power — exact inverse, round-trips | ✅ G3, G7, 🖱 test-preview2 |
| D6 | `√u = 3`-shape | drag the `1/2` across | `u = 9` **with pill `check roots`** — even powers add solutions | ✅ G4, H4 |
| D7 | any | root/raise with n < 2 or non-integer | non-move | ✅ G5 |
| D8 | `e³·x/sin(x) = y` | cube root | `e·x^(1/3)/sin(x)^(1/3) = y^(1/3)` — the exponential folds OUT | ✅ G6, 🖱 test-nested |
| D9 | `(xy)^(1/2)` | simplifier | 📐 stays wrapped — even roots refuse signed factors | ✅ D4 |
| D10 | `(x²)^(1/2)` | simplifier | 📐 stays wrapped — never silently `x` (that's `|x|`) | ✅ D7 |

## E. Exponentials and logarithms

| # | Setup | Operation | Expected | Status |
|---|---|---|---|---|
| E1 | `e³/e²` | simplifier | `e` — exponentials merge by ADDING arguments | ✅ C1 |
| E2 | `e²·e³` | simplifier | `e⁵` | ✅ C2 |
| E3 | `e²/e²` | simplifier | `1` | ✅ C3 |
| E4 | `(e^x)²` | simplifier | `e^(2x)` | ✅ C4 |
| E5 | `e^x = 5` | ln (tool or drag the `e`) | `x = ln(5)` — thaws exactly | ✅ H1, 🖱 test-hitunits |
| E6 | `ln(x) = 2` | exp tool | `x = e²` | ✅ H3, 🖱 test-pointer |
| E7 | `ln(2e^x)` | ln expansion | `ln(2) + x` — products thaw termwise | 🖱 test-tools |
| E8 | `x = −5` | ln attempt | 📐 refused: ln is only defined for positive numbers | ✅ H2 |
| E9 | `2^x = 8` | ln thaws the foreign base | `ln(2)·x = ln(8)` → divide → solved ≈ 3 | 🖱 test-tree |
| E10 | `x³/x²` | simplifier without assumptions | 📐 stays — cancelling would erase the x=0 domain gap | ✅ B5 |
| E11 | same, after a move declaring `x ≠ 0` | simplifier with the pill's license | `x` — cancels under the declared assumption | ✅ B6 |
| E12 | `e^(ln(x) + 5/2) = e^(y/4)` | typed input | `e^(5/2)·x = e^(y/4)` **with pill `x > 0`** — e^(ln u) thaws at load, receipt attached | ✅ J2, 🖱 test-norm |
| E13 | `ln(x) + 5/2 = y/4` | exp tool (a MOVE) | `e^(5/2)·x = e^(y/4)` **with pill `x > 0`** — the thaw fires on every commit, flat tool or tree move | ✅ J4, 🖱 test-norm |
| E14 | `e^(ln u)` (bare, anywhere) | any commit | `u` — never survives; the assumption `u > 0` is always reported | ✅ J5 |

## F. Trig functions and inverses

| # | Setup | Operation | Expected | Status |
|---|---|---|---|---|
| F1 | `x² = 9` → … | sin/cos/tan tools wrap both sides | `sin(u) = sin(v)` etc. | 🖱 test-max |
| F2 | `sin(u) = sin(v)` | drag one `sin` onto the other | `u = v` **with pill `principal value`** — periodic families dropped, note says which | 🖱 test-shareplay (ln/exp analogue) |
| F3 | `tan(x) = 1` | drag `tan` across | `x = arctan(1)` — terminal VALUE, pill `principal value` | 🖱 (manual; candidate for suite) |
| F4 | `sin(x) = 2` | inverse attempt | 📐 refused: sin never leaves [−1, 1] | asserted in gate |
| F5 | `sin(x) = 0` | inverse | `x = 0` exact (not a frozen arcsin) | asserted in gate |
| F6 | `sin(x) + 3 = 9` | inverse attempt | 📐 refused: function must be alone — move the 3 first | 🖱 test-max |
| F7 | `2sin(x) = 1` | inverse attempt | 📐 refused: divide the coefficient away first | asserted in gate |
| F8 | `tan(x) = y` | arctan attempt | ❌ **grammar gap**: refused with "gather a single plain number…" — `arctan(y)` (of an EXPRESSION) has no node in the live grammar (`FuncName` has no arc-functions; `arctan` exists only as a frozen numeric value). Legal math we cannot yet represent. Candidate: add arc-fns to the tree grammar. | — |

## G. Calculus (function mode)

| # | Setup | Operation | Expected | Status |
|---|---|---|---|---|
| G1 | `y = x³` | d/dx | new equation `y = 3x²`, trail restarts (a building move) | 🖱 test-calculus2-adjacent |
| G2 | not an identity | d/dx | 📐 refused: needs `y = f(x)` | 🖱 gate check |
| G3 | `y = f(x)` | ∫ | one antiderivative, **`+ C` pill** rides along | 🖱 test-polish |
| G4 | `y = e^(−x²)` | ∫ | 📐 refused: provably no elementary antiderivative | 🖱 test-polish |
| G5 | `y = x^x` | d/dx | 📐 refused: rule beyond the playground | gate check |
| G6 | area view, ±∞ bounds | improper integral | converges to a number, or honest "diverges" | 🖱 test-polish |
| G7 | Σ view, ∞ bound | series | converges ≈ S / diverges / undefined-at-k | 🖱 test-calculus2 |
| G8 | limit view | two-sided probe | limit / hole / left≠right / blow-up / never settles | 🖱 test-calculus2 |

## K. Display correctness & verdict detection (from the algebra audit)

| # | Setup | Expected | Status |
|---|---|---|---|
| K1 | `−(x+2)` in any label / preview / share text | prints `−(x + 2)` — a negated SUM keeps its parens (was `−x + 2`, a different expression) | ✅ K1–K3 |
| K2 | `5 − (x + 2)` | `−(x + 2) + 5`, inner sign intact | ✅ K3 |
| K3 | `x = x` | **Always true** — identity caught while the variable is still present | 🖱 test-status |
| K4 | `x + 1 = x` | **No solution** — contradiction caught the same way | 🖱 test-status |
| K5 | `2(x+1) = 2x + 2` | **Always true** — verdict sees through factored forms (sampled difference, not symbolic) | 🖱 test-status |
| K6 | `2x + 1 = 2x + 5` | **No solution** | 🖱 test-status |
| K7 | `2x = 3x` | 📐 no verdict — it's conditional (x = 0), the difference varies; needs a move | 🖱 test-status |
| K8 | `2x − 3 = −7` | 📐 no premature verdict on a normal solvable equation | 🖱 test-status |

## H. System invariants (cross-cutting)

| # | Invariant | Status |
|---|---|---|
| H1 | Every surviving term keeps its id through every operation (animation contract) | ✅ A2–A3, A8–A10 |
| H2 | No duplicate ids ever appear on a side | ✅ (id-audit) |
| H3 | Rewind restores each step exactly (states are snapshots, never recomputed) | 🖱 test-tools, test-tree |
| H4 | Share links round-trip the full history + transition scripts | 🖱 test-shareplay |
| H5 | Every dangerous operation carries its pill (`x ≠ 0`, `principal root`, `check roots`, `principal value`, `+ C`) | ✅ F3, G2, G4, H4 |
| H6 | Tree states that simplify into flat shapes escape to the flat engine | ✅ (E1/G1 return flat) |
| H7 | Solved/contradiction/identity detection fires on the final state | 🖱 test-tree, test-tools |

## Known gaps (candidate work, in priority order)

Found by an adversarial probe of ~30 edge cases (`scratchpad/probe.ts`).
Split into *correctness* (fixed), *deliberate* (correct as-is), and
*feature gaps* (unsupported, honest about it).

**Fixed in the audit:**
- Product factors used separate renderer/drop partition logic, so nested
  exponential handles could steal `e^5`, a visible `2` in `−2sin(x)` resolved
  as `−2`, and denominator-only products minted a phantom numerator handle.
  One shared factor contract now drives both layers, with a rendered-markup
  regression suite in CI.
- `−(x+2)` printed as `−x + 2` — a genuine display bug in `printNode`, now
  parenthesized. (Value was always correct; only labels/previews/share lied.)
- `x = x` / `x + 1 = x` gave no verdict — detection was syntactic
  (both-sides-constant). Now decided by sampling the difference, so factored
  and variable-present forms are caught. Conditionals (`2x = 3x`) correctly
  stay undecided.

**Deliberate (correct, no change):**
- `2(x+3)`, `(x+1)(x+2)`, `(x+1)²` stay *factored* — distribution is a
  gesture, not an auto-simplify. (The verdict sampler still sees through them.)
- `0^0` stays unevaluated (indeterminate — honest).
- `x³/x²` won't cancel without a declared `x ≠ 0` (the honesty guard).

**Feature gaps (unsupported; would need new machinery):**
1. **F8 — arc-functions of expressions** (`tan(x) = y` → `x = arctan(y)`):
   needs `arcsin|arccos|arctan` in `TFnName` + render + periodicity pill.
2. **Polynomial expansion (FOIL)** — no operation multiplies `(x+1)(x+2)` out;
   only `√`/roots can act on a squared binomial. An "expand" gesture would
   close it.
3. **Log/trig identity rewrites** — `ln(xy)→ln x+ln y`, `ln(x²)→2ln x`,
   `sin(−x)→−sin x`, `cos(−x)→cos x`, Pythagorean. The `ln` TOOL expands
   products (E7) but the simplifier doesn't auto-apply these.
4. **`log` = natural log** — the parser maps `log → ln`. If base-10 is
   expected this surprises; worth a decision (accept convention, or add `log₁₀`).
5. **`x^0 = 1` / `1^x = 1`** — `x^0` folds to 1 without an `x ≠ 0` note
   (`0^0` is the gap); `1^x` isn't folded at all. Both minor.

**Untested-but-correct / housekeeping:**
- F3 (inverse-trig on a plain number) lacks an automated browser assertion.
- Unreduced paper states (`6/2` before `3`) live only in the animation
  overlay, not the CAS — revisit only if part 2 needs CAS-level paper states.
