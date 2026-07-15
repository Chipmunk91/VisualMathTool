# The rewrite-suggestion engine

`src/tools/equation-builder/rewrites.ts` — **built, not wired to the UI.**

## Why it exists

The simplifier deliberately keeps expressions *factored*: `2(x+3)` stays,
products don't FOIL, `ln(x·y)` doesn't split, `sin(−x)` doesn't flip. Those
directions aren't a canonical form — they're the **student's** choice. Auto-
applying them would rob the derivation of a step (and, for the log/trig ones,
silently assume a domain).

This engine is the other half: given a state, it **detects** the rewrites
available at each subtree and returns them as candidates. The design the owner
asked for is *engine detects, user decides* — a future UI offers the list; the
user takes one or leaves it. Nothing here changes the equation on its own.

## What it detects

| Kind | Rule | Example | Pill |
|---|---|---|---|
| expand | distribute a product over a sum | `2(x+3)` → `2x + 6` | — |
| expand | expand a power of a sum | `(x+1)²` → `x² + 2x + 1` | — |
| expand | FOIL two sums | `(x+1)(x+2)` → `x² + 3x + 2` | — |
| factor | pull out a common factor (numeric GCD + shared variable powers) | `6x² + 9x` → `3x(2x + 3)` | — |
| factor | factor a quadratic with rational roots | `x² + 3x + 2` → `(x+1)(x+2)` | — |
| identity | `ln(a·b) = ln a + ln b` | `ln(x·y)` → `ln x + ln y` | `x, y > 0` |
| identity | `ln(uⁿ) = n·ln u` | `ln(x²)` → `2 ln x` | `x > 0` |
| identity | `sin(−u) = −sin u`, `tan(−u) = −tan u` | `sin(−x)` → `−sin x` | — |
| identity | `cos(−u) = cos u` | `cos(−x)` → `cos x` | — |

Detection is a full-tree walk, so a rewrite deep inside a larger expression is
found and can be applied in place (`applyRewrite` replaces the first structural
match, leaving the rest untouched).

## The honesty guard

Two guarantees, both machine-checked in `scripts/test-rewrites.ts`
(`npm run test:rewrites`, also in CI):

1. **Every candidate is value-preserving on its stated domain.** `verifyRewrite`
   is three-valued — `"ok"` (agrees at ≥3 shared-defined points), `"violated"`
   (disagrees where both are defined → a bug), `"unverifiable"` (too few shared
   points, e.g. a pilled rewrite sampled outside its domain). The suite fuzzes
   ~1000 candidates over 5000 random trees; none are ever `"violated"`, and
   applying any candidate never changes the whole expression's value.
2. **Conditional rewrites carry their pill.** The log laws only hold where each
   argument is positive, so they're offered with `… > 0`. Rewrites that would be
   invalid even with a pill — `ln(a·b)` where a factor is a *negative constant*
   (`ln(−2)+ln(−1) ≠ ln 2`) — are **not offered at all**.

## Not deciding here (deliberately)

- Even-power logs: `ln(u²) = 2 ln u` is offered with `u > 0`, which drops the
  negative-base branch (the full identity is `2 ln|u|`, and the grammar has no
  `|·|`). Honest, if conservative.
- No trig product/sum identities, no `e^(a+b) = e^a·e^b` split yet — easy to add
  as more rules following the same shape (`(node) → Rewrite | null`).

## Wiring it up later

When the UI is ready: call `detectRewritesEq(treeEq)` for the tagged list
(`{ side, rewrite }[]`), render each `rewrite.label` (+ `pill`) as an offer, and
on accept commit `applyRewrite(side, rewrite)` as a normal step — pill and all,
exactly like a move.
