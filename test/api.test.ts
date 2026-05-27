import type { MemorySession } from "@openai/agents";
import { describe, expect, it, vi } from "vitest";

import type { AgentAnswer, AgentRuntime } from "../src/agent/runtime.js";
import { buildApp } from "../src/api/app.js";
import { DependencyError, UnsafeDatabaseRequestError } from "../src/errors.js";
import { SessionStore } from "../src/sessions/store.js";
import { testConfig } from "./fixtures.js";

class MockRuntime implements AgentRuntime {
  constructor(public ready = true) {}

  readonly answerMock = vi.fn<(message: string, session: MemorySession) => Promise<AgentAnswer>>(
    async () => ({
      answer: "There are 2 orders.",
      evidence: [
        {
          sql: "SELECT COUNT(*) AS count FROM orders",
          columns: ["count"],
          rows: [{ count: 2 }],
          rowCount: 1,
          truncated: false,
        },
      ],
      toolCalls: ["list_tables", "run_read_query"],
    }),
  );

  async start(): Promise<void> {}
  async close(): Promise<void> {}
  isReady(): boolean {
    return this.ready;
  }
  async checkReady(): Promise<boolean> {
    return this.ready;
  }
  answer(message: string, session: MemorySession): Promise<AgentAnswer> {
    return this.answerMock(message, session);
  }
}

const bearer = { authorization: "Bearer test-bearer-token-long-enough" };

describe("API", () => {
  it("serves liveness and readiness without database detail", async () => {
    const app = buildApp({ config: testConfig(), runtime: new MockRuntime(), logger: false });
    const dashboard = await app.inject({ method: "GET", url: "/" });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.headers["content-type"]).toContain("text/html");
    expect(dashboard.body).toContain("SignalSQL Console");
    expect((await app.inject({ method: "GET", url: "/healthz" })).json()).toEqual({
      status: "ok",
    });
    expect((await app.inject({ method: "GET", url: "/readyz" })).json()).toEqual({
      status: "ready",
    });
    await app.close();
  });

  it("rejects unauthenticated session requests", async () => {
    const app = buildApp({ config: testConfig(), runtime: new MockRuntime(), logger: false });
    const response = await app.inject({ method: "POST", url: "/v1/sessions" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
    await app.close();
  });

  it("creates a session and answers a follow-up message with evidence", async () => {
    const runtime = new MockRuntime();
    const app = buildApp({ config: testConfig(), runtime, logger: false });
    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: bearer,
    });
    const { sessionId } = created.json();

    const response = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/messages`,
      headers: bearer,
      payload: { message: "How many orders exist?" },
    });

    expect(created.statusCode).toBe(201);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessionId,
      answer: "There are 2 orders.",
      evidence: [{ sql: "SELECT COUNT(*) AS count FROM orders", rowCount: 1 }],
    });
    expect(runtime.answerMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects invalid input and expired sessions", async () => {
    let now = new Date("2026-05-26T00:00:00.000Z");
    const sessions = new SessionStore(100, () => now);
    const app = buildApp({
      config: testConfig(),
      runtime: new MockRuntime(),
      sessionStore: sessions,
      logger: false,
    });
    const sessionId = sessions.create().sessionId;
    const invalid = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/messages`,
      headers: bearer,
      payload: { message: " " },
    });
    expect(invalid.statusCode).toBe(400);

    now = new Date("2026-05-26T00:00:00.101Z");
    const expired = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/messages`,
      headers: bearer,
      payload: { message: "Question" },
    });
    expect(expired.statusCode).toBe(404);
    await app.close();
  });

  it("maps unsafe queries and upstream failures to consistent API errors", async () => {
    const runtime = new MockRuntime();
    const app = buildApp({ config: testConfig(), runtime, logger: false });
    const create = await app.inject({ method: "POST", url: "/v1/sessions", headers: bearer });
    const { sessionId } = create.json();

    runtime.answerMock.mockRejectedValueOnce(new UnsafeDatabaseRequestError("Read only."));
    const rejected = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/messages`,
      headers: bearer,
      payload: { message: "Delete records" },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.code).toBe("UNSAFE_QUERY");

    runtime.answerMock.mockRejectedValueOnce(new DependencyError());
    const failed = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/messages`,
      headers: bearer,
      payload: { message: "Count records" },
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.code).toBe("UPSTREAM_FAILURE");
    await app.close();
  });

  it("reports unavailable runtime through readiness and question requests", async () => {
    const runtime = new MockRuntime(false);
    const app = buildApp({ config: testConfig(), runtime, logger: false });
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(503);
    const session = await app.inject({ method: "POST", url: "/v1/sessions", headers: bearer });
    const response = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.json().sessionId}/messages`,
      headers: bearer,
      payload: { message: "Count orders" },
    });
    expect(response.statusCode).toBe(502);
    await app.close();
  });
});
