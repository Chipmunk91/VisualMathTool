# Animation test cases — equations with multi-factored terms

Multi-factor terms are where the animation engine is weakest: tree positional
ids alias across restructures, several glyphs move at once, and the acted-on
unit is a *piece* of a term rather than a whole term. Every equation below was
verified to load (all parse into tree mode except M1). For each case: what to
type, what to grab, where to drop, the expected **math**, and the expected
**animation** — what to watch frame-by-frame.

**How to run one:** load the equation → tick **capture animation** (bottom-left)
→ do the gesture → open history → **replay the derivation** → the trace
downloads on stop. If anything looks wrong, send the JSON.

**Universal animation rules** (from `docs/animation/best-practices.md`) that
apply to every case:
- The grabbed unit **flashes orange** (~70 ms) before anything moves.
- **No alias morphs**: a glyph may swap number→number (5→3) or sign, but a
  letter must never morph into a different word (e→sin was the bug class).
- Deaths **fade out**, births **fade in**; survivors **move** — never
  translucent mid-glide.
- The `=` holds until the reflow; the reflow is one even glide (no lunge).

---

## A. Constant × exponential × variable (3 factors, one term)

Load: `2e^3x = 12` → renders `2e³·x = 12`

| # | Grab | Drop | Expected math | Expected animation |
|---|---|---|---|---|
| A1 | the `2` (coef) | across `=` | `e³·x = 6` | 2 flashes, fades; 12 value-swaps to 6; rest glides left evenly |
| A2 | the `e³` (whole unit) | across `=` | `2x = 12/e³` | e³ flashes, fades; a fraction forms on the right (bar + denominator fade in) |
| A3 | the `x` | under the right side | `2e³ = 12/x` (x ≠ 0 pill) | x flashes; denominator x fades in under 12 |
| A4 | the `3` exponent (root handle) | across `=` | cube-root of both sides | 3 flashes; ∛ radicals fade in on both sides |
| A5 | the `e` (lnbase) | across `=` | ln of both sides | e flashes; ln( ) wraps fade in both sides |

## B. Exponential × function

Load: `e^2 sin(y) = 4` → renders `e²·sin(y) = 4`

| # | Grab | Drop | Expected math | Expected animation |
|---|---|---|---|---|
| B1 | `e²` | across `=` | `sin(y) = 4/e²` | e² flashes+fades; sin(y) glides left INTO the freed space; 4/e² fraction forms |
| B2 | `sin(y)` (numer) | under left side… | `e² = 4/sin(y)` (sin(y) ≠ 0 pill) | sin(y) flashes; watch that e² does NOT morph into anything |

**Watch for (bug class):** when the left side loses a factor, the surviving
factor must not inherit the dead one's glyphs (no `e→s` morphs).

## C. Partial exponent cancellation — the reported bug's home

Load: `e^5/x = 3 e^2 sin(y)` → renders `e⁵/x = 3e²·sin(y)`

| # | Grab | Drop | Expected math | Expected animation |
|---|---|---|---|---|
| C1 | right `e²` | across `=` | `e³/x = 3sin(y)` | **The regression case.** e⁵'s exponent value-swaps 5→3 (one pulse); the right e² fades OUT; sin(y) fades in at its new spot (a glide once stable ids land); NO e→sin or 2→( morphs |
| C2 | left `e⁵` (in the fraction) | across `=` | `1/x = 3sin(y)/e³` | e⁵ flashes; right side gains an e³ denominator |
| C3 | the `3` | across `=` | `e⁵/(3x)… or e⁵/x·⅓ form` | 3 flashes+fades; left denominator gains 3 (or coefficient ⅓ forms) |

## D. Multi-factor numerator AND denominator

Load: `2 e^3 x / (5y) = 1` → renders `(2/5·e³·x)/y = 1`

| # | Grab | Drop | Expected math | Expected animation |
|---|---|---|---|---|
| D1 | denominator `y` | beside right side | `(2/5)e³·x = y` | y flashes; dives OVER the bar to the right side; bar dissolves if denominator empties |
| D2 | whole numerator (grab a gap/·) | under right side | `1/y = 1/((2/5)e³x)`-ish | product flashes as ONE unit |
| D3 | the `x` (numerator) | under the right side | `(2/5)e³/y = 1/x` | only x fades/moves; e³ and 2/5 stay put |
| D4 | the fraction bar | across `=` | whole fraction moves | everything in the fraction travels together |

