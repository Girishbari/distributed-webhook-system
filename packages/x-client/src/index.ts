import { setTimeout as sleep } from "node:timers/promises";

export type Endpoint = {
  id: string;
  url: string;
  eventTypes: string[];
  enabled: boolean;
  createdAt: string;
};

export type RegisteredEndpoint = Endpoint & { secret: string };

export type PublishResult = {
  eventId: string;
  duplicate: boolean;
};

export type DeliveryStats = {
  pending: number;
  delivered: number;
  dead: number;
};

export type XClientOptions = {
  baseUrl: string;
  apiKey: string;
};

export function createXClient({ baseUrl, apiKey }: XClientOptions) {
  async function call<T>(method: string, path: string, body?: unknown, headers = {}): Promise<T> {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => {
      throw new Error(`Can't reach X at ${baseUrl}. Is it running? (pnpm --filter x api)`);
    });
    if (!response.ok) {
      throw new Error(`${method} ${path} → ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    listEndpoints: () => call<Endpoint[]>("GET", "/endpoints"),

    registerEndpoint: (url: string, eventTypes: string[]) =>
      call<RegisteredEndpoint>("POST", "/endpoints", { url, eventTypes }),

    setEndpointEnabled: (id: string, enabled: boolean) =>
      call<Endpoint>("PATCH", `/endpoints/${id}`, { enabled }),

    publishEvent: (type: string, payload: unknown, idempotencyKey: string) =>
      call<PublishResult>(
        "POST",
        "/events",
        { type, payload },
        { "idempotency-key": idempotencyKey },
      ),

    deliveryStats: (endpointId?: string) =>
      call<DeliveryStats>(
        "GET",
        `/deliveries/stats${endpointId ? `?endpointId=${encodeURIComponent(endpointId)}` : ""}`,
      ),

    replayDead: (endpointId?: string) =>
      call<{ replayed: number }>("POST", "/deliveries/replay", { endpointId }),
  };
}

export type XClient = ReturnType<typeof createXClient>;

export function xClientFromEnv(): XClient {
  const apiKey = process.env.X_API_KEY;
  if (!apiKey) throw new Error("X_API_KEY is not set");
  return createXClient({ baseUrl: process.env.X_API_URL ?? "http://localhost:3000", apiKey });
}

export async function withRetries<T>(action: () => Promise<T>, tries = 10): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= tries) throw error;
      await sleep(1000 * attempt);
    }
  }
}
