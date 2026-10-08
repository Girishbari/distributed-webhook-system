import type { AttemptResult } from "../types/delivery";

export type WebhookRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

export interface WebhookSender {
  send(request: WebhookRequest): Promise<AttemptResult>;
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error) {
    const cause = (error.cause as { code?: string } | undefined)?.code;
    return cause ?? error.message;
  }
  return String(error);
}

export class HttpWebhookSender implements WebhookSender {
  constructor(private readonly timeoutMs: number) {}

  async send(request: WebhookRequest): Promise<AttemptResult> {
    const startedAt = performance.now();
    const durationMs = () => Math.round(performance.now() - startedAt);

    try {
      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await response.body?.cancel();
      return { statusCode: response.status, error: null, durationMs: durationMs() };
    } catch (error) {
      return { statusCode: null, error: describeError(error), durationMs: durationMs() };
    }
  }
}
