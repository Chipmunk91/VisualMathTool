# Equation Playground API

## Versioned protocol

`window.visualMathEquation.protocol` is the public, transport-neutral contract for model-driven
equation work. Its version is `visualmath.equation.v1`. The browser adapter and MCP server both
delegate to `EquationSessionService`; neither adapter reimplements algebra rules.

The safe mutation sequence is always:

1. Read the document and its revision.
2. List the actions that the engine says are legal at that revision.
3. Preview one advertised action ID with its declared arguments.
4. Show or inspect the exact before/intermediate/after result.
5. Apply that single-use preview token with an idempotent request ID.

```ts
const protocol = window.visualMathEquation?.protocol;
if (!protocol) throw new Error("Equation protocol is unavailable");

const document = protocol.getDocument();
const action = protocol.listActions()
  .find((candidate) => candidate.label === "Divide both sides by 3");
if (!action) throw new Error("That operation is not legal at this revision");

const preview = protocol.previewAction({
  documentId: document.documentId,
  expectedRevision: document.revision,
  actionId: action.id,
  arguments: {},
  actor: { kind: "ai", name: "Claude" },
});

if (preview.status === "previewed") {
  const applied = protocol.applyPreview({
    documentId: document.documentId,
    previewToken: preview.previewToken,
    requestId: crypto.randomUUID(),
    actor: { kind: "ai", name: "Claude" },
  });
  console.log(applied);
}
```

Action IDs and previews are revision-bound. A fabricated action is rejected, a preview cannot be
reused, and a preview becomes stale if another operation changes the equation first. A repeated
apply request with the same document/request ID returns the original result. Applied operations
append an actor-attributed event containing the semantic rule, targets, before state, optional
intermediate simplification state, after state, assumptions, explanation, and movement animation.

For calculus, callers refer to durable symbol IDs—not visual positions—and must classify every
other symbol as `dependent` or `held-constant`. Both sides of the relation are operated on; the
protocol never invents a source side, target side, or independent variable.

## Local MCP server

The stdio server at `server/mcp/equation-server.ts` exposes the same session contract to any MCP
client. Start it with:

```bash
npm run mcp:equation
```

It provides these tools:

| Tool | Purpose |
| --- | --- |
| `equation_create` | Parse text into a traceable equation document. |
| `equation_list_documents` | List documents in this server process. |
| `equation_get` | Read a complete document snapshot. |
| `equation_analyze` | Read symmetric relation, symbol, graph, and calculus candidates. |
| `equation_list_actions` | Discover the legal, revision-bound action inventory. |
| `equation_preview_action` | Compute an exact non-mutating preview. |
| `equation_apply_preview` | Atomically apply a preview token. |
| `equation_update_symbol` | Add meaning, unit, or assumptions to a stable symbol. |
| `equation_set_view` | Select an advertised visualization candidate. |

The same data is readable as MCP resources under `visualmath://equations/{documentId}` with
`/analysis`, `/symbols`, `/history`, and `/actions` views. See
[`server/mcp/README.md`](../../../server/mcp/README.md) for client configuration.

## Durable shared-session protocol (phases 4–6)

`visualmath.shared-equation.v1` wraps the same `EquationSessionService` in a durable collaboration
boundary. It adds no algebra rules. One session owns:

- the canonical `EquationDocument` and standing domain facts;
- preview tokens and idempotency receipts, including across Worker eviction;
- a monotonic collaboration sequence distinct from the mathematical tree revision;
- the latest semantic change, including the exact animation-bearing `EquationEvent`.

Browser document updates use compare-and-swap against the collaboration sequence. Remote MCP
clients continue to use the revision-bound discover → preview → apply protocol. A successfully
applied AI event is persisted, broadcast over WebSocket, and animated by the browser from its
recorded before/intermediate/after trees; the transport never diffs or manipulates the DOM.

Live share links carry an unguessable `vms1_…` edit capability. Without a configured equation
service, the same Share button retains the version-3 self-contained snapshot format. See
[`server/cloudflare/README.md`](../../../server/cloudflare/README.md) for deployment and endpoints.

## Compatibility API

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

The lower-level compatibility command families are `gesture`, `special-action`, `rewrite`, `differentiate`, and
`integrate`. They cover the existing
drag/drop grammar, contextual inverse-operation bubbles, toolbox operations, and detected
factorization/identity rewrites. `updateSymbol` edits the symbol book without rewriting equation
text.

## Multivariable calculus compatibility commands

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
