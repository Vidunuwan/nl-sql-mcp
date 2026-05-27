import { fileURLToPath } from "node:url";

import {
  Agent,
  MCPServerStdio,
  type MemorySession,
  type RunItem,
  run,
} from "@openai/agents";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import { DependencyError, UnsafeDatabaseRequestError } from "../errors.js";
import type { Evidence } from "../types.js";

const chartDatasetSchema = z.object({
  type: z.enum(["bar", "line", "pie"]),
  title: z.string(),
  categoryLabel: z.string(),
  valueLabel: z.string(),
  points: z.array(z.object({ label: z.string(), value: z.number().finite() })),
});

const queryToolResultSchema = z.object({
  tool: z.enum(["run_read_query", "run_chart_query"]),
  sql: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  rowCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  chart: chartDatasetSchema.optional(),
});

const toolFailureSchema = z.object({
  error: z.enum(["UNSAFE_QUERY", "DATABASE_ERROR"]),
  reason: z.string(),
});

export type AgentAnswer = {
  answer: string;
  evidence: Evidence[];
  toolCalls: string[];
};

export interface AgentRuntime {
  start(): Promise<void>;
  close(): Promise<void>;
  isReady(): boolean;
  checkReady(): Promise<boolean>;
  answer(message: string, session: MemorySession): Promise<AgentAnswer>;
}

function textToolOutput(output: unknown): string | undefined {
  if (typeof output === "string") {
    return output;
  }
  if (
    typeof output === "object" &&
    output !== null &&
    "type" in output &&
    output.type === "text" &&
    "text" in output &&
    typeof output.text === "string"
  ) {
    return output.text;
  }
  return undefined;
}

export function extractAgentArtifacts(
  items: RunItem[],
  evidencePreviewRows: number,
): Pick<AgentAnswer, "evidence" | "toolCalls"> & { failure?: z.infer<typeof toolFailureSchema> } {
  const evidence: Evidence[] = [];
  const toolCalls: string[] = [];
  let failure: z.infer<typeof toolFailureSchema> | undefined;

  for (const item of items) {
    if (item.type === "tool_call_item" && item.rawItem.type === "function_call") {
      toolCalls.push(item.rawItem.name);
    }
    if (item.type !== "tool_call_output_item") {
      continue;
    }
    const text = textToolOutput(item.output);
    if (!text) {
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      continue;
    }

    const parsedFailure = toolFailureSchema.safeParse(data);
    if (parsedFailure.success) {
      failure = parsedFailure.data;
      continue;
    }
    const parsedEvidence = queryToolResultSchema.safeParse(data);
    if (!parsedEvidence.success) {
      continue;
    }
    const result = parsedEvidence.data;
    const visibleChart =
      result.chart && result.chart.points.length <= evidencePreviewRows ? result.chart : undefined;
    evidence.push({
      sql: result.sql,
      columns: result.columns,
      rows: result.rows.slice(0, evidencePreviewRows),
      rowCount: result.rowCount,
      truncated: result.truncated || result.rows.length > evidencePreviewRows,
      ...(visibleChart ? { chart: visibleChart } : {}),
    });
  }
  return { evidence, toolCalls, failure };
}

function mcpChildEnvironment(config: AppConfig): Record<string, string> {
  return {
    MYSQL_HOST: config.mysql.host,
    MYSQL_PORT: String(config.mysql.port),
    MYSQL_DATABASE: config.mysql.database,
    MYSQL_USER: config.mysql.user,
    MYSQL_PASSWORD: config.mysql.password,
    MYSQL_CONNECTION_LIMIT: String(config.mysql.connectionLimit),
    QUERY_TIMEOUT_MS: String(config.queryTimeoutMs),
    MAX_QUERY_ROWS: String(config.maxQueryRows),
    EVIDENCE_PREVIEW_ROWS: String(config.evidencePreviewRows),
  };
}