## E. Two group factors (the FOIL shape)

Load: `(x+2)(x+3) = 6`

| # | Grab | Drop | Expected math | Expected animation |
|---|---|---|---|---|
| E1 | `(x+2)` factor | across `=` | `x+3 = 6/(x+2)` (x+2 ≠ 0 pill) | the WHOLE parenthesis flashes as one unit; (x+3) glides left |
| E2 | `(x+3)` factor | across `=` | `x+2 = 6/(x+3)` (pill) | same, other factor |

**Watch for:** partial-parenthesis highlighting (an old bug class) — the flash
must cover `(x+2)` exactly, not `(x+` or the whole side.

## F. Power of a group

Load: `(x+1)^2 = 9`

| # | Grab | Drop | Expected math | Expected animation |
|---|---|---|---|---|
| F1 | the `²` (root) | across `=` | `x+1 = ±3` | 2 flashes; ± and √ fade in; 9 value-swaps to 3 |

## G. Root factor

Load: `sqrt(5) x = 10` → renders `√(5)·x = 10`

| # | Grab | Drop | Expected math | Expected animation |
|---|---|---|---|---|
| G1 | `√5` (coef) | across `=` | `x = 10/√5` (or rationalized) | √5 flashes+fades; fraction forms right |
| G2 | `x` | under right | `√5 = 10/x` (x ≠ 0) | only x moves |

## H. Two functions × constant

Load: `2 sin(y) cos(y) = 1` → renders `2sin(y)·cos(y) = 1`

| # | Grab | Drop | Expected math | Expected animation |
|---|---|---|---|---|
| H1 | `2` | across `=` | `sin(y)cos(y) = 1/2` | 2 flashes+fades; the two functions glide left together, NEITHER morphs |
| H2 | `sin(y)` | under right | `2cos(y) = 1/sin(y)` (pill) | sin(y) fades to denominator; cos(y) must keep its own glyphs |

**Aliasing stress:** two same-shaped function factors — after one leaves, the
other slides into its slot. Prime territory for `c→s` letter morphs.

## I. Identical factors on both sides

| # | Load | Grab | Expected math | Expected animation |
|---|---|---|---|---|
| I1 | `e^3 x = e^2` | left `e³` | `x = 1/e` (e² ⁄ e³ = e⁻¹) | exponent arithmetic shows as value swaps, not letter morphs |
| I2 | `e^2 x = e^2 + 1` | left `e²` | `x = (e²+1)/e²` | right side becomes a fraction; the SUM must not eat the e² glyphs |
| I3 | `3x = 3` (flat) | the coef `3` | `x = 1` | two identical 3s: the correct one (coefficient) must act — content-matching stress |

## M. Negative leading sign

Load: `-3e^2 x = 6` → renders `−3e²·x = 6`

| # | Grab | Drop | Expected math | Expected animation |
|---|---|---|---|---|
| M1 | the `3` | across `=` | `−e²x = 2` | sign stays put; only the 3 fades; 6 swaps to 2 |
| M2 | the leading `−` | across `=` | `3e²x = −6` (negate both) | signs flip in place (sign↔sign swaps are legal morphs) |

---

## What "pass" means, mechanically

From a captured trace (`anim-trace-*.json`), a case passes when:

1. **Emphasis**: the grabbed unit's clones flash orange within `[0, 70ms]`
   while every other glyph is stationary.
2. **No alias morph**: every `mutate` clone's text change is number→number,
   sign↔sign, or identical — never letter→word or digit→bracket.
3. **Opacity discipline**: only `died`/`born` clones pass through
   translucency; `follower`/`equals`/`mutate` stay opaque.
4. **Anchored `=`**: the equals translates only inside the reflow window.
5. **Even reflow**: no glyph covers >30% of its total path in any single
   frame (no lunge).
6. **Correct math**: the resulting equation matches the table (pills included).

Cases C1, B2, H2, I2 are the aliasing stress tests — they're the ones most
likely to regress when the tree layout changes, and the first to benefit when
stable tree-glyph identity (full actor-travel) lands.
