#!/usr/bin/env node
import { loadConfig } from "./config.mjs";
import { createCouncilServer, listen } from "./server.mjs";

try {
  const config = await loadConfig();
  const server = createCouncilServer(config);
  await listen(server, config);
  console.log(`ClawCouncil Hub listening on http://${config.host}:${config.port}`);

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
