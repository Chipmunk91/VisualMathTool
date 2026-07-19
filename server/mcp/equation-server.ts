#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createEquationMcpServer } from "./equation-mcp.js";

const { server } = createEquationMcpServer();

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  console.error("Visual Math Equation MCP server running on stdio");
}

main().catch((error: unknown) => {
  console.error("Visual Math Equation MCP server failed:", error);
  process.exit(1);
});
