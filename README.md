# Webhook Delivery Service

A service that reliably delivers webhooks to other apps, the way Stripe does for its customers. Built from scratch with TypeScript, Express and Postgres.

- **Register endpoints** and **publish events** through a small REST API
- **Automatic retries** with exponential backoff and jitter when a receiver is down
- **Signed payloads** (HMAC-SHA256 with a timestamp) so receivers can verify the sender
- **Dashboard** to inspect every delivery and attempt, and replay failures
- **Circuit breaker** so one dead receiver can't slow down the healthy ones

**Live demo:** _add the Render URL here_ (free tier: the first visit may take about a minute while it wakes up). Paste a [webhook.site](https://webhook.site) URL into **Try it** and watch a signed webhook arrive.

## The proof: 100k events, flaky receivers, nothing lost

The repo has three separate apps, and only **X** is the product. The other two are stand-ins that talk to X purely over HTTP, the way real apps would:

| App             | Plays               | Does                                                                                 |
| --------------- | ------------------- | ------------------------------------------------------------------------------------ |
| `apps/x`        | the webhook service | Accepts events, delivers them, retries, signs; dashboard. **The only app deployed.** |
| `apps/shop`     | a sender            | Publishes events through X's API; afterwards checks what arrived                     |
| `apps/receiver` | three receivers     | Flaky servers on ports 4001–4003 with their own database to dedupe                   |

The receivers fail on purpose: 20% answer 500, 2% hang past the timeout, and 8% **process the event and then answer 500**. That last case is a lost acknowledgement, which forces real duplicates. A receiver remembers what it processed in its own Postgres table with `PRIMARY KEY (receiver, event_id)`, the way a real idempotent consumer would.

A real run (300 events; [step-by-step instructions](#running-the-demo-step-by-step) below):

```
$ pnpm --filter shop check
  events the shop published                 300
  expected (event, receiver) pairs          900   3 receivers
  processed pairs                           900   ✓ lost: 0
  HTTP requests received                   1341   includes retries
  re-sent after already processed           123   lost acks, ignored by receiver
  processed twice                             0   ✓ impossible: PRIMARY KEY (receiver, event_id)
  bad signatures                              0   ✓
  X: still pending                            0   ✓
  X: dead                                     0   ✓   (13 had died and were replayed)
```

In an earlier run with one receiver taken down for 60s, the circuit breaker allowed 17 refused connections (all within the first second), then paused that endpoint until it came back.

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

| Decision                                                        | Why                                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Postgres is the queue** (`FOR UPDATE SKIP LOCKED`)            | ~1.4k sends/s fits one database; one system to run; event + deliveries saved atomically            |
| **Fan-out inside `POST /events`, one transaction**              | There's never an event without its deliveries, even if the process crashes                         |
| **`Idempotency-Key` header, enforced by a `UNIQUE` constraint** | A sender retrying after a lost `202` doesn't create duplicates                                     |
| **Lease via `next_attempt_at`**                                 | Claiming a delivery pushes its due time 30s ahead; if the worker dies, it simply becomes due again |
| **Backoff 10s → 30s → 90s, ±20% jitter, then dead**             | Rides out a one-minute outage; jitter stops retry stampedes                                        |
| **Circuit breaker: 10 failures in a row → pause 1 min**         | Dead receivers stop occupying workers; paused time doesn't use up retries                          |
| **Worker sleeps when idle, woken in-memory by the API**         | The database can scale to zero (Neon free tier) instead of being polled every second               |
| **No ordering guarantee**                                       | Ordering means head-of-line blocking; receivers dedupe by id and refetch state instead             |

The table above is the short version of the full design: requirements, estimates, schema, trade-offs and a decision log.

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

## Deploying to Render (free)

Only `apps/x` is deployed. The shop and receiver are local stand-ins. The database is a free [Neon](https://neon.com) Postgres.

1. Push this repo to GitHub. In Render, choose **New → Blueprint** and pick the repo; [render.yaml](render.yaml) describes the service.
2. When Render asks for `DATABASE_URL`, paste the Neon **pooled** connection string. Render generates `API_KEY` itself; you'll find it under the service's **Environment** tab, and you need it to unlock the operator console.
3. Render builds with `pnpm --filter "x..." build` (X plus the shared packages it uses). It starts with the schema migration and then one process that runs both the API and the worker. Node 24 comes from [.node-version](.node-version).

On the free plan the service **sleeps after 15 minutes without visitors and takes about a minute to wake up**. Nothing is lost while it sleeps: pending deliveries wait in Postgres, and the worker picks them up as soon as the service wakes.

With `ALLOW_PRIVATE_URLS=false`, receiver URLs must be `https` and must resolve to public addresses, so the service can't be pointed at its own internal network.

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
