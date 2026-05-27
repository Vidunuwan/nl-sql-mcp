import sqlParser from "node-sql-parser";

import { UnsafeQueryError } from "../errors.js";

const { Parser } = sqlParser;
const parser = new Parser();
const MAX_SQL_LENGTH = 50_000;

export type ValidatedReadQuery = {
  sql: string;
  referencedTables: string[];
};

function maskQuotedValues(sql: string): string {
  return sql
    .replace(/'(?:\\.|''|[^'])*'/g, "''")
    .replace(/"(?:\\.|""|[^"])*"/g, '""')
    .replace(/`(?:``|[^`])*`/g, "``");
}

export function validateReadQuery(sql: string, database: string): ValidatedReadQuery {
  const candidate = sql.trim();
  if (candidate.length === 0) {
    throw new UnsafeQueryError("A SQL query is required.");
  }
  if (candidate.length > MAX_SQL_LENGTH) {
    throw new UnsafeQueryError("The generated query is too long.");
  }
  const masked = maskQuotedValues(candidate);
  if (/\/\*|--[ \t\r\n]|#/.test(masked)) {
    throw new UnsafeQueryError("SQL comments are not permitted.");
  }

  let parsed: ReturnType<InstanceType<typeof Parser>["parse"]>;
  try {
    parsed = parser.parse(candidate, { database: "MySQL" });
  } catch {
    throw new UnsafeQueryError("The generated query is not valid MySQL read SQL.");
  }

  const statements = Array.isArray(parsed.ast) ? parsed.ast : [parsed.ast];
  if (statements.length !== 1 || statements[0]?.type !== "select") {
    throw new UnsafeQueryError("Only one SELECT query is permitted.");
  }

  const expectedDatabase = database.toLowerCase();
  for (const tableReference of parsed.tableList) {
    const [, referencedDatabase] = tableReference.split("::");
    if (
      referencedDatabase &&
      referencedDatabase !== "null" &&
      referencedDatabase.toLowerCase() !== expectedDatabase
    ) {
      throw new UnsafeQueryError("Queries may only access the configured database.");
    }
  }

  const prohibitedClauses: Array<[RegExp, string]> = [
    [/\bINTO\s+(?:OUTFILE|DUMPFILE)\b/i, "File export clauses are not permitted."],
    [/\bFOR\s+UPDATE\b/i, "Locking reads are not permitted."],
    [/\bFOR\s+SHARE\b/i, "Locking reads are not permitted."],
    [/\bLOCK\s+IN\s+SHARE\s+MODE\b/i, "Locking reads are not permitted."],
    [/\bCALL\b/i, "Stored procedure calls are not permitted."],
    [/\bSLEEP\s*\(/i, "Delay functions are not permitted."],
    [/\bBENCHMARK\s*\(/i, "Benchmark functions are not permitted."],
    [/\bLOAD_FILE\s*\(/i, "File read functions are not permitted."],
    [/\b(?:GET_LOCK|RELEASE_LOCK|IS_FREE_LOCK|IS_USED_LOCK)\s*\(/i, "Lock functions are not permitted."],
  ];
  for (const [pattern, reason] of prohibitedClauses) {
    if (pattern.test(masked)) {
      throw new UnsafeQueryError(reason);
    }
  }

  return {
    sql: candidate.replace(/;\s*$/, ""),
    referencedTables: parsed.tableList,
  };
}
