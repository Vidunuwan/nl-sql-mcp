import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.5"),
  API_BEARER_TOKEN: z.string().min(16),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: z.coerce.number().int().positive().max(65535).default(3306),
  MYSQL_DATABASE: z.string().regex(/^[A-Za-z0-9_$]+$/),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string(),
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().positive().max(50).default(5),
  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(10_000),
  MAX_QUERY_ROWS: z.coerce.number().int().positive().max(1_000).default(100),
  EVIDENCE_PREVIEW_ROWS: z.coerce.number().int().positive().max(100).default(20),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(60),
  MAX_MESSAGE_LENGTH: z.coerce.number().int().positive().max(50_000).default(4_000),
});

export type AppConfig = {
  openaiApiKey: string;
  openaiModel: string;
  apiBearerToken: string;
  host: string;
  port: number;
  mysql: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    connectionLimit: number;
  };
  queryTimeoutMs: number;
  maxQueryRows: number;
  evidencePreviewRows: number;
  sessionTtlMs: number;
  maxMessageLength: number;
};

export type DatabaseConfig = Pick<
  AppConfig,
  "mysql" | "queryTimeoutMs" | "maxQueryRows"
>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(environment);
  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${fields}`);
  }

  const env = result.data;
  if (env.EVIDENCE_PREVIEW_ROWS > env.MAX_QUERY_ROWS) {
    throw new Error("Invalid configuration: EVIDENCE_PREVIEW_ROWS cannot exceed MAX_QUERY_ROWS");
  }

  return {
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    apiBearerToken: env.API_BEARER_TOKEN,
    host: env.HOST,
    port: env.PORT,
    mysql: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      database: env.MYSQL_DATABASE,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      connectionLimit: env.MYSQL_CONNECTION_LIMIT,
    },
    queryTimeoutMs: env.QUERY_TIMEOUT_MS,
    maxQueryRows: env.MAX_QUERY_ROWS,
    evidencePreviewRows: env.EVIDENCE_PREVIEW_ROWS,
    sessionTtlMs: env.SESSION_TTL_MINUTES * 60_000,
    maxMessageLength: env.MAX_MESSAGE_LENGTH,
  };
}

export function loadDatabaseConfig(environment: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const requiredForMcp = {
    OPENAI_API_KEY: environment.OPENAI_API_KEY ?? "mcp-process-does-not-use-openai",
    API_BEARER_TOKEN: environment.API_BEARER_TOKEN ?? "mcp-process-does-not-use-api-auth",
    ...environment,
  };
  const config = loadConfig(requiredForMcp);
  return {
    mysql: config.mysql,
    queryTimeoutMs: config.queryTimeoutMs,
    maxQueryRows: config.maxQueryRows,
  };
}
