# Natural Language SQL Analytics Dashboard

A TypeScript analytics dashboard that turns plain-English business questions into grounded MySQL answers through an OpenAI agent and a private, read-only Model Context Protocol (MCP) server.

Users receive concise answers backed by validated SQL evidence, preview tables, and automatically prepared charts when a dataset is suitable for visualization.

## Key Features

- Ask database questions in natural language through a browser dashboard or HTTP API.
- Ground answers in validated, read-only MySQL queries executed by a private MCP server.
- Display bounded evidence tables and the SQL used to obtain them.
- Generate bar, line, or pie chart datasets for appropriate comparison, trend, or composition results.
- Preserve conversational context in expiring in-memory sessions.
- Protect conversation endpoints with bearer-token authentication.
- Reject unsafe SQL patterns and limit query execution time and returned rows.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime and language | Node.js 22+, TypeScript |
| API | Fastify |
| Agent orchestration | OpenAI Agents SDK |
| Tool protocol | Model Context Protocol (MCP) over local stdio |
| Database | MySQL 8+, `mysql2` |
| SQL safety | `node-sql-parser`, bounded query wrapper |
| Front end | HTML, CSS, JavaScript |
| Validation and testing | Zod, Vitest |

## Architecture Overview

```text
Browser dashboard / API client
          |
          | Bearer-authenticated session requests
          v
Fastify API + in-memory session store
          |
          | OpenAI Agents SDK
          v
Read-only SQL analyst agent
          |
          | Private local stdio transport
          v
MCP server: schema discovery + bounded query tools
          |
          | Validated single SELECT query
          v
Read-only MySQL account
```

The API process starts the MCP server as a child process; the MCP server is not exposed over HTTP. Its tools are limited to listing tables, describing tables, running read queries, and preparing bounded chart data.

## Project Structure

```text
src/
  agent/       OpenAI agent runtime and evidence extraction
  api/         Fastify server and HTTP routes
  mcp/         Private MCP tools and MySQL reader
  sessions/    In-memory conversation sessions
  sql/         Read-only SQL validation
test/          Unit, API, integration, and smoke tests
index.html     Browser dashboard
postman/       API request collection
```

## Installation

### Prerequisites

- Node.js 22 or newer
- MySQL 8 or newer
- An OpenAI API key
- A MySQL user restricted to readable analytics data

Install dependencies:

```powershell
npm ci
```

Create a database account with read-only access to the database the agent may analyze:

```sql
CREATE USER 'nl_sql_reader'@'%' IDENTIFIED BY 'replace-this-password';
GRANT SELECT ON nl_sql.* TO 'nl_sql_reader'@'%';
```

Do not grant write, administrative, `FILE`, or `EXECUTE` privileges to this account.

## Environment Configuration

Create local configuration from the committed template:

```powershell
Copy-Item .env.example .env
```

Populate `.env` locally. It is ignored by Git and must not be committed.

| Variable | Purpose | Example or default |
| --- | --- | --- |
| `OPENAI_API_KEY` | OpenAI API credential | Required; local secret |
| `OPENAI_MODEL` | Model used by the agent | `gpt-5.5` |
| `API_BEARER_TOKEN` | Token required by conversation endpoints | Required; at least 16 characters |
| `HOST` | API binding host | `127.0.0.1` |
| `PORT` | API port | `3000` |
| `MYSQL_HOST` | MySQL host | `127.0.0.1` |
| `MYSQL_PORT` | MySQL port | `3306` |
| `MYSQL_DATABASE` | Database visible to the agent | `nl_sql` |
| `MYSQL_USER` | Read-only MySQL user | `nl_sql_reader` |
| `MYSQL_PASSWORD` | Read-only MySQL password | Required for secured databases |
| `MYSQL_CONNECTION_LIMIT` | Connection pool limit | `5` |
| `QUERY_TIMEOUT_MS` | Query timeout in milliseconds | `10000` |
| `MAX_QUERY_ROWS` | Maximum retained result rows | `100` |
| `EVIDENCE_PREVIEW_ROWS` | Maximum visible evidence/chart points | `20` |
| `SESSION_TTL_MINUTES` | In-memory session inactivity lifetime | `60` |
| `MAX_MESSAGE_LENGTH` | Maximum user-question length | `4000` |

## Running The Project

Start in development mode:

```powershell
npm run dev
```

Or compile and run the production build:

```powershell
npm run build
npm start
```

Open `http://127.0.0.1:3000/` to use the browser dashboard.

Health endpoints:

- `GET /healthz` reports process liveness.
- `GET /readyz` verifies that the MCP process can query MySQL.

### API Example

```powershell
$headers = @{ Authorization = "Bearer replace-with-a-long-service-token" }
$session = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/v1/sessions -Headers $headers
$body = @{ message = "Which five products generated the most revenue this month?" } | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:3000/v1/sessions/$($session.sessionId)/messages" `
  -Headers $headers `
  -ContentType application/json `
  -Body $body
```

A Postman collection is available in [`postman/nl-sql-mcp.postman_collection.json`](postman/nl-sql-mcp.postman_collection.json).

## Example User Questions

- "How many orders were placed this month?"
- "Show the top five products by revenue this quarter."
- "Plot monthly sales totals for the last twelve months."
- "Which customer segments have the highest average order value?"
- "Compare order counts by status for the current week."

The answer depends on the schema and data available to the configured MySQL account.

## Safety Notes

- The MCP query path accepts exactly one valid MySQL `SELECT` statement, including a CTE whose final statement is `SELECT`.
- SQL comments, multi-statements, cross-database access, file reads or exports, stored procedures, delay functions, and locking queries are rejected.
- User queries are executed through a bounded wrapper and limited by `MAX_QUERY_ROWS`; evidence output is further limited by `EVIDENCE_PREVIEW_ROWS`.
- Charts are exposed only for small, non-truncated datasets with usable category and numeric value columns.
- `mysql2` has multiple statements disabled and applies configured query timeouts.
- The read-only MySQL account is the final data-access boundary. Only grant access to data permitted for disclosure.
- Evidence includes SQL and may reveal table names, column names, or filter values to authorized clients.
- Sessions and conversation history live in application memory and are lost when the process restarts.

## Testing

```powershell
npm test
npm run typecheck
npm run build
npm run check:runtime-imports
```

The MySQL integration and OpenAI end-to-end smoke tests are opt-in because they require external services and local credentials:

```powershell
$env:RUN_MYSQL_INTEGRATION = "1"
npm test -- test/mysql.integration.test.ts

$env:RUN_OPENAI_SMOKE = "1"
npm test -- test/openai.smoke.test.ts
```

## Screenshots

Add screenshots or a short demo recording before publication:

- Dashboard question and answer flow
- Evidence table with validated SQL
- Automatically generated chart example

## Future Improvements

- Persist sessions in a production-ready store for multi-instance deployments.
- Add user-level authentication, authorization, and audit logging.
- Introduce schema-aware prompt controls and column-level disclosure policies.
- Add containerized local setup and automated CI validation.
- Support richer dashboard exports and additional chart types.
