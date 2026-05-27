import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const validEnvironment = {
  OPENAI_API_KEY: "key",
  API_BEARER_TOKEN: "a-bearer-token-that-is-long",
  MYSQL_HOST: "localhost",
  MYSQL_DATABASE: "analytics",
  MYSQL_USER: "reader",
  MYSQL_PASSWORD: "secret",
};

describe("loadConfig", () => {
  it("applies prototype defaults", () => {
    const config = loadConfig(validEnvironment);

    expect(config.openaiModel).toBe("gpt-5.5");
    expect(config.maxQueryRows).toBe(100);
    expect(config.evidencePreviewRows).toBe(20);
    expect(config.sessionTtlMs).toBe(60 * 60_000);
  });

  it("requires credentials and a safe database identifier", () => {
    expect(() => loadConfig({ ...validEnvironment, MYSQL_DATABASE: "x; drop" })).toThrow(
      "Invalid configuration",
    );
    expect(() => loadConfig({ ...validEnvironment, OPENAI_API_KEY: undefined })).toThrow(
      "OPENAI_API_KEY",
    );
  });

  it("prevents evidence limits larger than tool result limits", () => {
    expect(() =>
      loadConfig({ ...validEnvironment, EVIDENCE_PREVIEW_ROWS: "21", MAX_QUERY_ROWS: "20" }),
    ).toThrow("EVIDENCE_PREVIEW_ROWS cannot exceed MAX_QUERY_ROWS");
  });
});
