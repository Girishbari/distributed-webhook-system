import app from "./app";
import { config, createDeliveryWorker, pool } from "./container";

const server = app.listen(config.port, () => {
  console.log(`api + worker listening on http://localhost:${config.port}`);
});
const worker = createDeliveryWorker();
worker.start();

async function shutdown() {
  server.close();
  await worker.stop();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
