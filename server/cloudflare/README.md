# Durable Equation Session Service

This optional Worker turns the transport-neutral equation protocol into a live shared session:

- one SQLite-backed Durable Object serializes each equation capability;
- browser edits and model edits use one monotonic collaboration sequence;
- standing domain facts, previews, and idempotency receipts survive process eviction;
- applied semantic events reach browsers over hibernatable WebSockets;
- `/mcp` exposes the same engine through stateless Streamable HTTP;
- the GitHub Pages app still uses self-contained snapshot links when this service is absent.

The `vms1_…` value in a live share URL is an unguessable edit capability. Treat the full URL like
an “anyone with this link can edit” document. The service never lists session keys.

## Local validation

```bash
npm install
npm run test:shared
npm run worker:check
npm run test:worker
npm run worker:dev
```

`test:worker` drives the production bundle's REST, SQLite Durable Object, WebSocket, and remote MCP
paths inside Miniflare.

## One-time production activation

The application remains deployable before this setup; Share falls back to its existing snapshot
link.

1. Create a Cloudflare account and an API token from the **Edit Cloudflare Workers** template,
   scoped to that account.
2. In GitHub repository settings, add:

   - Actions secret `CLOUDFLARE_API_TOKEN`
   - Actions variable `CLOUDFLARE_ACCOUNT_ID`
   - Actions variable `EQUATION_SESSION_URL`, set to the deployed Worker origin without a trailing
     path, for example `https://visual-math-equation-service.example.workers.dev`

3. Run **Deploy Equation Session Service** once. Then run **Deploy to GitHub Pages** so its build
   receives `EQUATION_SESSION_URL`. Later merges deploy both automatically.

The Worker configuration uses Cloudflare's declarative Durable Object exports with SQLite storage;
the first deployment provisions the namespace and later deployments preserve sessions.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Service/protocol health. |
| `POST /v1/sessions` | Create a session from equation text or an `EquationDocument`. |
| `GET /v1/sessions/{sessionKey}/snapshot` | Read document, analysis, and legal actions. |
| `PUT /v1/sessions/{sessionKey}/document` | Compare-and-swap a browser document. |
| `GET /v1/sessions/{sessionKey}/live` | WebSocket snapshot/event stream. |
| `POST /v1/sessions/{sessionKey}/preview` | Preview an advertised action. |
| `POST /v1/sessions/{sessionKey}/apply` | Apply a single-use preview. |
| `PATCH /v1/sessions/{sessionKey}/symbol` | Update symbol context and domain facts. |
| `PUT /v1/sessions/{sessionKey}/view` | Select an advertised visualization. |
| `POST /mcp` | Stateless Streamable HTTP MCP for cloud clients. |

Configure a cloud MCP client once with `{EQUATION_SESSION_URL}/mcp`. Give the model a live
Playground URL; it extracts the `session` capability, reads the equation, discovers actions,
previews, and applies. The open browser receives the applied event and runs the recorded
move/simplification animation.
