# Visual Math Equation MCP

This local stdio server lets an MCP client operate the same semantic equation engine as the
Equation Playground. It does not click rendered symbols or send pointer coordinates.

## Start directly

From the repository root:

```bash
npm install
npm run mcp:equation
```

The process communicates with its client over standard input/output. Diagnostics go to standard
error so they cannot corrupt MCP messages.

## Client configuration

Use an absolute repository path in a standard local MCP server entry:

```json
{
  "mcpServers": {
    "visual-math-equation": {
      "command": "npm",
      "args": [
        "--prefix",
        "/absolute/path/to/VisualMathTool",
        "run",
        "mcp:equation"
      ]
    }
  }
}
```

Restart or reload the MCP client after changing its configuration.

## Recommended model workflow

1. Call `equation_create`, or use `equation_list_documents` to find a document in the current
   process.
2. Call `equation_get` or `equation_analyze` before deciding how to interpret the relation.
3. Call `equation_list_actions`; never invent action IDs.
4. Call `equation_preview_action` with the current revision and inspect its exact result.
5. Ask for human confirmation when the preview reports assumptions or warnings.
6. Call `equation_apply_preview` once with a stable request ID. Retrying that request ID is safe.

Differentiation and integration require an operation-variable symbol ID and a role for every other
symbol. The server applies the operation to the relation as a whole; it does not infer calculus
semantics from the left/right position of a symbol.

## Session boundary

Documents live for the lifetime of this MCP process. The browser and MCP adapters share the same
protocol implementation but not yet a persistent transport. Import/export of hosted share links
and attachment to an already-open browser session are intentionally deferred to the durable-session
phase.
