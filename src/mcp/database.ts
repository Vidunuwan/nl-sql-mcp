import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

import type { DatabaseConfig } from "../config.js";
import { validateReadQuery } from "../sql/validator.js";
import type { QueryToolResult } from "../types.js";

export type TableSummary = {
  name: string;
  type: string;
};

export type ColumnSummary = {
  name: string;
  dataType: string;
  nullable: boolean;
};

export interface DatabaseReader {
  ping(): Promise<void>;
  listTables(): Promise<TableSummary[]>;
  describeTable(table: string): Promise<ColumnSummary[]>;
  runReadQuery(sql: string): Promise<QueryToolResult>;
  close(): Promise<void>;
}

type TableRow = RowDataPacket & {
  TABLE_NAME: string;
  TABLE_TYPE: string;
};

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: "YES" | "NO";
};

function serializableValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  return value;
}

function serializableRow(row: RowDataPacket): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => [column, serializableValue(value)]),
  );
}

export class MySqlDatabaseReader implements DatabaseReader {
  private readonly pool: Pool;

  constructor(private readonly config: DatabaseConfig) {
    this.pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      database: config.mysql.database,
      user: config.mysql.user,
      password: config.mysql.password,
      connectionLimit: config.mysql.connectionLimit,
      multipleStatements: false,
      namedPlaceholders: false,
    });
  }

  async ping(): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.ping();
    } finally {
      connection.release();
    }
  }

  async listTables(): Promise<TableSummary[]> {
    const [rows] = await this.pool.query<TableRow[]>(
      {
        sql: `SELECT TABLE_NAME, TABLE_TYPE
              FROM information_schema.tables
              WHERE table_schema = ?
              ORDER BY TABLE_NAME`,
        timeout: this.config.queryTimeoutMs,
      },
      [this.config.mysql.database],
    );
    return rows.map((row) => ({ name: row.TABLE_NAME, type: row.TABLE_TYPE }));
  }

  async describeTable(table: string): Promise<ColumnSummary[]> {
    const [rows] = await this.pool.query<ColumnRow[]>(
      {
        sql: `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
              FROM information_schema.columns
              WHERE table_schema = ? AND table_name = ?
              ORDER BY ORDINAL_POSITION`,
        timeout: this.config.queryTimeoutMs,
      },
      [this.config.mysql.database, table],
    );
    return rows.map((row) => ({
      name: row.COLUMN_NAME,
      dataType: row.DATA_TYPE,
      nullable: row.IS_NULLABLE === "YES",
    }));
  }

  async runReadQuery(sql: string): Promise<QueryToolResult> {
    const validated = validateReadQuery(sql, this.config.mysql.database);
    const limit = this.config.maxQueryRows + 1;
    const boundedSql = `SELECT * FROM (${validated.sql}) AS \`_nl_sql_bounded\` LIMIT ?`;
    const [rows, fields] = await this.pool.query<RowDataPacket[]>(
      { sql: boundedSql, timeout: this.config.queryTimeoutMs },
      [limit],
    );
    const truncated = rows.length > this.config.maxQueryRows;
    const retainedRows = rows.slice(0, this.config.maxQueryRows).map(serializableRow);

    return {
      tool: "run_read_query",
      sql: validated.sql,
      columns: fields.map((field) => field.name),
      rows: retainedRows,
      rowCount: retainedRows.length,
      truncated,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
