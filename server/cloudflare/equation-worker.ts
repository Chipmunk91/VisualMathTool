import { DurableObject } from "cloudflare:workers";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createRemoteEquationMcpServer, type RemoteEquationGateway } from "../mcp/remote-equation-mcp.js";
import { makeEquationDocument, type EquationDocument } from "../../src/tools/equation-builder/document.js";
import { parseEquation } from "../../src/tools/equation-builder/parser.js";
import {
  isSharedSessionKey,
  SharedEquationSession,
  type SharedSessionRecord,
  type SharedSessionSnapshot,
  type SharedSessionSyncRequest,
} from "../../src/tools/equation-builder/shared-session.js";

interface Env {
  EQUATION_SESSIONS: DurableObjectNamespace<EquationSessionObject>;
  PLAYGROUND_URL?: string;
  ALLOWED_ORIGINS?: string;
}

interface CreateSessionBody {
  text?: string;
  documentId?: string;
  document?: EquationDocument;
}

const MAX_BODY_BYTES = 2_000_000;
const DEFAULT_PLAYGROUND_URL = "https://chipmunk91.github.io/VisualMathTool/";

const jsonResponse = (value: unknown, status = 200, headers: HeadersInit = {}): Response =>
  Response.json(value, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });

const errorResponse = (code: string, message: string, status = 400): Response =>
  jsonResponse({ status: "error", code, message }, status);

const readJson = async <T>(request: Request): Promise<T> => {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) throw new Error("request_too_large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("request_too_large");
  return JSON.parse(text) as T;
};

const makeSessionKey = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `vms1_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
};

const isEquationDocument = (value: unknown): value is EquationDocument => {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<EquationDocument>;
  return document.schemaVersion === 2 &&
    typeof document.documentId === "string" && document.documentId.length > 0 &&
    typeof document.revision === "string" &&
    !!document.equation?.left && !!document.equation?.right &&
    Array.isArray(document.symbols) && Array.isArray(document.assumptions) &&
    Array.isArray(document.history);
};

const playgroundUrl = (env: Env, sessionKey: string): string => {
  const base = new URL(env.PLAYGROUND_URL || DEFAULT_PLAYGROUND_URL);
  base.searchParams.set("session", sessionKey);
  base.hash = "/tools/equation-builder";
  return base.href;
};

const parsedDocument = (body: CreateSessionBody): EquationDocument | null => {
  if (body.document) return isEquationDocument(body.document) ? body.document : null;
  if (typeof body.text !== "string") return null;
  const parsed = parseEquation(body.text);
  if (!parsed.ok) return null;
  return makeEquationDocument(parsed.tree, body.documentId ? { documentId: body.documentId } : {});
};

const sessionStub = (env: Env, sessionKey: string) =>
  env.EQUATION_SESSIONS.get(env.EQUATION_SESSIONS.idFromName(sessionKey));

const stubJson = async (
  env: Env,
  sessionKey: string,
  path: string,
  init?: RequestInit
): Promise<unknown> => {
  if (!isSharedSessionKey(sessionKey)) {
    return { status: "error", code: "invalid_session", message: "The shared equation key is malformed." };
  }
  const response = await sessionStub(env, sessionKey).fetch(`https://equation.internal/${path}`, init);
  return response.json();
};

const createSession = async (env: Env, body: CreateSessionBody): Promise<unknown> => {
  const document = parsedDocument(body);
  if (!document) {
    return { status: "error", code: "invalid_request", message: "Provide a valid equation document or equation text." };
  }
  const sessionKey = makeSessionKey();
  const response = await stubJson(env, sessionKey, "init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey, document }),
  });
  if (response && typeof response === "object" && (response as { status?: string }).status === "error") {
    return response;
  }
  return { ...(response as Record<string, unknown>), playgroundUrl: playgroundUrl(env, sessionKey) };
};

