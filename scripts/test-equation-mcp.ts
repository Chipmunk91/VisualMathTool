import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createEquationMcpServer } from "../server/mcp/equation-mcp";

const resultValue = (response: unknown): unknown =>
  (response as { structuredContent?: Record<string, unknown> }).structuredContent?.result;

const { server } = createEquationMcpServer();
const client = new Client({ name: "visual-math-contract-test", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

async function main(): Promise<void> {
try {
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const tools = await client.listTools();
  const names = new Set(tools.tools.map((tool) => tool.name));
  for (const name of [
    "equation_create",
    "equation_list_documents",
    "equation_get",
    "equation_analyze",
    "equation_list_actions",
    "equation_preview_action",
    "equation_apply_preview",
    "equation_update_symbol",
    "equation_set_view",
  ]) {
    assert.ok(names.has(name), `missing MCP tool ${name}`);
  }

  const createdResponse = await client.callTool({
    name: "equation_create",
    arguments: { text: "3*x = y", documentId: "mcp-equation" },
  });
  const created = resultValue(createdResponse) as {
    status: string;
    document: { documentId: string; revision: string };
  };
  assert.equal(created.status, "created");
  assert.equal(created.document.documentId, "mcp-equation");

  const actionResponse = await client.callTool({
    name: "equation_list_actions",
    arguments: { documentId: "mcp-equation" },
  });
  const actions = resultValue(actionResponse) as Array<{ id: string; label: string }>;
  const divideByThree = actions.find((action) => action.label === "Divide both sides by 3");
  assert.ok(divideByThree);

  const missingContextResponse = await client.callTool({
    name: "equation_preview_action",
    arguments: {
      documentId: "mcp-equation",
      expectedRevision: created.document.revision,
      actionId: "calculus:differentiate",
      arguments: {},
    },
  });
  assert.equal((missingContextResponse as { isError?: boolean }).isError, true);
  assert.equal((resultValue(missingContextResponse) as { code: string }).code, "needs_context");

  const previewResponse = await client.callTool({
    name: "equation_preview_action",
    arguments: {
      documentId: "mcp-equation",
      expectedRevision: created.document.revision,
      actionId: divideByThree.id,
      arguments: {},
      actorName: "mcp-test",
    },
  });
  const preview = resultValue(previewResponse) as { status: string; previewToken: string };
  assert.equal(preview.status, "previewed");

  const applyResponse = await client.callTool({
    name: "equation_apply_preview",
    arguments: {
      documentId: "mcp-equation",
      previewToken: preview.previewToken,
      requestId: "mcp-apply-1",
      actorName: "mcp-test",
    },
  });
  const applied = resultValue(applyResponse) as {
    status: string;
    event: { actor: { kind: string; name?: string }; animation?: unknown };
  };
  assert.equal(applied.status, "applied");
  assert.deepEqual(applied.event.actor, { kind: "ai", name: "mcp-test" });
  assert.ok(applied.event.animation);

  const historyResource = await client.readResource({
    uri: "visualmath://equations/mcp-equation/history",
  });
  assert.equal(historyResource.contents.length, 1);
  const content = historyResource.contents[0];
  assert.ok("text" in content);
  const history = JSON.parse(content.text) as unknown[];
  assert.equal(history.length, 1);

  const listed = await client.callTool({ name: "equation_list_documents", arguments: {} });
  assert.deepEqual(resultValue(listed), { documentIds: ["mcp-equation"] });

  console.log("equation MCP contract: ok");
} finally {
  await client.close();
  await server.close();
}
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
