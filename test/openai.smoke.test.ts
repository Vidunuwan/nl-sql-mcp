import { MemorySession } from "@openai/agents";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OpenAiSqlAgentRuntime } from "../src/agent/runtime.js";
import { loadConfig } from "../src/config.js";

const enabled = process.env.RUN_OPENAI_SMOKE === "1";

describe.runIf(enabled)("OpenAI SQL agent smoke test", () => {
  let runtime: OpenAiSqlAgentRuntime;

  beforeAll(async () => {
    runtime = new OpenAiSqlAgentRuntime(loadConfig());
    await runtime.start();
  });

  afterAll(async () => runtime?.close());

  it("answers a database question using MCP evidence", async () => {
    const question = process.env.SMOKE_TEST_QUESTION;
    if (!question) {
      throw new Error("SMOKE_TEST_QUESTION is required when RUN_OPENAI_SMOKE=1.");
    }
    const answer = await runtime.answer(question, new MemorySession());
    expect(answer.answer.length).toBeGreaterThan(0);
    expect(answer.toolCalls).toContain("run_read_query");
    expect(answer.evidence.length).toBeGreaterThan(0);
  }, 60_000);
});
