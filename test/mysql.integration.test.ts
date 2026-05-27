import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DatabaseConfig } from "../src/config.js";
import { UnsafeQueryError } from "../src/errors.js";
import { MySqlDatabaseReader } from "../src/mcp/database.js";

const enabled = process.env.RUN_MYSQL_INTEGRATION === "1";

describe.runIf(enabled)("MySQL read-only integration", () => {
  let reader: MySqlDatabaseReader;

  beforeAll(async () => {
    const config: DatabaseConfig = {
      mysql: {
        host: process.env.TEST_MYSQL_HOST ?? "127.0.0.1",
        port: Number(process.env.TEST_MYSQL_PORT ?? 3306),
        database: process.env.TEST_MYSQL_DATABASE ?? "",
        user: process.env.TEST_MYSQL_USER ?? "",
        password: process.env.TEST_MYSQL_PASSWORD ?? "",
        connectionLimit: 1,
      },
      queryTimeoutMs: 10_000,
      maxQueryRows: 2,
    };
    reader = new MySqlDatabaseReader(config);
    await reader.ping();
  });

  afterAll(async () => reader?.close());

  it("executes reads and enforces result caps", async () => {
    const result = await reader.runReadQuery(
      "SELECT 1 AS id UNION ALL SELECT 2 AS id UNION ALL SELECT 3 AS id",
    );
    expect(result.sql).toBe("SELECT 1 AS id UNION ALL SELECT 2 AS id UNION ALL SELECT 3 AS id");
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.truncated).toBe(true);
  });

  it("reads configured schema metadata when a test table is supplied", async () => {
    const table = process.env.TEST_MYSQL_TABLE;
    if (!table) {
      return;
    }
    expect((await reader.listTables()).some((item) => item.name === table)).toBe(true);
    expect((await reader.describeTable(table)).length).toBeGreaterThan(0);
  });

  it("rejects mutations before they reach MySQL", async () => {
    await expect(reader.runReadQuery("DELETE FROM records")).rejects.toBeInstanceOf(
      UnsafeQueryError,
    );
  });
});
