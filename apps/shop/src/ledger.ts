import { mkdir, readFile, writeFile } from "node:fs/promises";

export type Ledger = {
  runId: string;
  eventType: string;
  publishedAt: string;
  eventIds: string[];
};

const folder = new URL("../runs/", import.meta.url);
const latest = new URL("latest.json", folder);

export async function saveLedger(ledger: Ledger): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(latest, JSON.stringify(ledger));
}

export async function loadLedger(): Promise<Ledger> {
  const text = await readFile(latest, "utf8").catch(() => {
    throw new Error(
      "No published run found. Publish first: pnpm --filter shop publish-events 1000",
    );
  });
  return JSON.parse(text);
}
