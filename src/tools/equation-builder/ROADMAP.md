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

## Still honestly gated (needs the expression-tree model)

Each of these is refused with a message that says why:

- **`x·y` cross-terms** — a leaf carries one variable and one power;
  squaring `x + y` or multiplying across variables needs multi-variable
  monomials.
- **`2^x` / `e^(a·ln …)`** — needs irrational coefficients (`ln 2`) kept
  symbolic through arithmetic.
- **Fractions of sums** `1/(x+1)` — needs groups with power −1.
- **√ of sums** `√(x²+1)` — needs a radical over a tree, not a leaf flag.
- **d/dx, ∫, Σ, lim** — deliberately not equation moves at all; each is its
  own move-grammar project.

## Phase 2 — Expression-tree model (the real rewrite)

Replace the flat `EqTerm[]` sides with a proper expression tree:

```
Node = Const(num/den) | Var("x" | "y") | Add(Node[]) | Mul(Node[])
     | Pow(Node, Node) | Fn(name, Node)
```

- **What survives unchanged**: the pointer drag engine, proximity grab,
  geometric drop targets, live previews, history + assumption pills, the
  toolbox, the typed-input parser (mathjs already produces this tree — the
  current code *flattens* it; phase 2 stops flattening).
- **What is rewritten**: the move grammar becomes tree rewrites (move an
  addend across `=`, divide by a factor, apply/unwrap a function at any
  depth), the renderer becomes recursive (the flat model's `renderInertTerm`
  and the pretty-printer in `parse.tsx` are already most of it), and
  payload/target identify *node paths* instead of term ids + roles.
- **What it unlocks**: everything in the gated list above, exactly.
- Normalization (today's `combine`) becomes a tree simplifier: fold
  constants, merge like addends, cancel `fn ∘ fn⁻¹`. Keep it conservative —
  the player makes the interesting moves, not the simplifier.
