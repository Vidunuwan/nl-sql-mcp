import type { RunItem } from "@openai/agents";
import { describe, expect, it } from "vitest";

import { extractAgentArtifacts } from "../src/agent/runtime.js";

function runItem(value: object): RunItem {
  return value as RunItem;
}

describe("extractAgentArtifacts", () => {
  it("returns bounded evidence from query tool outputs", () => {
    const items = [
      runItem({
        type: "tool_call_item",
        rawItem: { type: "function_call", name: "run_read_query" },
      }),
      runItem({
        type: "tool_call_output_item",
        output: {
          type: "text",
          text: JSON.stringify({
            tool: "run_read_query",
            sql: "SELECT id FROM orders",
            columns: ["id"],
            rows: [{ id: 1 }, { id: 2 }],
            rowCount: 2,
            truncated: false,
          }),
        },
      }),
    ];

    expect(extractAgentArtifacts(items, 1)).toEqual({
      evidence: [
        {
          sql: "SELECT id FROM orders",
          columns: ["id"],
          rows: [{ id: 1 }],
          rowCount: 2,
          truncated: true,
        },
      ],
      toolCalls: ["run_read_query"],
      failure: undefined,
    });
  });

  it("detects MCP rejection results", () => {
    const output = runItem({
      type: "tool_call_output_item",
      output: JSON.stringify({ error: "UNSAFE_QUERY", reason: "Read only." }),
    });

    expect(extractAgentArtifacts([output], 20).failure).toEqual({
      error: "UNSAFE_QUERY",
      reason: "Read only.",
    });
  });

  it("returns chart datasets only when all points fit the evidence preview", () => {
    const output = runItem({
      type: "tool_call_output_item",
      output: JSON.stringify({
        tool: "run_chart_query",
        sql: "SELECT month, revenue FROM monthly_revenue",
        columns: ["month", "revenue"],
        rows: [
          { month: "Jan", revenue: 100 },
          { month: "Feb", revenue: 120 },
        ],
        rowCount: 2,
        truncated: false,
        chart: {
          type: "line",
          title: "Monthly revenue",
          categoryLabel: "month",
          valueLabel: "revenue",
          points: [
            { label: "Jan", value: 100 },
            { label: "Feb", value: 120 },
          ],
        },
      }),
    });

    expect(extractAgentArtifacts([output], 2).evidence[0]?.chart?.points).toHaveLength(2);
    expect(extractAgentArtifacts([output], 1).evidence[0]?.chart).toBeUndefined();
  });
});
