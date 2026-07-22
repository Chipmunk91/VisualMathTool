import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Miniflare } from "miniflare";

const bundlePath = resolve("tmp/equation-worker/equation-worker.js");
let miniflare: Miniflare | null = null;
const disposeRuntime = async () => {
  if (!miniflare) return;
  await Promise.race([
    miniflare.dispose(),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ]);
};

const json = async <T>(response: { json(): Promise<unknown> }): Promise<T> => response.json() as Promise<T>;

async function main(): Promise<void> {
  const bundle = (await readFile(bundlePath, "utf8")).replace(/^.*sourceMappingURL.*$/gm, "");
  const runtime = new Miniflare({
    modules: [{ type: "ESModule", path: "worker.js", contents: bundle }],
    compatibilityDate: "2026-07-19",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      EQUATION_SESSIONS: { className: "EquationSessionObject", useSQLite: true },
    },
    bindings: {
      PLAYGROUND_URL: "https://chipmunk91.github.io/VisualMathTool/",
      ALLOWED_ORIGINS: "https://chipmunk91.github.io,http://localhost:5173",
    },
  });
  miniflare = runtime;
  const health = await runtime.dispatchFetch("http://localhost/health");
  assert.equal(health.status, 200);

  const createResponse = await runtime.dispatchFetch("http://localhost/v1/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "3*x = y" }),
  });
  const created = await json<{
    sessionKey: string;
    sequence: number;
    playgroundUrl: string;
  }>(createResponse);
  assert.match(created.sessionKey, /^vms1_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.sequence, 0);
  assert.ok(created.playgroundUrl.includes(created.sessionKey));

  const snapshotUrl = `http://localhost/v1/sessions/${created.sessionKey}/snapshot`;
  const initial = await json<{
    sequence: number;
    document: { documentId: string; revision: string; history: unknown[] };
    snapshot: { actions: Array<{ id: string; label: string }> };
  }>(await runtime.dispatchFetch(snapshotUrl));
  const divide = initial.snapshot.actions.find((action) => action.label === "Divide both sides by 3");
  assert.ok(divide);

  const liveResponse = await runtime.dispatchFetch(
    `http://localhost/v1/sessions/${created.sessionKey}/live`,
    { headers: { Upgrade: "websocket" } }
  );
  assert.equal(liveResponse.status, 101);
  const socket = liveResponse.webSocket;
  assert.ok(socket);
  socket.accept();
  const liveSnapshots: Array<{ sequence: number; change: { kind: string } }> = [];
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") liveSnapshots.push(JSON.parse(event.data));
  });

  const preview = await json<{ status: string; previewToken: string }>(await runtime.dispatchFetch(
    `http://localhost/v1/sessions/${created.sessionKey}/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: initial.document.revision,
        actionId: divide.id,
        arguments: {},
        actorName: "worker-test",
      }),
    }
  ));
  assert.equal(preview.status, "previewed");

  const applied = await json<{ status: string; event: { actor: { kind: string; name: string }; animation?: unknown } }>(
    await runtime.dispatchFetch(`http://localhost/v1/sessions/${created.sessionKey}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        previewToken: preview.previewToken,
        requestId: "worker-apply-1",
        actorName: "worker-test",
      }),
    })
  );
  assert.equal(applied.status, "applied");
  assert.deepEqual(applied.event.actor, { kind: "ai", name: "worker-test" });
  assert.ok(applied.event.animation);

  const deadline = Date.now() + 2_000;
  while (!liveSnapshots.some((snapshot) => snapshot.sequence === 1) && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  assert.ok(liveSnapshots.some((snapshot) => snapshot.sequence === 1 && snapshot.change.kind === "applied"));
  const after = await json<{ sequence: number; document: { history: unknown[] } }>(
    await runtime.dispatchFetch(snapshotUrl)
  );
  assert.equal(after.sequence, 1);
  assert.equal(after.document.history.length, 1);

  const workerFetch = async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.clone().arrayBuffer();
    return runtime.dispatchFetch(request.url, {
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    }) as unknown as globalThis.Response;
  };
  const client = new Client({ name: "worker-remote-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: workerFetch as never,
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 8);
    const opened = await client.callTool({
      name: "equation_get",
      arguments: { sessionKey: created.sessionKey },
    });
    const structured = opened.structuredContent as { result?: { sequence?: number } } | undefined;
    assert.equal(structured?.result?.sequence, 1);
  } finally {
    await client.close();
    socket.close(1000, "test complete");
  }
}

main().then(async () => {
  await disposeRuntime();
  console.log("equation Worker REST, live sync, and remote MCP contract: ok");
  process.exit(0);
}).catch(async (error: unknown) => {
  console.error(error);
  await disposeRuntime();
  process.exit(1);
});
