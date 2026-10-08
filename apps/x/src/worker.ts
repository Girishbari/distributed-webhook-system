import { createDeliveryWorker, pool } from "./container";
import { PollingWorkSignal } from "./services/WorkSignal";

// a separate process can't be woken in memory by the API, so it checks the database every second
const worker = createDeliveryWorker(new PollingWorkSignal(1_000));
worker.start();
console.log("worker started, delivering pending events");

async function shutdown() {
  await worker.stop();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
