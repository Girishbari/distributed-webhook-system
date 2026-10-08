import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { signatureHeaders, verifyWebhook } from "@webhook/signature";
import type { Pool } from "pg";

export type Behaviour = {
  failRate: number;
  timeoutRate: number;
  lostAckRate: number;
};

export type ReceiverCounters = {
  requests: number;
  repeatsAfterProcessing: number;
  badSignatures: number;
};

export class FlakyReceiver {
  secret = "";
  endpointId = "";
  readonly counters: ReceiverCounters = {
    requests: 0,
    repeatsAfterProcessing: 0,
    badSignatures: 0,
  };
  private server: Server | null = null;

  constructor(
    readonly name: string,
    readonly port: number,
    private readonly behaviour: Behaviour,
    private readonly pool: Pool,
  ) {}

  get url(): string {
    return `http://localhost:${this.port}/hooks`;
  }

  start(): Promise<void> {
    this.server = createServer((request, response) => {
      this.handle(request, response).catch(() => response.writeHead(500).end());
    });
    return new Promise((resolve) => this.server!.listen(this.port, resolve));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body = "";
    for await (const chunk of request) body += chunk;

    const isGenuine = verifyWebhook({
      secret: this.secret,
      body,
      timestamp: request.headers[signatureHeaders.timestamp] as string | undefined,
      signature: request.headers[signatureHeaders.signature] as string | undefined,
    });
    if (!isGenuine) {
      this.counters.badSignatures++;
      response.writeHead(401).end();
      return;
    }

    this.counters.requests++;
    const eventId = request.headers[signatureHeaders.eventId] as string;
    const { failRate, timeoutRate, lostAckRate } = this.behaviour;
    const roll = Math.random();

    if (roll < failRate) {
      response.writeHead(500).end();
    } else if (roll < failRate + timeoutRate) {
      setTimeout(() => response.destroyed || response.writeHead(500).end(), 6_000);
    } else {
      await this.process(eventId);
      response.writeHead(roll < failRate + timeoutRate + lostAckRate ? 500 : 200).end();
    }
  }

  private async process(eventId: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      "INSERT INTO processed_events (receiver, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [this.name, eventId],
    );
    if (rowCount === 0) this.counters.repeatsAfterProcessing++;
  }
}
