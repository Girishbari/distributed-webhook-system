# Webhook Delivery Service

A service that reliably delivers webhooks to other apps, the way Stripe does for its customers. Built from scratch with TypeScript, Express and Postgres.

- **Register endpoints** and **publish events** through a small REST API
- **Automatic retries** with exponential backoff and jitter when a receiver is down
- **Signed payloads** (HMAC-SHA256 with a timestamp) so receivers can verify the sender
- **Dashboard** to inspect every delivery and attempt, and replay failures
- **Circuit breaker** so one dead receiver can't slow down the healthy ones

**Live demo:** https://distributed-webhook-system.onrender.com/.

## The proof: 100k events, flaky receivers, nothing lost


## Architecture

```
 Sender ──POST /events──▶ ┌────────────── one Node process ──────────────┐
        ◀── 202 ───────── │ API (Express)                                │
                          │  idempotency key + fan-out in 1 transaction  │
 Dashboard ─────────────▶ │                                              │
                          │ Delivery worker (same process, own module)   │
                          │  claim → sign → POST → record → backoff      │
                          └───────────────┬──────────────────────────────┘
                                          │
                                  Postgres (store + queue)
                                          │
                              signed POST ▼  5s timeout
                                     Receivers
```


## Verifying a webhook (receiver side)

Every delivery has these headers:

```
x-webhook-id:        evt_…              unique per event; dedupe on this
x-webhook-timestamp: 1759651200         unix seconds
x-webhook-signature: v1=<hex>           HMAC-SHA256(secret, "<timestamp>.<raw body>")
```

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function isValid(secret: string, timestamp: string, rawBody: string, header: string): boolean {
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const received = header.replace(/^v1=/, "");
  return (
    expected.length === received.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  );
}
```

## API

All routes except `/health` and `/demo/*` need `Authorization: Bearer <API_KEY>`.

| Method   | Path                                     |                                                                                             |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `POST`   | `/endpoints`                             | Register `{ url, eventTypes }` → returns the signing secret once                            |
| `GET`    | `/endpoints`                             | List endpoints                                                                              |
| `PATCH`  | `/endpoints/:id`                         | Change `url`, `eventTypes`, `enabled`                                                       |
| `DELETE` | `/endpoints/:id`                         | Remove                                                                                      |
| `POST`   | `/events`                                | Publish `{ type, payload }` with an `Idempotency-Key` header → `202 { eventId, duplicate }` |
| `GET`    | `/deliveries?status=&endpointId=&limit=` | List deliveries                                                                             |
| `GET`    | `/deliveries/stats`                      | Counts by status                                                                            |
| `GET`    | `/deliveries/:id`                        | One delivery with all its attempts                                                          |
| `POST`   | `/deliveries/:id/replay`                 | Replay one dead delivery                                                                    |
| `POST`   | `/deliveries/replay`                     | Replay all dead, optionally `{ endpointId }`                                                |
| `POST`   | `/demo/test-event`                       | Public, rate limited: send a signed test event to `{ url }`                                 |

## Running the demo step by step

Needs Node 22+, pnpm and Postgres (for example `docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres`).

**Setup, once:**

```bash
pnpm install
```

Then copy each app's `.env.example` to `.env`:

- `apps/x/.env`: `DATABASE_URL`, an `API_KEY`, and `ALLOW_PRIVATE_URLS=true` (lets X deliver to `localhost`)
- `apps/shop/.env` and `apps/receiver/.env`: the same `API_KEY` as `X_API_KEY`. The receiver's `DATABASE_URL` points at its own database, which it creates on first start.

```bash
pnpm --filter x db:migrate
```

**Each step in its own terminal:**

| Step                                      | Command                                    | What you see                                                         |
| ----------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| 0. X accepts events, delivers nothing yet | `pnpm --filter x api`                      | Dashboard on http://localhost:3000                                   |
| 1. Receivers start and register with X    | `pnpm --filter receiver start`             | Three endpoints registered, secrets saved                            |
| 2. The shop publishes events              | `pnpm --filter shop publish-events 100000` | Events saved; every delivery is **pending**                          |
| 3. X starts delivering                    | `pnpm --filter x worker`                   | Pending goes down in the dashboard; retries back off 10s → 30s → 90s |
| 4. Operator replays failures              | Dashboard: **Replay all dead**             | Dead deliveries go back to pending and get delivered                 |
| 5. Check                                  | `pnpm --filter shop check`                 | The table above                                                      |

**Optional experiments:**

- **Receiver outage:** stop the receiver with Ctrl+C during step 3, then start it again. The circuit breaker pauses its endpoints, and nothing is forgotten because the receiver keeps its records in its own database.
- **X crash:** stop the worker and start it again. Its leases expire and the deliveries are picked up again.
- **Start fresh:** `pnpm --filter receiver reset` forgets what the receivers processed.

`pnpm --filter x dev` runs the API and worker together in one process, which is how X runs in production.

## Project structure

```
apps/
  x/                    the product (deployed)
    src/
      routes/           plain Express routers
      controllers/      read the request, validate with zod, call a service, send the response
      services/         the logic, one job per class, depending on interfaces
                        EventPublisher · DeliveryWorker · RetryPolicy · CircuitBreaker
                        PayloadSigner · WebhookSender · ReceiverUrlPolicy · WorkSignal …
      repositories/     interfaces + Postgres implementations
      types/            plain data types
      container.ts      the one place where everything is created and wired together
      main.ts           API + worker in one process (production)
      api.ts, worker.ts the same two halves as separate processes
    db/schema.sql       tables and indexes
    public/             the dashboard (one static page)
  shop/                 stand-in sender: publish events, check results
  receiver/             stand-in receivers: flaky servers + their own database
packages/               shared code, used by more than one app
  signature/            sign (X) and verify (receiver) webhooks: HMAC-SHA256, header names, 5-min tolerance
  x-client/             typed client for X's API, used by the shop and the receiver
  demo-report/          the ReceiverReport type the receiver serves and the shop checks
```

`pnpm install` builds the packages automatically (a `prepare` script). After editing a package, rebuild it with `pnpm --filter "./packages/**" build`.

## Known limits

- In production the API and worker share one process, which lets the database scale to zero. Run separately (`api` + `worker`), the worker can't be woken in memory, so it polls every second through `PollingWorkSignal`. That's the same `WorkSignal` interface with a different implementation.
- Receiver URLs are checked when they're registered, not again at send time (DNS rebinding).
- The demo rate limit is in memory, so it applies per process.
