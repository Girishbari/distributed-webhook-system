import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { HmacSha256Signer } from "../services/PayloadSigner";

export type ReceiverBehaviour = {
  failRate: number;
  timeoutRate: number;
  lostAckRate: number;
};

const signer = new HmacSha256Signer();
const toleranceSeconds = 300;

export class FlakyReceiver {
  secret = "";
  requests = 0;
  badSignatures = 0;
  readonly eventsSeen = new Set<string>();
  readonly processed = new Set<string>();
  readonly timesProcessed = new Map<string, number>();
  repeatsAfterProcessing = 0;
  private server: Server | null = null;

  constructor(
    readonly name: string,
    readonly port: number,
    private readonly behaviour: ReceiverBehaviour,
  ) {}

  get url(): string {
    return `http://localhost:${this.port}/hooks`;
  }

  start(): Promise<void> {
    this.server = createServer((request, response) => this.handle(request, response));
    return new Promise((resolve) => this.server!.listen(this.port, resolve));
  }

  stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body = "";
    for await (const chunk of request) body += chunk;

    if (!this.hasValidSignature(request, body)) {
      this.badSignatures++;
      response.writeHead(401).end();
      return;
    }

    const eventId = request.headers["x-webhook-id"] as string;
    this.requests++;
    this.eventsSeen.add(eventId);

    const { failRate, timeoutRate, lostAckRate } = this.behaviour;
    const roll = Math.random();

    if (roll < failRate) {
      response.writeHead(500).end();
    } else if (roll < failRate + timeoutRate) {
      setTimeout(() => response.destroyed || response.writeHead(500).end(), 6_000);
    } else {
      this.process(eventId);
      response.writeHead(roll < failRate + timeoutRate + lostAckRate ? 500 : 200).end();
    }
  }

  private process(eventId: string): void {
    if (this.processed.has(eventId)) {
      this.repeatsAfterProcessing++;
      return;
    }
    this.processed.add(eventId);
    this.timesProcessed.set(eventId, (this.timesProcessed.get(eventId) ?? 0) + 1);
  }

  get processedTwice(): number {
    return [...this.timesProcessed.values()].filter((times) => times > 1).length;
  }

  private hasValidSignature(request: IncomingMessage, body: string): boolean {
    const timestamp = request.headers["x-webhook-timestamp"] as string | undefined;
    const signature = (request.headers["x-webhook-signature"] as string | undefined)?.replace(
      /^v1=/,
      "",
    );
    if (!timestamp || !signature) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;
    return signer.verify(this.secret, `${timestamp}.${body}`, signature);
  }
}
