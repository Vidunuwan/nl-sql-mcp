import { OpenAiSqlAgentRuntime } from "../agent/runtime.js";
import { loadConfig } from "../config.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  let app: ReturnType<typeof buildApp> | undefined;

  try {
    const config = loadConfig();
    const runtime = new OpenAiSqlAgentRuntime(config);
    app = buildApp({ config, runtime });
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    if (app) {
      app.log.error({ err: error }, "API startup failed");
      await app.close();
    } else {
      const message = error instanceof Error ? error.message : "Unknown startup failure.";
      console.error(`API startup failed: ${message}`);
    }
    process.exitCode = 1;
  }
}

void main();