const remoteGateway = (env: Env): RemoteEquationGateway => ({
  create: (input) => createSession(env, input),
  read: (sessionKey, resource) => stubJson(env, sessionKey, resource),
  preview: ({ sessionKey, ...input }) => stubJson(env, sessionKey, "preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }),
  apply: ({ sessionKey, ...input }) => stubJson(env, sessionKey, "apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }),
  updateSymbol: ({ sessionKey, ...input }) => stubJson(env, sessionKey, "symbol", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }),
  setView: ({ sessionKey, ...input }) => stubJson(env, sessionKey, "view", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }),
});

const corsHeaders = (request: Request, env: Env): Headers => {
  const headers = new Headers();
  const origin = request.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS || "https://chipmunk91.github.io,http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "origin");
  }
  headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,mcp-protocol-version,mcp-session-id,last-event-id");
  headers.set("access-control-expose-headers", "mcp-protocol-version,mcp-session-id");
  return headers;
};

const withCors = (response: Response, request: Request, env: Env): Response => {
  const headers = new Headers(response.headers);
  corsHeaders(request, env).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (url.pathname === "/health") {
      return withCors(jsonResponse({ status: "ok", protocol: "visualmath.shared-equation.v1" }), request, env);
    }
    if (url.pathname === "/v1/sessions" && request.method === "POST") {
      try {
        return withCors(jsonResponse(await createSession(env, await readJson<CreateSessionBody>(request))), request, env);
      } catch (error) {
        const tooLarge = error instanceof Error && error.message === "request_too_large";
        return withCors(errorResponse(
          tooLarge ? "request_too_large" : "invalid_request",
          tooLarge ? "The equation document is too large." : "The session request is not valid JSON.",
          tooLarge ? 413 : 400
        ), request, env);
      }
    }
    if (url.pathname === "/mcp") {
      if (request.method !== "POST") {
        return withCors(jsonResponse({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Stateless remote MCP accepts POST requests only." },
          id: null,
        }, 405), request, env);
      }
      const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
      const server = createRemoteEquationMcpServer(remoteGateway(env));
      await server.connect(transport);
      return withCors(await transport.handleRequest(request), request, env);
    }
    const match = url.pathname.match(/^\/v1\/sessions\/(vms1_[A-Za-z0-9_-]{43})\/(.+)$/);
    if (match) {
      const [, sessionKey, action] = match;
      const forwarded = new Request(`https://equation.internal/${action}${url.search}`, request);
      const response = await sessionStub(env, sessionKey).fetch(forwarded);
      // Reconstructing a 101 response drops its attached WebSocket.
      return response.status === 101 ? response : withCors(response, request, env);
    }
    return withCors(errorResponse("not_found", "Route not found.", 404), request, env);
  },
};

