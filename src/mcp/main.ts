import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadDatabaseConfig } from "../config.js";
import { MySqlDatabaseReader } from "./database.js";
import { createDatabaseMcpServer } from "./server.js";

async function main(): Promise<void> {
  const reader = new MySqlDatabaseReader(loadDatabaseConfig());
  await reader.ping();
  const server = createDatabaseMcpServer(reader);
  const transport = new StdioServerTransport();

  const close = async () => {
    await server.close();
    await reader.close();
  };
  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "MCP startup failed.";
  console.error(`MCP server failed: ${message}`);
  process.exitCode = 1;
});
