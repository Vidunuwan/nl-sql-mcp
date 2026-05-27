import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { UnsafeQueryError } from "../errors.js";
import type { ChartDataset, ChartToolResult, QueryToolResult } from "../types.js";
import type { DatabaseReader } from "./database.js";

const chartInputSchema = z.object({
  sql: z.string().min(1).max(50_000),
  chartType: z.enum(["bar", "line", "pie"]),
  title: z.string().trim().min(1).max(120),
  categoryColumn: z.string().trim().min(1).max(128),
  valueColumn: z.string().trim().min(1).max(128),
});

function textResult(payload: unknown, isError = false) {
  return {
    isError,
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
  };
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : undefined;
  }
  return undefined;
}

function prepareChartResult(
  query: QueryToolResult,
  input: z.infer<typeof chartInputSchema>,
): ChartToolResult {
  const result: ChartToolResult = { ...query, tool: "run_chart_query" };
  if (query.truncated) {
    return { ...result, chartUnavailableReason: "Chart data was truncated." };
  }
  if (!query.columns.includes(input.categoryColumn) || !query.columns.includes(input.valueColumn)) {
    return { ...result, chartUnavailableReason: "Chart columns were not returned by the query." };
  }
  const maximumPoints = input.chartType === "pie" ? 12 : 30;
  if (query.rows.length < 2 || query.rows.length > maximumPoints) {
    return { ...result, chartUnavailableReason: "The result does not have a usable number of chart points." };
  }
  const points: ChartDataset["points"] = [];
  for (const row of query.rows) {
    const rawLabel = row[input.categoryColumn];
    const value = numericValue(row[input.valueColumn]);
    if (rawLabel === null || rawLabel === undefined || value === undefined) {
      return { ...result, chartUnavailableReason: "Chart categories and values must be present and numeric." };
    }
    points.push({ label: String(rawLabel), value });
  }
  if (input.chartType === "pie" && (points.some((point) => point.value < 0) || points.every((point) => point.value === 0))) {
    return { ...result, chartUnavailableReason: "Pie chart values must be non-negative with a positive total." };
  }
  return {
    ...result,
    chart: {
      type: input.chartType,
      title: input.title,
      categoryLabel: input.categoryColumn,
      valueLabel: input.valueColumn,
      points,
    },
  };
}

export function createDatabaseMcpServer(reader: DatabaseReader): McpServer {
  const server = new McpServer({ name: "mysql-read-only", version: "1.0.0" });

  server.registerTool(
    "list_tables",
    {
      description: "List the readable tables and views in the configured MySQL database.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return textResult({ tables: await reader.listTables() });
      } catch {
        return textResult({ error: "DATABASE_ERROR", reason: "Database query failed." }, true);
      }
    },
  );

  server.registerTool(
    "describe_table",
    {
      description: "Describe readable columns for one table or view in the configured MySQL database.",
      inputSchema: z.object({ table: z.string().min(1).max(128) }),
      annotations: { readOnlyHint: true },
    },
    async ({ table }) => {
      try {
        return textResult({ table, columns: await reader.describeTable(table) });
      } catch {
        return textResult({ error: "DATABASE_ERROR", reason: "Database query failed." }, true);
      }
    },
  );

  server.registerTool(
    "run_read_query",
    {
      description:
        "Run exactly one bounded MySQL SELECT query against the configured read-only database. Use only after inspecting relevant tables.",
      inputSchema: z.object({ sql: z.string().min(1).max(50_000) }),
      annotations: { readOnlyHint: true },
    },
    async ({ sql }) => {
      try {
        return textResult(await reader.runReadQuery(sql));
      } catch (error) {
        if (error instanceof UnsafeQueryError) {
          return textResult({ error: "UNSAFE_QUERY", reason: error.reason }, true);
        }
        return textResult({ error: "DATABASE_ERROR", reason: "Database query failed." }, true);
      }
    },
  );

  server.registerTool(
    "run_chart_query",
    {
      description:
        "Run one bounded read-only query and return an optional chart dataset. Use only for meaningful comparisons, trends, or composition results with a category column and numeric value column; do not use for single values or detail listings.",
      inputSchema: chartInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        return textResult(prepareChartResult(await reader.runReadQuery(input.sql), input));
      } catch (error) {
        if (error instanceof UnsafeQueryError) {
          return textResult({ error: "UNSAFE_QUERY", reason: error.reason }, true);
        }
        return textResult({ error: "DATABASE_ERROR", reason: "Database query failed." }, true);
      }
    },
  );

  return server;
}
