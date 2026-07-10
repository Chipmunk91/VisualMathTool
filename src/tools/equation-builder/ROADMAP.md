# Equation Playground — road to general functions

The playground currently manipulates **constant equations in one unknown**:
sides are flat sums of terms `(num/den)·x^p` with `p ∈ {−1, 0, 1, 2}`, plus
one level of parentheses (`a(sum)`) and one level of function wrapping
(`a·fn(sum)`). This is what makes every move exact, previewable, and easy to
hit-test — and it is also the ceiling.

"General functions" means two different expansions, and they are best done in
this order:

## Phase 1 — Graph pane (no model change) ✅ feasible now

Treat each side of the equation as a function of x and plot both curves live:

- `2sin(x) = 1` draws `y = 2sin(x)` and `y = 1`; the solutions are visibly
  the intersections. Every drag morphs the curves in real time — the original
  "input/output space" vision, delivered with the current model.
- Everything the model can hold today is evaluable (powers −1…2, groups,
  sin/cos/tan/ln/eˣ, radicals, ± values), so the plotter is a pure add-on:
  `evalSide(terms, x) → number`, an SVG/canvas pane, no changes to moves.
- Dangerous moves become *visible*: squaring shows the extra intersection
  appearing; ln shows the lost negative branch; the pills gain pictures.

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
  depth), the renderer becomes recursive (the pretty-printer in `parse.tsx`
  is already 80% of it), and payload/target identify *node paths* instead of
  term ids + roles.
- **What it unlocks**: arbitrary powers (`x³`, `x^(1/2)`), nested functions
  (`ln(sin(x))`), fractions of sums, and two-variable equations `y = f(x)`
  where isolating y or x are both valid games.
- Normalization (today's `combine`) becomes a tree simplifier: fold constants,
  merge like addends, cancel `fn ∘ fn⁻¹`. Keep it conservative — the player
  makes the interesting moves, not the simplifier.

## Phase 3 — Two variables + linked visualization

With the tree model, allow `y` as a first-class citizen:

- `y = f(x)` plots the graph; dragging symbols in the equation *is* graph
  transformation (add 3 → curve shifts up; wrap in ln → curve remaps).
- Solving "for x" vs "for y" is the same move grammar with a different target.
- This is where the playground and the linear-algebra tool converge on the
  site's core idea: algebraic manipulation and its geometric meaning, live.

## Deliberately out of scope until then

Factoring (reverse distribution), polynomial division, trig identities,
d/dx, ∫, Σ, lim (the greyed toolbox items) — each is its own move-grammar
project and should land on the tree model, not the flat one.