function mcpCommand(): { command: string; args: string[] } {
  const sourceMode = fileURLToPath(import.meta.url).endsWith(".ts");
  const entrypoint = fileURLToPath(
    new URL(sourceMode ? "../mcp/main.ts" : "../mcp/main.js", import.meta.url),
  );
  return {
    command: process.execPath,
    args: sourceMode ? ["--import", "tsx", entrypoint] : [entrypoint],
  };
}

export class OpenAiSqlAgentRuntime implements AgentRuntime {
  private server?: MCPServerStdio;
  private agent?: Agent;
  private ready = false;

  constructor(private readonly config: AppConfig) {}

  async start(): Promise<void> {
    const launch = mcpCommand();
    const server = new MCPServerStdio({
      name: "mysql-read-only",
      command: launch.command,
      args: launch.args,
      env: mcpChildEnvironment(this.config),
      cacheToolsList: true,
      timeout: this.config.queryTimeoutMs + 2_000,
      clientSessionTimeoutSeconds: 10,
      errorFunction: null,
    });
    this.server = server;
    try {
      await server.connect();
      await server.listTools();
    } catch (error) {
      this.server = undefined;
      await server.close().catch(() => undefined);
      throw error;
    }

    this.agent = new Agent({
      name: "Read-only SQL analyst",
      model: this.config.openaiModel,
      instructions: [
        "Answer questions using only the configured MySQL MCP tools when database facts are required.",
        "Inspect tables and column definitions as needed, then use an appropriate query tool for grounded data answers.",
        `When a result is naturally suited to a visual comparison, trend, or composition, or the user requests a chart, use run_chart_query instead of run_read_query with a category column and numeric value column. Charts must contain no more than ${this.config.evidencePreviewRows} points. Do not generate charts for scalar values, unstructured records, or overly large result sets.`,
        "You have read-only access. Never attempt INSERT, UPDATE, DELETE, DDL, administrative statements, file export, locking reads, or access outside the configured database.",
        "Do not invent results. If the requested answer cannot be obtained safely from available data, say so or ask a concise clarifying question.",
        "Do not include generated SQL in your prose answer; the API exposes validated query evidence separately.",
        "Keep final answers concise and accurately reflect tool results.",
      ].join("\n"),
      mcpServers: [server],
      mcpConfig: { convertSchemasToStrict: true },
    });
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async checkReady(): Promise<boolean> {
    if (!this.server || !this.ready) {
      return false;
    }
    try {
      const output = await this.server.callTool("list_tables", null);
      const text = output.length === 1 ? textToolOutput(output[0]) : undefined;
      if (!text) {
        return false;
      }
      const payload: unknown = JSON.parse(text);
      return z.object({ tables: z.array(z.unknown()) }).safeParse(payload).success;
    } catch {
      return false;
    }
  }

  async answer(message: string, session: MemorySession): Promise<AgentAnswer> {
    if (!this.agent || !this.ready) {
      throw new DependencyError("The database agent is not ready.");
    }
    try {
      const result = await run(this.agent, message, { session, maxTurns: 8 });
      const artifacts = extractAgentArtifacts(result.newItems, this.config.evidencePreviewRows);
      if (artifacts.failure?.error === "UNSAFE_QUERY") {
        throw new UnsafeDatabaseRequestError(artifacts.failure.reason);
      }
      if (artifacts.failure?.error === "DATABASE_ERROR") {
        throw new DependencyError("The database query could not be completed.");
      }
      return {
        answer: result.finalOutput ?? "No answer was produced.",
        evidence: artifacts.evidence,
        toolCalls: artifacts.toolCalls,
      };
    } catch (error) {
      if (error instanceof UnsafeDatabaseRequestError || error instanceof DependencyError) {
        throw error;
      }
      throw new DependencyError("The agent request could not be completed.");
    }
  }

  async close(): Promise<void> {
    this.ready = false;
    if (this.server) {
      await this.server.close();
      this.server = undefined;
    }
  }
}
