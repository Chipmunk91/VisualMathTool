# Equation Playground API

The playground exposes the same semantic command boundary used by its pointer UI at
`window.visualMathEquation`. The contract is implemented in `engine.ts`; React and pointer
coordinates are deliberately absent from it.

```ts
const api = window.visualMathEquation;
const document = api.getDocument();
const relation = api.analyzeRelation();
const operation = api.listApplicableOperations()
  .find((candidate) => candidate.label.startsWith("Divide both sides by 3"));
if (!operation) throw new Error("No legal divide-by-3 operation at this revision");

const request = {
  requestId: crypto.randomUUID(),
  expectedRevision: document.revision,
  actor: { kind: "ai", name: "Claude" },
  command: operation.command,
};

const preview = api.previewCommand(request);
if (preview.status === "applied") api.applyCommand(request);
```

`applyCommand` returns one of:

- `applied`: includes the canonical result and a trace event with before/intermediate/after trees.
- `rejected`: the operation is not legal for the selected structure.
- `stale`: `expectedRevision` does not match the displayed equation.

Current command families are `gesture`, `special-action`, `rewrite`, `differentiate`, and
`integrate`. They cover the existing
drag/drop grammar, contextual inverse-operation bubbles, toolbox operations, and detected
factorization/identity rewrites. `updateSymbol` edits the symbol book without rewriting equation
text.

## Multivariable calculus commands

The engine never guesses a calculus source, target, or variable role. A caller must classify every
symbol other than `withRespectTo` as either dependent or held constant. Differentiation and
integration then apply to both sides of the symmetric relation. If there is no dependent symbol,
the command is rejected unless `treatAsIdentity: true` explicitly confirms that the equality holds
for every value (rather than only at isolated solutions).

```ts
const document = api.getDocument();
const request = {
  requestId: crypto.randomUUID(),
  expectedRevision: document.revision,
  actor: { kind: "ai", name: "Claude" },
  command: {
    type: "differentiate",
    context: {
      mode: "partial",          // ordinary | partial | implicit | total
      withRespectTo: "s",
      dependent: ["y"],
      heldConstant: ["t"],
    },
  },
};

const preview = api.previewCommand(request);
if (preview.status === "applied") api.applyCommand(request);
```

For `y = s*t`, that context produces `∂y/∂s = t`. For `x^2 + y^2 = 1`, an
implicit context with respect to `x` and dependent `y` keeps `dy/dx` as a first-class AST factor.
Integration uses the same classification contract, supports optional numeric bounds, retains
dependent integrands under an exact integral node, and records `C` for indefinite integration.

`analyzeRelation()` returns symbols, structurally explicit isolations, graph candidates and
calculus candidates. Candidates are descriptive only; submitting a calculus command still
requires the complete context above. `setViewSpec(candidate.spec)` selects a validated graph
interpretation without coordinates; invalid or stale specs return `false`.

Share format version 3 stores the durable symbol book, structured assumptions, `ViewSpec`, last
calculus contexts, semantic operation events, and every derivation snapshot. The decoder continues
to accept version-2 document links, version-1 tree links, and legacy flat links. Legacy symbol
role/domain/dependency fields are dropped during reconciliation because those roles now belong to
a view or operation context.
