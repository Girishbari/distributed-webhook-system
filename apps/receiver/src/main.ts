import { createServer } from "node:http";
import { Pool } from "pg";
import { createDatabaseIfMissing, createTables } from "./database";
import { FlakyReceiver } from "./FlakyReceiver";
import type { ReceiverReport } from "@webhook/demo-report";
import { xClientFromEnv, type Endpoint } from "@webhook/x-client";

const xClient = xClientFromEnv();
const eventType = "order.created";
const reportPort = 4000;
const behaviour = {
  failRate: Number(process.env.FAIL_RATE ?? 0.2),
  timeoutRate: Number(process.env.TIMEOUT_RATE ?? 0.02),
  lostAckRate: Number(process.env.LOST_ACK_RATE ?? 0.08),
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

await createDatabaseIfMissing(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl, max: 20 });
await createTables(pool);

const receivers = [
  new FlakyReceiver("warehouse", 4001, behaviour, pool),
  new FlakyReceiver("billing", 4002, behaviour, pool),
  new FlakyReceiver("email", 4003, behaviour, pool),
];

async function connectToX(receiver: FlakyReceiver, registered: Endpoint[]) {
  const { rows } = await pool.query<{ endpoint_id: string; secret: string }>(
    "SELECT endpoint_id, secret FROM receiver_endpoints WHERE name = $1",
    [receiver.name],
  );
  const saved = rows[0];
  const stillInX = saved && registered.find((endpoint) => endpoint.id === saved.endpoint_id);

  if (saved && stillInX) {
    if (!stillInX.enabled) await xClient.setEndpointEnabled(saved.endpoint_id, true);
    receiver.endpointId = saved.endpoint_id;
    receiver.secret = saved.secret;
    console.log(
      `  ${receiver.name.padEnd(9)} ${receiver.url}  reusing endpoint ${saved.endpoint_id}`,
    );
    return;
  }

  const endpoint = await xClient.registerEndpoint(receiver.url, [eventType]);
  await pool.query(
    `INSERT INTO receiver_endpoints (name, endpoint_id, secret) VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE SET endpoint_id = $2, secret = $3`,
    [receiver.name, endpoint.id, endpoint.secret],
  );
  receiver.endpointId = endpoint.id;
  receiver.secret = endpoint.secret;
  console.log(`  ${receiver.name.padEnd(9)} ${receiver.url}  registered endpoint ${endpoint.id}`);
}

async function disableStrayEndpoints(registered: Endpoint[]) {
  const ours = new Set(receivers.map((receiver) => receiver.endpointId));
  const ourUrls = new Set(receivers.map((receiver) => receiver.url));
  for (const endpoint of registered) {
    if (endpoint.enabled && ourUrls.has(endpoint.url) && !ours.has(endpoint.id)) {
      await xClient.setEndpointEnabled(endpoint.id, false);
    }
  }
}

async function report(): Promise<ReceiverReport[]> {
  return Promise.all(
    receivers.map(async (receiver) => {
      const { rows } = await pool.query<{ event_id: string }>(
        "SELECT event_id FROM processed_events WHERE receiver = $1",
        [receiver.name],
      );
      return {
        name: receiver.name,
        endpointId: receiver.endpointId,
        ...receiver.counters,
        processedEventIds: rows.map((row) => row.event_id),
      };
    }),
  );
}

console.log("Starting receivers and registering them with X…");
const registered = await xClient.listEndpoints();
for (const receiver of receivers) {
  await receiver.start();
  await connectToX(receiver, registered);
}
await disableStrayEndpoints(registered);

createServer(async (request, response) => {
  if (request.url !== "/report") return response.writeHead(404).end();
  response
    .writeHead(200, { "content-type": "application/json" })
    .end(JSON.stringify(await report()));
}).listen(reportPort);

console.log(`\nReady. Subscribed to "${eventType}". Failure mix: ${JSON.stringify(behaviour)}`);
console.log(`Report for the checker: http://localhost:${reportPort}/report`);
console.log(
  "Stop with Ctrl+C. Stopping mid-run is a real outage; restart and nothing is forgotten.",
);

process.on("SIGINT", async () => {
  await pool.end();
  process.exit(0);
});