/** One serialized, durable authority per capability key. */
export class EquationSessionObject extends DurableObject<Env> {
  private controller: SharedEquationSession | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    state.blockConcurrencyWhile(async () => {
      state.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS equation_session (id INTEGER PRIMARY KEY CHECK (id = 1), record_json TEXT NOT NULL)"
      );
      const row = state.storage.sql
        .exec<{ record_json: string }>("SELECT record_json FROM equation_session WHERE id = 1")
        .toArray()[0];
      if (row) this.controller = new SharedEquationSession(JSON.parse(row.record_json) as SharedSessionRecord);
    });
  }

  private async persist(): Promise<void> {
    if (!this.controller) return;
    this.ctx.storage.sql.exec(
      "INSERT INTO equation_session (id, record_json) VALUES (1, ?) " +
      "ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json",
      JSON.stringify(this.controller.exportRecord())
    );
  }

  private current(): SharedEquationSession | Response {
    return this.controller ?? errorResponse("session_not_found", "That shared equation session does not exist.", 404);
  }

  private async broadcast(snapshot: SharedSessionSnapshot): Promise<void> {
    const message = JSON.stringify(snapshot);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(message); } catch { /* the runtime discards stale sockets */ }
    }
  }

  private async finishMutation(beforeSequence: number, result: unknown): Promise<Response> {
    await this.persist();
    const snapshot = this.controller?.snapshot();
    if (snapshot && !("status" in snapshot) && snapshot.sequence !== beforeSequence) {
      await this.broadcast(snapshot);
    }
    return jsonResponse(result);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/init" && request.method === "POST") {
        if (this.controller) return errorResponse("session_exists", "This session already exists.", 409);
        const body = await readJson<{ sessionKey: string; document: EquationDocument }>(request);
        if (!isSharedSessionKey(body.sessionKey) || !isEquationDocument(body.document)) {
          return errorResponse("invalid_request", "The initial shared equation is malformed.");
        }
        this.controller = SharedEquationSession.create(body.sessionKey, body.document);
        await this.persist();
        return jsonResponse(this.controller.snapshot(), 201);
      }
      const current = this.current();
      if (current instanceof Response) return current;
      if (url.pathname === "/live") {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return errorResponse("upgrade_required", "Open this endpoint as a WebSocket.", 426);
        }
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
        this.ctx.acceptWebSocket(server);
        const snapshot = current.snapshot();
        if (!("status" in snapshot)) server.send(JSON.stringify(snapshot));
        return new Response(null, { status: 101, webSocket: client });
      }
      if (url.pathname === "/snapshot" && request.method === "GET") return jsonResponse(current.snapshot());
      const snapshot = current.snapshot();
      if ("status" in snapshot) return jsonResponse(snapshot, 500);
      if (url.pathname === "/analysis" && request.method === "GET") return jsonResponse(snapshot.snapshot.analysis);
      if (url.pathname === "/actions" && request.method === "GET") return jsonResponse(snapshot.snapshot.actions);
      if (url.pathname === "/symbols" && request.method === "GET") return jsonResponse(snapshot.document.symbols);
      if (url.pathname === "/history" && request.method === "GET") return jsonResponse(snapshot.document.history);

      const beforeSequence = snapshot.sequence;
      if (url.pathname === "/document" && request.method === "PUT") {
        const result = current.syncDocument(await readJson<SharedSessionSyncRequest>(request));
        return this.finishMutation(beforeSequence, result);
      }
      if (url.pathname === "/preview" && request.method === "POST") {
        const input = await readJson<Record<string, unknown>>(request);
        const { actorName, ...requestInput } = input;
        const result = current.previewAction({
          ...requestInput,
          documentId: snapshot.primaryDocumentId,
          actor: { kind: "ai", name: typeof actorName === "string" ? actorName : "remote-mcp" },
        } as Parameters<SharedEquationSession["previewAction"]>[0]);
        return this.finishMutation(beforeSequence, result);
      }
      if (url.pathname === "/apply" && request.method === "POST") {
        const input = await readJson<Record<string, unknown>>(request);
        const { actorName, ...requestInput } = input;
        const result = current.applyPreview({
          ...requestInput,
          documentId: snapshot.primaryDocumentId,
          actor: { kind: "ai", name: typeof actorName === "string" ? actorName : "remote-mcp" },
        } as Parameters<SharedEquationSession["applyPreview"]>[0]);
        return this.finishMutation(beforeSequence, result);
      }
      if (url.pathname === "/symbol" && request.method === "PATCH") {
        const input = await readJson<Record<string, unknown>>(request);
        const { actorName, ...requestInput } = input;
        const result = current.updateSymbol({
          ...requestInput,
          documentId: snapshot.primaryDocumentId,
          actor: { kind: "ai", name: typeof actorName === "string" ? actorName : "remote-mcp" },
        } as Parameters<SharedEquationSession["updateSymbol"]>[0]);
        return this.finishMutation(beforeSequence, result);
      }
      if (url.pathname === "/view" && request.method === "PUT") {
        const result = current.setView({
          ...await readJson<Record<string, unknown>>(request),
          documentId: snapshot.primaryDocumentId,
        } as Parameters<SharedEquationSession["setView"]>[0]);
        return this.finishMutation(beforeSequence, result);
      }
      return errorResponse("not_found", "Session route not found.", 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown shared-session error.";
      return errorResponse("invalid_request", message, 400);
    }
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string" && message === "ping") socket.send("pong");
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    socket.close(code, reason);
  }
}
