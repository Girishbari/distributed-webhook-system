import app from "./app";
import { config, pool } from "./container";

const server = app.listen(config.port, () => {
  console.log(`api only (no deliveries) listening on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
