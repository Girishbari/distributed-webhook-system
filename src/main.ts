import app from "./app";
import { config, deliveryWorker, pool } from "./container";

const server = app.listen(config.port, () => {
  console.log(`api listening on http://localhost:${config.port}`);
});
deliveryWorker.start();

async function shutdown() {
  console.log("shutting down");
  server.close();
  await deliveryWorker.stop();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
