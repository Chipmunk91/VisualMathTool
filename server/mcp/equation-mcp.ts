import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ApplyPreviewRequestSchema,
  CreateEquationRequestSchema,
  DocumentRequestSchema,
  PreviewActionRequestSchema,
  SetProtocolViewRequestSchema,
  UpdateProtocolSymbolRequestSchema,
} from "../../src/tools/equation-builder/protocol.js";
import { EquationSessionService } from "../../src/tools/equation-builder/session.js";

const ToolOutputSchema = { result: z.unknown() };
const ActorNameSchema = z.string().trim().min(1).max(160).optional();

const PreviewToolInputSchema = PreviewActionRequestSchema.omit({ actor: true }).extend({
  actorName: ActorNameSchema,
}).strict();

const ApplyToolInputSchema = ApplyPreviewRequestSchema.omit({ actor: true }).extend({
  actorName: ActorNameSchema,
}).strict();

const UpdateSymbolToolInputSchema = UpdateProtocolSymbolRequestSchema.omit({ actor: true }).extend({
  actorName: ActorNameSchema,
}).strict();

const resultText = (result: unknown): string => {
  if (!result || typeof result !== "object") return "Visual Math operation completed.";
  const value = result as Record<string, unknown>;
  if (value.status === "error") return String(value.message ?? "Visual Math rejected the request.");
  if (value.status === "created") {
    const document = value.document as { documentId?: string; revision?: string } | undefined;
    return `Created equation ${document?.documentId ?? "document"} at ${document?.revision ?? "its initial revision"}.`;
  }
  if (value.status === "previewed") {
    return `${String(value.explanation ?? "Preview ready")} Preview token: ${String(value.previewToken ?? "unknown")}.`;
  }
  if (value.status === "applied") {
    const document = value.document as { documentId?: string; revision?: string } | undefined;
    return `Applied the preview to ${document?.documentId ?? "the equation"}; revision ${document?.revision ?? "updated"}.`;
  }
  if (value.status === "updated") return "Updated the equation document context.";
  if (Array.isArray(value.documentIds)) return `Open equation documents: ${value.documentIds.join(", ") || "none"}.`;
  if (Array.isArray(result)) return `Returned ${result.length} equation actions.`;
  return "Visual Math operation completed.";
};

const toolResult = (result: unknown) => {
  const isError = !!result && typeof result === "object" && (result as { status?: string }).status === "error";
  return {
    content: [{ type: "text" as const, text: resultText(result) }],
    structuredContent: { result },
    isError,
  };
};

const variable = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] ?? "" : value ?? "";

const resourceText = (uri: URL, value: unknown) => ({
  contents: [{
    uri: uri.href,
    mimeType: "application/json",
    text: JSON.stringify(value, null, 2),
  }],
});

export interface EquationMcpServerBundle {
  server: McpServer;
  service: EquationSessionService;
}

