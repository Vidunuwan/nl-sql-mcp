# V1.0.0 - feat: implement Natural Language SQL Analytics Dashboard

## Overview

This first public release introduces a Natural Language SQL Analytics Dashboard built with TypeScript, OpenAI Agents, MCP, and MySQL. It converts plain-English questions into concise, data-backed answers while preserving the validated SQL evidence used to produce each result.

## Key Features

- Browser-based analytics dashboard backed by a Fastify API.
- OpenAI agent workflow for answering database questions from conversational prompts.
- Private local MCP server for controlled MySQL schema discovery and query execution.
- Evidence tables that expose bounded supporting rows alongside validated SQL.
- Automatic bar, line, and pie chart datasets for suitable query results.
- Session-based conversation history with configurable expiry.
- Bearer-token protection for conversation endpoints.

## Safety And Validation

- Queries are restricted to a single validated read-only `SELECT` statement.
- Cross-database access, multi-statements, comments, file operations, stored procedures, locking reads, and delay functions are rejected.
- Query execution is timeout-bound and result sets are capped before evidence is returned.
- Evidence previews and chart datasets are separately limited to reduce unintended data exposure.
- Deployments should use a MySQL account granted `SELECT` only on approved analytics data.

## Tech Stack

- Node.js and TypeScript
- Fastify
- OpenAI Agents SDK
- Model Context Protocol (MCP)
- MySQL and `mysql2`
- HTML, CSS, and JavaScript
- Zod and Vitest

## What I Learned

- Tool-constrained agents are more credible when every answer can be tied back to bounded, visible evidence.
- SQL validation must be layered with database privileges, timeouts, and output controls rather than treated as a single safeguard.
- A useful analytics interface should present narrative answers, raw evidence, and visual summaries without hiding the query path.
- Session handling and readiness checks matter even in a focused prototype because external dependencies fail independently.

## Future Improvements

- Add durable session storage and multi-user authorization.
- Add CI workflows, containerized development, and automated deployment checks.
- Introduce more granular schema and column-level disclosure policies.
- Expand charting and export workflows for analyst use cases.
