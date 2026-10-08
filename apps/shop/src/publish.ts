import { saveLedger } from "./ledger";
import { withRetries, xClientFromEnv } from "@webhook/x-client";

const xClient = xClientFromEnv();
const eventCount = Number(process.argv[2] ?? 1000);
const parallelRequests = 50;
const eventType = "order.created";
const runId = Date.now().toString(36);

const eventIds: string[] = [];
let duplicates = 0;
let next = 0;
const startedAt = Date.now();

async function publishOne(orderNumber: number) {
  const result = await withRetries(() =>
    xClient.publishEvent(eventType, { orderId: orderNumber, runId }, `${runId}-${orderNumber}`),
  );
  eventIds.push(result.eventId);
  if (result.duplicate) duplicates++;
}

async function lane() {
  while (next < eventCount) {
    await publishOne(next++);
    if (eventIds.length % 1000 === 0)
      process.stdout.write(`\r  published ${eventIds.length}/${eventCount}`);
  }
}

console.log(`Shop run ${runId}: publishing ${eventCount} "${eventType}" events to X…`);
await Promise.all(Array.from({ length: parallelRequests }, lane));

const seconds = (Date.now() - startedAt) / 1000;
process.stdout.write(`\r  published ${eventIds.length}/${eventCount}\n`);
console.log(`Done in ${seconds.toFixed(1)}s (${Math.round(eventIds.length / seconds)} events/s).`);
if (duplicates > 0)
  console.log(`${duplicates} retries were recognised by X as duplicates (idempotency key).`);

await saveLedger({ runId, eventType, publishedAt: new Date().toISOString(), eventIds });
console.log(
  "Saved the list of published event ids to apps/shop/runs/latest.json for the check step.",
);
