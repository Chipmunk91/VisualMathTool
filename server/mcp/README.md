# Visual Math Equation MCP

The project exposes the semantic equation engine over two MCP transports. Neither clicks rendered
symbols or sends pointer coordinates.

- **Local stdio** owns process-scoped documents and is convenient for local Claude/Codex clients.
- **Remote Streamable HTTP** operates durable `vms1_…` sessions that an open Playground shares
  with browsers and cloud AI clients.

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

## Local session boundary

Documents created through stdio live for the lifetime of that MCP process.

## Remote live sessions

After deploying the optional equation service, configure a remote MCP client once with:

```text
https://<equation-service-origin>/mcp
```

Give the client a live Equation Playground URL. The `session=vms1_…` query value is an unguessable
edit capability: the model passes it to `equation_get`, discovers and previews a legal action, then
applies it. Every connected browser receives the exact semantic event and replays its recorded
movement/simplification animation. Deployment and REST endpoint details are in
[`server/cloudflare/README.md`](../cloudflare/README.md).
