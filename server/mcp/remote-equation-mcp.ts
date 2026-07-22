import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CreateEquationRequestSchema,
  DifferentiationActionArgumentsSchema,
  IntegrationActionArgumentsSchema,
} from "../../src/tools/equation-builder/protocol.js";
import { SHARED_SESSION_KEY_PATTERN } from "../../src/tools/equation-builder/shared-session.js";

const ToolOutputSchema = { result: z.unknown() };
const SessionKeySchema = z.string().regex(
  SHARED_SESSION_KEY_PATTERN,
  "Use the vms1_… capability from a live Equation Playground share URL."
);
const ActorNameSchema = z.string().trim().min(1).max(160).optional();

const SessionInputSchema = z.object({ sessionKey: SessionKeySchema }).strict();
const PreviewInputSchema = z.object({
  sessionKey: SessionKeySchema,
  expectedRevision: z.string().trim().min(1).max(256),
  actionId: z.string().trim().min(1).max(256),
  arguments: z.union([
    z.object({}).strict(),
    DifferentiationActionArgumentsSchema,
    IntegrationActionArgumentsSchema,
  ]).default({}),
  actorName: ActorNameSchema,
}).strict();
const ApplyInputSchema = z.object({
  sessionKey: SessionKeySchema,
  previewToken: z.string().trim().min(1).max(256),
  requestId: z.string().trim().min(1).max(256),
  actorName: ActorNameSchema,
}).strict();
const UpdateSymbolInputSchema = z.object({
  sessionKey: SessionKeySchema,
  expectedSequence: z.number().int().nonnegative(),
  expectedRevision: z.string().trim().min(1).max(256),
  symbolId: z.string().trim().min(1).max(256),
  patch: z.object({
    meaning: z.string().max(1_000).nullable().optional(),
    unit: z.string().max(160).nullable().optional(),
    assumptions: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  }).strict(),
  actorName: ActorNameSchema,
}).strict();
const SetViewInputSchema = z.object({
  sessionKey: SessionKeySchema,
  expectedSequence: z.number().int().nonnegative(),
  expectedRevision: z.string().trim().min(1).max(256),
  candidateId: z.string().trim().min(1).max(500).nullable(),
}).strict();

export interface RemoteEquationGateway {
  create(input: z.infer<typeof CreateEquationRequestSchema>): Promise<unknown>;
  read(sessionKey: string, resource: "snapshot" | "analysis" | "actions" | "symbols" | "history"): Promise<unknown>;
  preview(input: z.infer<typeof PreviewInputSchema>): Promise<unknown>;
  apply(input: z.infer<typeof ApplyInputSchema>): Promise<unknown>;
  updateSymbol(input: z.infer<typeof UpdateSymbolInputSchema>): Promise<unknown>;
  setView(input: z.infer<typeof SetViewInputSchema>): Promise<unknown>;
}

const resultText = (result: unknown): string => {
  if (!result || typeof result !== "object") return "Visual Math operation completed.";
  const value = result as Record<string, unknown>;
  if (value.status === "error") return String(value.message ?? "Visual Math rejected the request.");
  if (typeof value.playgroundUrl === "string") return `Shared equation ready: ${value.playgroundUrl}`;
  if (value.status === "previewed") {
    return `${String(value.explanation ?? "Preview ready")} Preview token: ${String(value.previewToken ?? "unknown")}.`;
  }
  if (value.status === "applied") return "Applied the preview to the live shared equation.";
  return "Visual Math shared equation response ready.";
};

const toolResult = (result: unknown) => {
  const isError = !!result && typeof result === "object" && (result as { status?: string }).status === "error";
  return {
    content: [{ type: "text" as const, text: resultText(result) }],
    structuredContent: { result },
    isError,
  };
};

const resourceText = (uri: URL, value: unknown) => ({
  contents: [{
    uri: uri.href,
    mimeType: "application/json",
    text: JSON.stringify(value, null, 2),
  }],
});

/** Remote MCP surface. Session keys are explicit, unguessable edit capabilities. */
export function createRemoteEquationMcpServer(gateway: RemoteEquationGateway): McpServer {
  const server = new McpServer({
    name: "visual-math-equation-remote",
    version: "1.0.0",
  });

  server.registerTool("equation_create", {
    title: "Create live equation",
    description: "Create a durable equation session and return its Equation Playground share URL.",
    inputSchema: CreateEquationRequestSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => toolResult(await gateway.create(input)));

  server.registerTool("equation_get", {
    title: "Open live equation",
    description: "Read a live equation from the vms1_ session capability embedded in its share URL.",
    inputSchema: SessionInputSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionKey }) => toolResult(await gateway.read(sessionKey, "snapshot")));

  server.registerTool("equation_analyze", {
    title: "Analyze live equation",
    description: "Read symmetric relation, symbol, graph, and calculus candidates for a shared equation.",
    inputSchema: SessionInputSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionKey }) => toolResult(await gateway.read(sessionKey, "analysis")));

  server.registerTool("equation_list_actions", {
    title: "List live equation actions",
    description: "Discover legal revision-bound actions for a shared equation; never fabricate an action ID.",
    inputSchema: SessionInputSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ sessionKey }) => toolResult(await gateway.read(sessionKey, "actions")));

  server.registerTool("equation_preview_action", {
    title: "Preview live equation action",
    description: "Compute an exact before/intermediate/after preview without changing the shared browser session.",
    inputSchema: PreviewInputSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => toolResult(await gateway.preview(input)));

  server.registerTool("equation_apply_preview", {
    title: "Apply live equation preview",
    description: "Atomically apply a single-use preview; connected browsers receive and animate the same event.",
    inputSchema: ApplyInputSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await gateway.apply(input)));

  server.registerTool("equation_update_symbol", {
    title: "Update live model symbol",
    description: "Update meaning, unit, or standing assumptions for one stable symbol in the shared equation.",
    inputSchema: UpdateSymbolInputSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await gateway.updateSymbol(input)));

  server.registerTool("equation_set_view", {
    title: "Select live visualization",
    description: "Select one advertised graph interpretation for the shared equation.",
    inputSchema: SetViewInputSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => toolResult(await gateway.setView(input)));

  const registerResource = (
    name: string,
    suffix: "snapshot" | "analysis" | "actions" | "symbols" | "history",
    title: string
  ) => server.registerResource(
    name,
    new ResourceTemplate(`visualmath://shared/{sessionKey}/${suffix}`, { list: undefined }),
    { title, mimeType: "application/json" },
    async (uri, variables) => {
      const raw = variables.sessionKey;
      const sessionKey = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
      return resourceText(uri, await gateway.read(sessionKey, suffix));
    }
  );

  registerResource("shared-equation", "snapshot", "Live equation snapshot");
  registerResource("shared-equation-analysis", "analysis", "Live equation analysis");
  registerResource("shared-equation-actions", "actions", "Live equation actions");
  registerResource("shared-equation-symbols", "symbols", "Live equation symbols");
  registerResource("shared-equation-history", "history", "Live equation history");

  return server;
}
