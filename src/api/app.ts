import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { z } from "zod";

import type { AgentRuntime } from "../agent/runtime.js";
import type { AppConfig } from "../config.js";
import { AppError, DependencyError } from "../errors.js";
import { SessionStore } from "../sessions/store.js";

export type BuildAppOptions = {
  config: AppConfig;
  runtime: AgentRuntime;
  sessionStore?: SessionStore;
  logger?: boolean;
};

function authorized(headerValue: string | undefined, token: string): boolean {
  if (!headerValue) {
    return false;
  }
  const actual = Buffer.from(headerValue);
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { config, runtime } = options;
  const sessions = options.sessionStore ?? new SessionStore(config.sessionTtlMs);
  const app = Fastify({ logger: options.logger ?? true });
  const messageSchema = z
    .object({ message: z.string().trim().min(1).max(config.maxMessageLength) })
    .strict();
  const sessionParamsSchema = z.object({ sessionId: z.string().uuid() });

  const authenticate = async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!authorized(request.headers.authorization, config.apiBearerToken)) {
      throw new AppError(401, "UNAUTHORIZED", "A valid bearer token is required.");
    }
  };

  app.addHook("onReady", async () => runtime.start());
  app.addHook("onClose", async () => runtime.close());

  app.get("/", async (_request, reply) => {
    const dashboard = await readFile(new URL("../../index.html", import.meta.url), "utf8");
    return reply.type("text/html; charset=utf-8").send(dashboard);
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (_request, reply) => {
    if (!(await runtime.checkReady())) {
      return reply.status(503).send({ status: "not_ready" });
    }
    return { status: "ready" };
  });

  app.post("/v1/sessions", { preHandler: authenticate }, async (_request, reply) => {
    const session = sessions.create();
    return reply.status(201).send({
      sessionId: session.sessionId,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  app.post(
    "/v1/sessions/:sessionId/messages",
    { preHandler: authenticate },
    async (request, reply) => {
      const startedAt = performance.now();
      const parsedParams = sessionParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        throw new AppError(400, "INVALID_REQUEST", "A valid session ID is required.");
      }
      const { sessionId } = parsedParams.data;
      const session = sessions.get(sessionId);
      if (!session) {
        throw new AppError(404, "SESSION_NOT_FOUND", "The session is missing or expired.");
      }
      const parsedBody = messageSchema.safeParse(request.body);
      if (!parsedBody.success) {
        throw new AppError(400, "INVALID_REQUEST", "A non-empty message is required.");
      }
      try {
        if (!runtime.isReady()) {
          throw new DependencyError("The database agent is unavailable.");
        }
        const result = await runtime.answer(parsedBody.data.message, session.session);
        let queryEvidenceIndex = 0;
        for (const tool of result.toolCalls) {
          const matchingEvidence =
            tool === "run_read_query" || tool === "run_chart_query"
              ? result.evidence[queryEvidenceIndex++]
              : undefined;
          request.log.info(
            {
              requestId: request.id,
              sessionId,
              tool,
              rowCount: matchingEvidence?.rowCount,
            },
            "MCP tool completed",
          );
        }
        return reply.send({
          sessionId,
          answer: result.answer,
          evidence: result.evidence,
        });
      } catch (error) {
        if (error instanceof AppError && error.code === "UNSAFE_QUERY") {
          request.log.warn(
            { requestId: request.id, sessionId, rejectedReason: error.message },
            "MCP query rejected",
          );
        }
        throw error;
      } finally {
        request.log.info(
          { requestId: request.id, sessionId, latencyMs: performance.now() - startedAt },
          "Agent request completed",
        );
      }
    },
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }
    request.log.error({ err: error }, "Unhandled API failure");
    return reply.status(502).send({
      error: { code: "UPSTREAM_FAILURE", message: "The request could not be completed." },
    });
  });

  return app;
}
