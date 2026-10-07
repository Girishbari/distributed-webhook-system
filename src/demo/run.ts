import { setTimeout as sleep } from "node:timers/promises";
import type { DeliveryStats } from "../types/delivery";
import { FlakyReceiver } from "./FlakyReceiver";

const eventCount = Number(process.argv[2] ?? 1000);
const withOutage = process.argv.includes("--outage");
const apiUrl = process.env.DEMO_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const headers = {
  authorization: `Bearer ${process.env.API_KEY}`,
  "content-type": "application/json",
};
const runId = Date.now().toString(36);
const eventType = "order.created";

const behaviour = { failRate: 0.2, timeoutRate: 0.02, lostAckRate: 0.08 };
const receivers = [
  new FlakyReceiver("warehouse", 4001, behaviour),
  new FlakyReceiver("billing", 4002, behaviour),
  new FlakyReceiver("email", 4003, behaviour),
];
const endpointIds = new Map<FlakyReceiver, string>();

async function api<T>(method: string, path: string, body?: unknown, extraHeaders = {}): Promise<T> {
  const response = await fetch(apiUrl + path, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`);
  return response.status === 204 ? (undefined as T) : response.json();
}

async function retrying<T>(action: () => Promise<T>, tries = 10): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= tries) throw error;
      await sleep(1000 * attempt);
    }
  }
}

async function disableOldDemoEndpoints() {
  const endpoints = await api<{ id: string; url: string; enabled: boolean }[]>("GET", "/endpoints");
  const ports = receivers.map((receiver) => `:${receiver.port}/`);
  for (const endpoint of endpoints) {
    if (endpoint.enabled && ports.some((port) => endpoint.url.includes(port))) {
      await api("PATCH", `/endpoints/${endpoint.id}`, { enabled: false });
    }
  }
}

async function registerReceivers() {
  for (const receiver of receivers) {
    await receiver.start();
    const endpoint = await api<{ id: string; secret: string }>("POST", "/endpoints", {
      url: receiver.url,
      eventTypes: [eventType],
    });
    receiver.secret = endpoint.secret;
    endpointIds.set(receiver, endpoint.id);
  }
}

async function publishAll(): Promise<Set<string>> {
  const published = new Set<string>();
  let next = 0;
  const publishOne = async (index: number) => {
    const { eventId } = await retrying(() =>
      api<{ eventId: string }>(
        "POST",
        "/events",
        { type: eventType, payload: { orderId: index } },
        {
          "idempotency-key": `${runId}-${index}`,
        },
      ),
    );
    published.add(eventId);
  };
  const lane = async () => {
    while (next < eventCount) {
      await publishOne(next++);
      if (published.size % 500 === 0 && published.size < eventCount)
        process.stdout.write(`\r  published ${published.size}/${eventCount}`);
    }
  };
  await Promise.all(Array.from({ length: 50 }, lane));
  process.stdout.write(`\r  published ${published.size}/${eventCount}\n`);
  return published;
}

async function totals(): Promise<DeliveryStats> {
  const all = await Promise.all(
    [...endpointIds.values()].map((id) =>
      retrying(() => api<DeliveryStats>("GET", `/deliveries/stats?endpointId=${id}`)),
    ),
  );
  return all.reduce((sum, stats) => ({
    pending: sum.pending + stats.pending,
    delivered: sum.delivered + stats.delivered,
    dead: sum.dead + stats.dead,
  }));
}

async function waitUntilDrained(): Promise<DeliveryStats> {
  for (;;) {
    const stats = await totals();
    process.stdout.write(
      `\r  delivered ${stats.delivered} · pending ${stats.pending} · dead ${stats.dead}      `,
    );
    if (stats.pending === 0) {
      process.stdout.write("\n");
      return stats;
    }
    await sleep(2000);
  }
}

async function simulateOutage(receiver: FlakyReceiver) {
  await sleep(5_000);
  console.log(`\n  ⚡ ${receiver.name} goes down for 60s`);
  await receiver.stop();
  await sleep(60_000);
  await receiver.start();
  console.log(`\n  ✓ ${receiver.name} is back`);
}

function report(published: Set<string>, replayed: number, startedAt: number) {
  const expected = published.size * receivers.length;
  const processed = receivers.reduce((sum, receiver) => sum + receiver.processed.size, 0);
  const requests = receivers.reduce((sum, receiver) => sum + receiver.requests, 0);
  const repeats = receivers.reduce((sum, receiver) => sum + receiver.repeatsAfterProcessing, 0);
  const processedTwice = receivers.reduce((sum, receiver) => sum + receiver.processedTwice, 0);
  const badSignatures = receivers.reduce((sum, receiver) => sum + receiver.badSignatures, 0);
  const lost = receivers.reduce(
    (sum, receiver) => sum + [...published].filter((id) => !receiver.processed.has(id)).length,
    0,
  );

  const rows: [string, string | number, string][] = [
    ["events published", published.size, ""],
    ["expected (event, receiver) pairs", expected, ""],
    ["processed pairs", processed, lost === 0 ? "✓ lost: 0" : `✗ lost: ${lost}`],
    ["HTTP requests received", requests, `${(requests / expected).toFixed(2)} per pair (retries)`],
    [
      "re-sent after already processed",
      repeats,
      "lost acks; a receiver without dedupe would double-process these",
    ],
    [
      "processed twice",
      processedTwice,
      processedTwice === 0 ? "✓ receiver dedupes on event id" : "✗",
    ],
    ["bad signatures", badSignatures, badSignatures === 0 ? "✓" : "✗"],
    ["dead → replayed", replayed, "all recovered after replay"],
    ["total time", `${((Date.now() - startedAt) / 1000).toFixed(0)}s`, ""],
  ];
  console.log("\nResult");
  for (const [label, value, note] of rows) {
    console.log(`  ${label.padEnd(34)} ${String(value).padStart(10)}   ${note}`);
  }
}

async function main() {
  const startedAt = Date.now();
  console.log(
    `Demo run ${runId}: ${eventCount} events → ${receivers.length} flaky receivers${withOutage ? " (with outage)" : ""}`,
  );

  await disableOldDemoEndpoints();
  await registerReceivers();

  const outage = withOutage ? simulateOutage(receivers[2]) : Promise.resolve();
  const published = await publishAll();

  console.log("Waiting for deliveries…");
  await outage;
  let stats = await waitUntilDrained();

  let replayed = 0;
  for (let round = 1; stats.dead > 0 && round <= 5; round++) {
    console.log(`Replaying ${stats.dead} dead deliveries (round ${round})…`);
    for (const id of endpointIds.values()) {
      replayed += (
        await api<{ replayed: number }>("POST", "/deliveries/replay", { endpointId: id })
      ).replayed;
    }
    stats = await waitUntilDrained();
  }

  report(published, replayed, startedAt);

  for (const id of endpointIds.values()) await api("PATCH", `/endpoints/${id}`, { enabled: false });
  await Promise.all(receivers.map((receiver) => receiver.stop()));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
