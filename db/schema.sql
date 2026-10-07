CREATE TABLE IF NOT EXISTS endpoints (
  id                   text PRIMARY KEY,
  url                  text NOT NULL,
  event_types          text[] NOT NULL,
  secret               text NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  consecutive_failures int NOT NULL DEFAULT 0,
  paused_until         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id              text PRIMARY KEY,
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deliveries (
  id              bigserial PRIMARY KEY,
  event_id        text NOT NULL REFERENCES events(id),
  endpoint_id     text NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'delivered', 'dead')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, endpoint_id)
);

CREATE INDEX IF NOT EXISTS deliveries_due
  ON deliveries (next_attempt_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS attempts (
  id           bigserial PRIMARY KEY,
  delivery_id  bigint NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  status_code  int,
  error        text,
  duration_ms  int NOT NULL
);

CREATE INDEX IF NOT EXISTS attempts_by_delivery ON attempts (delivery_id);
