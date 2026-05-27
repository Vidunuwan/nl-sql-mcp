import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { UnsafeQueryError } from "../src/errors.js";
import type { DatabaseReader } from "../src/mcp/database.js";
import { createDatabaseMcpServer } from "../src/mcp/server.js";

const textToolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  isError: z.boolean().optional(),
});

function firstTextContent(result: z.infer<typeof textToolResultSchema>): { type: "text"; text: string } {
  const text = result.content[0];
  if (!text) {
    throw new Error("Expected MCP text content.");
  }
  return text;
}

describe("database MCP server", () => {
  let client: Client;
  let closeServer: () => Promise<void>;
  let reader: DatabaseReader;

  beforeEach(async () => {
    reader = {
      ping: vi.fn(async () => undefined),
      listTables: vi.fn(async () => [{ name: "orders", type: "BASE TABLE" }]),
      describeTable: vi.fn(async () => [
        { name: "id", dataType: "int", nullable: false },
      ]),
      runReadQuery: vi.fn(async () => ({
        tool: "run_read_query" as const,
        sql: "SELECT id FROM orders",
        columns: ["id"],
        rows: [{ id: 7 }],
        rowCount: 1,
        truncated: false,
      })),
      close: vi.fn(async () => undefined),
    };
    const server = createDatabaseMcpServer(reader);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeServer = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => closeServer());

  it("only exposes the read tools", async () => {
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "describe_table",
      "list_tables",
      "run_chart_query",
      "run_read_query",
    ]);
  });

  it("returns query evidence as machine-readable text", async () => {
    const result = textToolResultSchema.parse(
      await client.callTool({
        name: "run_read_query",
        arguments: { sql: "SELECT id FROM orders" },
      }),
    );
    const text = firstTextContent(result);
    expect(text.type).toBe("text");
    if (text.type === "text") {
      expect(JSON.parse(text.text)).toMatchObject({
        tool: "run_read_query",
        sql: "SELECT id FROM orders",
        rowCount: 1,
      });
    }
  });

  it("returns a safe rejection without executing a mutation", async () => {
    vi.mocked(reader.runReadQuery).mockRejectedValueOnce(new UnsafeQueryError("Only reads."));
    const result = textToolResultSchema.parse(
      await client.callTool({
        name: "run_read_query",
        arguments: { sql: "DELETE FROM orders" },
      }),
    );
    expect(result.isError).toBe(true);
    const text = firstTextContent(result);
    if (text.type === "text") {
      expect(JSON.parse(text.text)).toEqual({ error: "UNSAFE_QUERY", reason: "Only reads." });
    }
  });

  it("returns chart data only for usable numeric result sets", async () => {
    vi.mocked(reader.runReadQuery).mockResolvedValueOnce({
      tool: "run_read_query",
      sql: "SELECT month, revenue FROM monthly_revenue",
      columns: ["month", "revenue"],
      rows: [
        { month: "Jan", revenue: "100.50" },
        { month: "Feb", revenue: 130 },
      ],
      rowCount: 2,
      truncated: false,
    });
    const rendered = textToolResultSchema.parse(
      await client.callTool({
        name: "run_chart_query",
        arguments: {
          sql: "SELECT month, revenue FROM monthly_revenue",
          chartType: "line",
          title: "Monthly revenue",
          categoryColumn: "month",
          valueColumn: "revenue",
        },
      }),
    );
    expect(JSON.parse(firstTextContent(rendered).text)).toMatchObject({
      tool: "run_chart_query",
      chart: {
        type: "line",
        points: [
          { label: "Jan", value: 100.5 },
          { label: "Feb", value: 130 },
        ],
      },
    });

    const unavailable = textToolResultSchema.parse(
      await client.callTool({
        name: "run_chart_query",
        arguments: {
          sql: "SELECT id FROM orders",
          chartType: "bar",
          title: "Orders",
          categoryColumn: "id",
          valueColumn: "id",
        },
      }),
    );
    expect(JSON.parse(firstTextContent(unavailable).text)).toMatchObject({
      tool: "run_chart_query",
      chartUnavailableReason: "The result does not have a usable number of chart points.",
    });
  });

  it("represents metadata connection failures as database tool errors", async () => {
    vi.mocked(reader.listTables).mockRejectedValueOnce(new Error("offline"));
    const result = textToolResultSchema.parse(
      await client.callTool({ name: "list_tables", arguments: {} }),
    );
    expect(result.isError).toBe(true);
    const text = firstTextContent(result);
    if (text.type === "text") {
      expect(JSON.parse(text.text)).toEqual({
        error: "DATABASE_ERROR",
        reason: "Database query failed.",
      });
    }
  });
});
