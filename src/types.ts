export type ChartDataset = {
  type: "bar" | "line" | "pie";
  title: string;
  categoryLabel: string;
  valueLabel: string;
  points: Array<{
    label: string;
    value: number;
  }>;
};

export type Evidence = {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  chart?: ChartDataset;
};

export type QueryToolResult = Evidence & {
  tool: "run_read_query";
};

export type ChartToolResult = Evidence & {
  tool: "run_chart_query";
  chart?: ChartDataset;
  chartUnavailableReason?: string;
};
