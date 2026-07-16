# Equation Playground — road to general functions

The playground manipulates **equations in one or two variables** whose sides
are sums of terms `(num/den)·v^p` with `v ∈ {x, y}` and integer powers
`|p| ≤ 9`, plus parentheses `a(sum)` and function wrapping `a·fn(sum)` —
where the contents of a group or function may themselves contain groups and
functions (nesting is first-class). This is what makes every move exact,
previewable, and easy to hit-test.

## Shipped

### Graph pane (phase 1) ✅

Each side of an x-only nonlinear equation is plotted live: `2sin(x) = 1`
draws both curves and the solutions are visibly the intersections. Every
drag morphs the curves in real time. Dangerous moves become *visible*:
squaring shows the extra intersection appearing; ln shows the lost branch.

### Two variables + mapping pane (phase 3, early) ✅

`y` is a first-class variable (a `variable` tag on leaves): typed
`y = x² − 2`, manipulated with the same move grammar, with per-variable
assumption pills (`y ≠ 0`). Isolating a variable is detected as **function
mode** and reveals the input → output mapping pane — two number lines, a
draggable probe, and a fan of sample arrows.

### Maximum mode (the flat model at full stretch) ✅

- **Integer powers** `x³ … x⁹` and `1/x²` (powers −9…9): divide-by-x walks
  any power down, exponent-drag √ halves any even power, the parser accepts
  `x^-2`.
- **Nested functions**: `ln(sin(x))` parses, renders, and unwraps layer by
  layer; toolbox symbols nest over function sides (`ln` onto `2sin(x)`
  rebuilds to `ln(2sin(x))`); inner contents render inert and move as part
  of their owner.
- **Trig as moves**: sin/cos/tan tools apply to both sides (dangerous —
  "check solutions" pill); a side that is exactly the matching arc-value
  *thaws* back to the exact number, with ± and sign parity handled
  (cos is even).
- **Live terminal values**: `±√5`, `arcsin(½)`, `ln 3`, `e¹` are draggable
  terms; the ± glyph is a **branch chooser** (keep + / keep −) that records
  a `branch ±` pill; moves that would have to scale a frozen value are
  refused with an honest message instead of silently corrupting it.
- **Factoring** (reverse distribution): dragging a coefficient onto the
  upper half of a same-side sibling pulls out the gcd — `2x + 6 → 2(x + 3)`.
- **Click vs drag**: clicking a toolbox symbol is a *legal move* (both
  sides, history step); dragging it onto one term is a *building move* that
  rewrites the equation itself — the trail restarts from the new equation.

### The expression tree (phase 2) ✅ shipped in three layers

The formerly gated forms — `1/(x+1)`, `2^x`, `√(x+1)`, `x·y` — now live in
a real expression tree (`tree.ts`):

```
TNode = Const(num/den) | Named("pi") | Var("x" | "y")
      | Add(TNode[]) | Mul(TNode[]) | Pow(TNode, TNode) | Fn(name, TNode)
```

- **Layer 1 — parse, render, evaluate.** When the flat model refuses, the
  parser falls back to the tree: the equation typesets (real fractions,
  arbitrary exponents, √ overlines) and earns the same open-world reveals —
  `2^x = 8` plots with its crossing at 3, `y = 2^x` opens the mapping pane,
  and typed `pi` remains exact and renders as `π` instead of becoming a
  decimal approximation.
- **Layer 2 — one engine, two worlds.** The tree renderer (`treeview.tsx`)
  emits the same DOM contracts as the flat renderer (`data-symbol`,
  `data-term-wrap`, `data-equals`), so the single pointer engine — proximity
  grab, marquee, drop targets, live previews, history — drives both. Flat
  behavior is untouched (all flat suites pass unchanged). Immediate product
  factors are described once in `treeunits.ts` and consumed by both rendering
  and drop resolution: `sin(y)`, `e^5`, `(x+1)`, powers, and radicals are each
  one atomic factor target instead of overlapping syntax hitboxes. Marquee
  selection preserves any same-row numerator or denominator factor chunk, so
  `3e²`, `e²sin(y)`, or `3x` can move as one exact product.
- **Layer 3 — typed rewrites.** Tree moves (`treemoves.ts`) return
  `{ next, pills }`; the pill is the license. The simplifier is a strict
  whitelist of identities true everywhere: `x/x` does NOT silently become 1
  (there is no code path for it) — but the divide-both-sides move, having
  declared its `≠ 0` pill, may cancel exactly that base and nothing else.
  Nonzero constants (`ln 2`) cancel freely. And the escape hatch: the moment
  a tree equation becomes flat-representable, it drops back into the full
  flat game — `√(x+1) = 3` --square--> `x + 1 = 9` and every flat move works.

Shipped tree moves: addend across `=`, any immediate numerator factor divides
both sides (`ln 2`, `sin(y)`, `e^5`, `x`, and `(x+1)` included), any immediate
same-zone factor selection moves as a product, any immediate denominator
factor multiplies both sides, matching factors cancel with their
nonzero receipt, and all eight toolbox symbols work (ln thaws `2^x` to
`ln(2)·x` exactly; recip flips `1/(x+1) = 2` straight to `x + 1 = ½`;
squaring resolves √ with its check-roots pill).

## Still honestly gated

- **Bare `e` outside `e^( )`** — `π` is now an exact named constant, while
  Euler's constant still enters through exponential notation.
- **Per-term rebuilding in tree mode** (drag a toolbox symbol onto one tree
  term) — clicks apply to both sides; term-level tree rebuilds arrive with
  path-addressed payloads.
- **Distribution/factoring at depth** (expand `(x+1)(x−2)`, factor a tree
  sum) — the next move-grammar chapter.
- **d/dx, ∫, Σ, lim** — deliberately not equation moves at all; each is its
  own project.
