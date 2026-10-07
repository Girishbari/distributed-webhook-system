# Webhook Delivery Service

A service that reliably delivers webhooks to other apps, the way Stripe does for its customers. Built from scratch with TypeScript, Express and Postgres.

- **Register endpoints** and **publish events** through a small REST API
- **Automatic retries** with exponential backoff and jitter when a receiver is down
- **Signed payloads** (HMAC-SHA256 with a timestamp) so receivers can verify the sender
- **Dashboard** to inspect every delivery and attempt, and replay failures
- **Circuit breaker** so one dead receiver can't slow down the healthy ones

**Live demo:** _add the Railway URL here_. Paste a [webhook.site](https://webhook.site) URL into **Try it** and watch a signed webhook arrive.

## The proof: 100k events, flaky receivers, nothing lost

`pnpm demo <count> --outage` publishes events to three fake receivers that fail on purpose:
20% answer 500, 2% hang past the timeout, 8% **process the event and then answer 500** (a lost acknowledgement, which forces real duplicates), and one receiver goes down completely for a minute.
A checker then compares what was published with what each receiver processed.

```
$ pnpm demo 500 --outage          # a 500-event run with one receiver down for 60s
  events published                          500
  expected (event, receiver) pairs         1500
  processed pairs                          1500   ✓ lost: 0
  HTTP requests received                   2130   1.42 per pair (retries)
  re-sent after already processed           165   lost acks; a receiver without dedupe would double-process these
  processed twice                             0   ✓ receiver dedupes on event id
  bad signatures                              0   ✓
  dead → replayed                            11   all recovered after replay

During the 60s outage the circuit breaker allowed 17 refused connections (all within one second),
then paused the endpoint; no further attempts hit the dead receiver until it recovered.
```

The line to look at is **"re-sent after already processed"** next to **"processed twice: 0"**. Exactly-once delivery over a network is impossible: if a receiver's "200 OK" gets lost, the sender can't tell whether the event arrived. So the service guarantees **at-least-once** delivery, every event carries a unique id, and receivers ignore ids they've already handled. Together that gives **effectively exactly-once processing**, shown above with real numbers.

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

| Decision | Why |
|---|---|
| **Postgres is the queue** (`FOR UPDATE SKIP LOCKED`) | ~1.4k sends/s fits one database; one system to run; event + deliveries saved atomically |
| **Fan-out inside `POST /events`, one transaction** | There's never an event without its deliveries, even if the process crashes |
| **`Idempotency-Key` header, enforced by a `UNIQUE` constraint** | A sender retrying after a lost `202` doesn't create duplicates |
| **Lease via `next_attempt_at`** | Claiming a delivery pushes its due time 30s ahead; if the worker dies, it simply becomes due again |
| **Backoff 10s → 30s → 90s, ±20% jitter, then dead** | Rides out a one-minute outage; jitter stops retry stampedes |
| **Circuit breaker: 10 failures in a row → pause 1 min** | Dead receivers stop occupying workers; paused time doesn't use up retries |
| **Worker sleeps when idle, woken in-memory by the API** | The database can scale to zero (Neon free tier) instead of being polled every second |
| **No ordering guarantee** | Ordering means head-of-line blocking; receivers dedupe by id and refetch state instead |

The full design (requirements, estimates, schema, trade-offs, decision log) is in [DESIGN.md](DESIGN.md).

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
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
```

## API

All routes except `/health` and `/demo/*` need `Authorization: Bearer <API_KEY>`.

| Method | Path | |
|---|---|---|
| `POST` | `/endpoints` | Register `{ url, eventTypes }` → returns the signing secret once |
| `GET` | `/endpoints` | List endpoints |
| `PATCH` | `/endpoints/:id` | Change `url`, `eventTypes`, `enabled` |
| `DELETE` | `/endpoints/:id` | Remove |
| `POST` | `/events` | Publish `{ type, payload }` with an `Idempotency-Key` header → `202 { eventId, duplicate }` |
| `GET` | `/deliveries?status=&endpointId=&limit=` | List deliveries |
| `GET` | `/deliveries/stats` | Counts by status |
| `GET` | `/deliveries/:id` | One delivery with all its attempts |
| `POST` | `/deliveries/:id/replay` | Replay one dead delivery |
| `POST` | `/deliveries/replay` | Replay all dead, optionally `{ endpointId }` |
| `POST` | `/demo/test-event` | Public, rate limited: send a signed test event to `{ url }` |

## Running locally

Needs Node 22+, pnpm and a Postgres database (a free [Neon](https://neon.com) project works).

```bash
pnpm install
cp .env.example .env        # fill in DATABASE_URL and API_KEY; set ALLOW_PRIVATE_URLS=true for local receivers
pnpm db:migrate
pnpm dev                    # API + worker + dashboard on http://localhost:3000
pnpm demo 1000              # in a second terminal; add --outage to take one receiver down for 60s
```

## Deploying to Railway

1. Push this repo to GitHub, then in Railway choose **New project → Deploy from GitHub repo**.
2. Add the variables `DATABASE_URL`, `API_KEY` (a long random string) and `ALLOW_PRIVATE_URLS=false`.
3. Railway builds with `pnpm build` and starts with `pnpm start`, which applies the schema and then starts the server ([railway.json](railway.json)).
4. Under **Settings → Networking**, generate a public domain.

With `ALLOW_PRIVATE_URLS=false`, receiver URLs must be `https` and must resolve to public addresses, so the service can't be pointed at its own internal network.

## Project structure

```
src/
  routes/        plain Express routers
  controllers/   read the request, validate with zod, call a service, send the response
  services/      the logic, one job per class, depending on interfaces
                 EventPublisher · DeliveryWorker · RetryPolicy · CircuitBreaker
                 PayloadSigner · WebhookSender · ReceiverUrlPolicy · WorkSignal …
  repositories/  interfaces + Postgres implementations
  types/         plain data types
  container.ts   the one place where everything is created and wired together
  demo/          flaky receivers + the load-and-check script
db/schema.sql    tables and indexes
public/          the dashboard (one static page)
```

## Known limits

- The API and worker share one process. That keeps the database able to sleep, but they can't be scaled separately yet; splitting them means swapping the in-memory `WorkSignal` for `LISTEN/NOTIFY` or polling.
- Receiver URLs are checked when they're registered, not again at send time (DNS rebinding).
- The demo rate limit is in memory, so it applies per process.
