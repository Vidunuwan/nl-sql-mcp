import { describe, expect, it } from "vitest";

import { UnsafeQueryError } from "../src/errors.js";
import { validateReadQuery } from "../src/sql/validator.js";

describe("validateReadQuery", () => {
  it("permits one select or CTE read in the configured database", () => {
    expect(validateReadQuery("SELECT * FROM analytics.orders;", "analytics").sql).toBe(
      "SELECT * FROM analytics.orders",
    );
    expect(
      validateReadQuery(
        "WITH recent AS (SELECT id FROM orders) SELECT id FROM recent",
        "analytics",
      ).sql,
    ).toContain("WITH recent");
  });

  it.each([
    "UPDATE orders SET status = 'paid'",
    "DELETE FROM orders",
    "SELECT 1; SELECT 2",
    "SELECT * FROM private_db.customers",
    "SELECT * FROM orders INTO OUTFILE '/tmp/orders.csv'",
    "SELECT * FROM orders FOR UPDATE",
    "SELECT SLEEP(10)",
    "SELECT BENCHMARK(1000, SHA2('x', 256))",
    "SELECT LOAD_FILE('/etc/passwd')",
    "SELECT GET_LOCK('agent', 10)",
    "SELECT 1 /*!50000 INTO OUTFILE '/tmp/leak' */",
    "SELECT 1 -- generated comment",
  ])("rejects unsafe SQL: %s", (sql) => {
    expect(() => validateReadQuery(sql, "analytics")).toThrow(UnsafeQueryError);
  });

  it("does not reject prohibited words inside data values", () => {
    expect(
      validateReadQuery(
        "SELECT 'FOR UPDATE' AS label, 'INTO OUTFILE' AS note, '#tag -- note' AS text",
        "analytics",
      ).sql,
    ).toContain("FOR UPDATE");
  });
});
