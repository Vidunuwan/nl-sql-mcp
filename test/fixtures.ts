import type { AppConfig } from "../src/config.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    openaiApiKey: "test-openai-key",
    openaiModel: "gpt-5.5",
    apiBearerToken: "test-bearer-token-long-enough",
    host: "127.0.0.1",
    port: 3000,
    mysql: {
      host: "127.0.0.1",
      port: 3306,
      database: "analytics",
      user: "reader",
      password: "secret",
      connectionLimit: 2,
    },
    queryTimeoutMs: 10_000,
    maxQueryRows: 100,
    evidencePreviewRows: 20,
    sessionTtlMs: 60_000,
    maxMessageLength: 4_000,
    ...overrides,
  };
}
