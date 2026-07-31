import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createEquationMcpServer } from "../server/mcp/equation-mcp";
import type { ProtocolRelationAnalysis } from "../src/tools/equation-builder/protocol";
import { printTreeEq, type TreeEq } from "../src/tools/equation-builder/tree";

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

  const createAndAnalyze = async (
    text: string,
    documentId: string
  ): Promise<ProtocolRelationAnalysis> => {
    const createResponse = await client.callTool({
      name: "equation_create",
      arguments: { text, documentId },
    });
    assert.equal((resultValue(createResponse) as { status: string }).status, "created");
    const analyzeResponse = await client.callTool({
      name: "equation_analyze",
      arguments: { documentId },
    });
    assert.notEqual((analyzeResponse as { isError?: boolean }).isError, true);
    return resultValue(analyzeResponse) as ProtocolRelationAnalysis;
  };

  const squareRootAnalysis = await createAndAnalyze(
    "x = sqrt(-1)",
    "mcp-complex-square-root"
  );
  assert.deepEqual(
    squareRootAnalysis.semantics?.[0].inferredMemberships.map(({ symbol, space }) => ({
      symbol,
      space,
    })),
    [{ symbol: "x", space: "complex" }]
  );

  const explicitComplexAnalysis = await createAndAnalyze(
    "z = 3 + 4*i",
    "mcp-explicit-complex"
  );
  assert.deepEqual(
    explicitComplexAnalysis.semantics?.[0].expression.closedValue,
    { kind: "complex", re: 3, im: 4 }
  );

  const squareFunctionAnalysis = await createAndAnalyze(
    "f(x) = x^2",
    "mcp-square-function"
  );
  const signatures = squareFunctionAnalysis.semantics?.[0].mappingCandidates ?? [];
  const realSignature = signatures.find((signature) => signature.lens === "default-real");
  const complexSignature = signatures.find((signature) => signature.lens === "complex-alternative");
  assert.deepEqual(
    {
      input: realSignature?.inputs,
      output: realSignature?.output.space,
      range: realSignature?.range,
    },
    {
      input: [{ symbol: "x", space: "real" }],
      output: "real",
      range: {
        status: "exact",
        set: { kind: "real", subset: "nonnegative" },
        rule: "square",
      },
    }
  );
  assert.deepEqual(
    {
      input: complexSignature?.inputs,
      output: complexSignature?.output.space,
      range: complexSignature?.range,
    },
    {
      input: [{ symbol: "x", space: "complex" }],
      output: "complex",
      range: {
        status: "exact",
        set: { kind: "complex", subset: "all" },
        rule: "square",
      },
    }
  );
  const squareView = squareFunctionAnalysis.relation.viewCandidates.find(
    (candidate) => candidate.spec.kind === "function-1d"
  );
  assert.ok(squareView && complexSignature);
  const squareSnapshotResponse = await client.callTool({
    name: "equation_get",
    arguments: { documentId: "mcp-square-function" },
  });
  const squareSnapshot = resultValue(squareSnapshotResponse) as {
    document: { revision: string };
  };
  const setComplexViewResponse = await client.callTool({
    name: "equation_set_view",
    arguments: {
      documentId: "mcp-square-function",
      expectedRevision: squareSnapshot.document.revision,
      candidateId: squareView.id,
      mappingSignatureId: complexSignature.id,
      complexDisplay: "exponential",
    },
  });
  const setComplexView = resultValue(setComplexViewResponse) as {
    status: string;
    document: {
      presentation?: {
        mappingSignatureId?: string;
        complexDisplay?: string;
      };
    };
  };
  assert.equal(setComplexView.status, "updated");
  assert.equal(setComplexView.document.presentation?.mappingSignatureId, complexSignature.id);
  assert.equal(setComplexView.document.presentation?.complexDisplay, "exponential");

  const cubeCreateResponse = await client.callTool({
    name: "equation_create",
    arguments: { text: "f(x) = x^3", documentId: "mcp-complex-cube" },
  });
  const cubeCreated = resultValue(cubeCreateResponse) as {
    status: string;
    document: { revision: string };
  };
  assert.equal(cubeCreated.status, "created");
  const cubeAnalyzeResponse = await client.callTool({
    name: "equation_analyze",
    arguments: { documentId: "mcp-complex-cube" },
  });
  const cubeAnalysis = resultValue(cubeAnalyzeResponse) as ProtocolRelationAnalysis;
  const cubeView = cubeAnalysis.relation.viewCandidates.find(
    (candidate) => candidate.spec.kind === "function-1d"
  );
  const cubeMapping = cubeAnalysis.semantics[0]?.mappingCandidates.find(
    (candidate) => candidate.lens === "complex-alternative"
  );
  assert.ok(cubeView && cubeMapping);
  const cubeSetView = resultValue(await client.callTool({
    name: "equation_set_view",
    arguments: {
      documentId: "mcp-complex-cube",
      expectedRevision: cubeCreated.document.revision,
      candidateId: cubeView.id,
      mappingSignatureId: cubeMapping.id,
    },
  })) as { status: string };
  assert.equal(cubeSetView.status, "updated");
  const cubeActions = resultValue(await client.callTool({
    name: "equation_list_actions",
    arguments: { documentId: "mcp-complex-cube" },
  })) as Array<{
    id: string;
    label: string;
    operationContext: { scalarRealm: string; mappingSignatureId?: string };
    warnings: string[];
  }>;
  const cubeRoot = cubeActions.find(
    (action) => action.label === "Take the cube root of both sides"
  );
  assert.ok(cubeRoot);
  assert.deepEqual(cubeRoot.operationContext, {
    scalarRealm: "complex",
    mappingSignatureId: cubeMapping.id,
  });
  assert.ok(cubeRoot.warnings.some((warning) => warning.includes("principal root")));
  const cubePreview = resultValue(await client.callTool({
    name: "equation_preview_action",
    arguments: {
      documentId: "mcp-complex-cube",
      expectedRevision: cubeCreated.document.revision,
      actionId: cubeRoot.id,
      arguments: {},
      operationContext: cubeRoot.operationContext,
      actorName: "mcp-test",
    },
  })) as {
    status: string;
    after: TreeEq;
    operationContext: { scalarRealm: string; mappingSignatureId?: string };
    warnings: string[];
  };
  assert.equal(cubePreview.status, "previewed");
  assert.equal(printTreeEq(cubePreview.after), "³√(f) = ³√(x³)");
  assert.deepEqual(cubePreview.operationContext, cubeRoot.operationContext);
  assert.ok(cubePreview.warnings.some((warning) => warning.includes("principal root")));

  const semanticResource = await client.readResource({
    uri: "visualmath://equations/mcp-square-function/analysis",
  });
  const semanticContent = semanticResource.contents[0];
  assert.ok("text" in semanticContent);
  const resourceAnalysis = JSON.parse(semanticContent.text) as ProtocolRelationAnalysis;
  assert.deepEqual(resourceAnalysis.semantics, squareFunctionAnalysis.semantics);

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