/** Register the local equation server without choosing a transport. */
export function createEquationMcpServer(
  service = new EquationSessionService()
): EquationMcpServerBundle {
  const server = new McpServer({
    name: "visual-math-equation",
    version: "1.0.0",
  });

  server.registerTool("equation_create", {
    title: "Create equation document",
    description: "Parse equation text into a new traceable Visual Math document.",
    inputSchema: CreateEquationRequestSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (input) => toolResult(service.createEquation(input)));

  server.registerTool("equation_list_documents", {
    title: "List equation documents",
    description: "List equation document IDs open in this local MCP session.",
    inputSchema: z.object({}).strict(),
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => toolResult({ documentIds: service.listDocumentIds() }));

  server.registerTool("equation_get", {
    title: "Get equation snapshot",
    description: "Read the document, relation analysis, symbols, and actions for one equation.",
    inputSchema: DocumentRequestSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ documentId }) => toolResult(service.snapshot(documentId)));

  server.registerTool("equation_analyze", {
    title: "Analyze equation relation",
    description: "Inspect symmetric relation, symbol, view, and calculus candidates without choosing one.",
    inputSchema: DocumentRequestSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ documentId }) => toolResult(service.analyze(documentId)));

  server.registerTool("equation_list_actions", {
    title: "List legal equation actions",
    description: "Enumerate revision-bound semantic actions. The model must choose an advertised action ID.",
    inputSchema: DocumentRequestSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ documentId }) => toolResult(service.listActions(documentId)));

  server.registerTool("equation_preview_action", {
    title: "Preview equation action",
    description: "Preview one advertised action without mutating the document. Calculus requires every symbol role.",
    inputSchema: PreviewToolInputSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ actorName, ...request }) => toolResult(service.previewAction({
    ...request,
    actor: { kind: "ai", name: actorName ?? "mcp-client" },
  })));

  server.registerTool("equation_apply_preview", {
    title: "Apply equation preview",
    description: "Atomically apply a single-use preview token at its bound equation revision.",
    inputSchema: ApplyToolInputSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ actorName, ...request }) => toolResult(service.applyPreview({
    ...request,
    actor: { kind: "ai", name: actorName ?? "mcp-client" },
  })));

  server.registerTool("equation_update_symbol", {
    title: "Update model symbol",
    description: "Update meaning, unit, or explicit assumptions for one stable symbol ID.",
    inputSchema: UpdateSymbolToolInputSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ actorName, ...request }) => toolResult(service.updateSymbol({
    ...request,
    actor: { kind: "ai", name: actorName ?? "mcp-client" },
  })));

  server.registerTool("equation_set_view", {
    title: "Select equation visualization",
    description: "Select one currently advertised view candidate, or null to leave the interpretation unselected.",
    inputSchema: SetProtocolViewRequestSchema,
    outputSchema: ToolOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (request) => toolResult(service.setView(request)));

  const completeDocumentId = (value: string) =>
    service.listDocumentIds().filter((documentId) => documentId.startsWith(value)).slice(0, 50);
  const listDocuments = async () => ({
    resources: service.listDocumentIds().map((documentId) => ({
      uri: `visualmath://equations/${encodeURIComponent(documentId)}`,
      name: `Equation ${documentId}`,
      description: "Complete Visual Math equation session snapshot.",
      mimeType: "application/json",
    })),
  });

  server.registerResource(
    "equation-document",
    new ResourceTemplate("visualmath://equations/{documentId}", {
      list: listDocuments,
      complete: { documentId: completeDocumentId },
    }),
    {
      title: "Equation document",
      description: "Document, analysis, and currently legal actions.",
      mimeType: "application/json",
    },
    async (uri, variables) => resourceText(uri, service.snapshot(variable(variables.documentId)))
  );

  const registerDocumentResource = (
    name: string,
    suffix: string,
    title: string,
    description: string,
    read: (documentId: string) => unknown
  ) => server.registerResource(
    name,
    new ResourceTemplate(`visualmath://equations/{documentId}/${suffix}`, {
      list: undefined,
      complete: { documentId: completeDocumentId },
    }),
    { title, description, mimeType: "application/json" },
    async (uri, variables) => resourceText(uri, read(variable(variables.documentId)))
  );

  registerDocumentResource(
    "equation-analysis",
    "analysis",
    "Equation relation analysis",
    "Symmetric relation, symbols, and possible interpretations.",
    (documentId) => service.analyze(documentId)
  );
  registerDocumentResource(
    "equation-symbols",
    "symbols",
    "Equation symbols",
    "Durable symbol identities, meanings, units, and assumptions.",
    (documentId) => service.getDocument(documentId)?.symbols ?? { status: "error", code: "document_not_found" }
  );
  registerDocumentResource(
    "equation-history",
    "history",
    "Equation event history",
    "Append-only semantic events with before, intermediate, and after states.",
    (documentId) => service.getDocument(documentId)?.history ?? { status: "error", code: "document_not_found" }
  );
  registerDocumentResource(
    "equation-actions",
    "actions",
    "Equation actions",
    "Legal revision-bound actions and their required input schemas.",
    (documentId) => service.listActions(documentId)
  );

  return { server, service };
}
