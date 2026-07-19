# Equation Playground API

The playground exposes the same semantic command boundary used by its pointer UI at
`window.visualMathEquation`. The contract is implemented in `engine.ts`; React and pointer
coordinates are deliberately absent from it.

```ts
const api = window.visualMathEquation;
const document = api.getDocument();
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

Current command families are `gesture`, `special-action`, and `rewrite`. They cover the existing
drag/drop grammar, contextual inverse-operation bubbles, toolbox operations, and detected
factorization/identity rewrites. `updateSymbol` edits the symbol book without rewriting equation
text.

Share format version 2 stores the symbol book, structured assumptions, meaningful graph view
state, semantic operation events, and every derivation snapshot. The decoder continues to accept
version-1 tree links and legacy flat links.
