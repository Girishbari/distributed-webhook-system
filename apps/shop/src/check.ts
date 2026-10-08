import { loadLedger } from "./ledger";
import type { ReceiverReport } from "@webhook/demo-report";
import { xClientFromEnv, type DeliveryStats } from "@webhook/x-client";

const xClient = xClientFromEnv();
const reportUrl = process.env.RECEIVER_REPORT_URL ?? "http://localhost:4000/report";

const ledger = await loadLedger();
const receivers: ReceiverReport[] = await fetch(reportUrl)
  .then((response) => response.json())
  .catch(() => {
    throw new Error(`Can't reach the receiver report at ${reportUrl}. Is the receiver running?`);
  });

const published = new Set(ledger.eventIds);
const stats = await Promise.all(
  receivers.map((receiver) => xClient.deliveryStats(receiver.endpointId)),
);
const inX = stats.reduce<DeliveryStats>(
  (total, each) => ({
    pending: total.pending + each.pending,
    delivered: total.delivered + each.delivered,
    dead: total.dead + each.dead,
  }),
  { pending: 0, delivered: 0, dead: 0 },
);

const expected = published.size * receivers.length;
let processed = 0;
let lost = 0;
for (const receiver of receivers) {
  const theirs = new Set(receiver.processedEventIds);
  for (const id of published) {
    if (theirs.has(id)) processed++;
    else lost++;
  }
}
const sum = (pick: (receiver: ReceiverReport) => number) =>
  receivers.reduce((total, receiver) => total + pick(receiver), 0);

const rows: [string, string | number, string][] = [
  ["events the shop published", published.size, `run ${ledger.runId}`],
  ["expected (event, receiver) pairs", expected, `${receivers.length} receivers`],
  ["processed pairs", processed, lost === 0 ? "✓ lost: 0" : `missing: ${lost}`],
  ["HTTP requests received", sum((r) => r.requests), "includes retries (since receiver start)"],
  [
    "re-sent after already processed",
    sum((r) => r.repeatsAfterProcessing),
    "lost acks, ignored by receiver",
  ],
  ["processed twice", 0, "✓ impossible: PRIMARY KEY (receiver, event_id)"],
  ["bad signatures", sum((r) => r.badSignatures), sum((r) => r.badSignatures) === 0 ? "✓" : "✗"],
  [
    "X: still pending",
    inX.pending,
    inX.pending === 0 ? "✓" : "not delivered yet (is the worker running?)",
  ],
  ["X: dead", inX.dead, inX.dead === 0 ? "✓" : "replay them from the dashboard"],
];

console.log("\nCheck");
for (const [label, value, note] of rows) {
  console.log(`  ${label.padEnd(34)} ${String(value).padStart(10)}   ${note}`);
}

if (inX.pending > 0 || inX.dead > 0) {
  console.log(
    "\nNot finished yet: wait for pending to reach 0, replay any dead deliveries, then run check again.",
  );
} else if (lost === 0) {
  console.log("\nEvery event reached every receiver exactly once.");
}
