import type { Pool } from "pg";
import type {
  Attempt,
  AttemptResult,
  Delivery,
  DeliveryDetails,
  DeliveryFilter,
  DeliveryStats,
  DeliveryStatus,
  DueDelivery,
  NextStep,
} from "../types/delivery";
import type { DeliveryQueue, DeliveryRecords } from "./interfaces";

type DeliveryRow = {
  id: string;
  event_id: string;
  event_type: string;
  endpoint_id: string;
  endpoint_url: string;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: Date;
  created_at: Date;
};

type DueRow = {
  id: string;
  attempts: number;
  event_id: string;
  type: string;
  payload: unknown;
  event_created_at: Date;
  endpoint_id: string;
  url: string;
  secret: string;
};

type AttemptRow = {
  id: string;
  attempted_at: Date;
  status_code: number | null;
  error: string | null;
  duration_ms: number;
};

function toDelivery(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    endpointId: row.endpoint_id,
    endpointUrl: row.endpoint_url,
    status: row.status,
    attemptCount: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
  };
}

function toAttempt(row: AttemptRow): Attempt {
  return {
    id: row.id,
    attemptedAt: row.attempted_at,
    statusCode: row.status_code,
    error: row.error,
    durationMs: row.duration_ms,
  };
}

const deliveryColumns = `
  d.id, d.event_id, ev.type AS event_type, d.endpoint_id, e.url AS endpoint_url,
  d.status, d.attempts, d.next_attempt_at, d.created_at`;

export class PostgresDeliveryRepository implements DeliveryQueue, DeliveryRecords {
  constructor(private readonly pool: Pool) {}

  async claimDue(limit: number, leaseMs: number): Promise<DueDelivery[]> {
    const { rows } = await this.pool.query<DueRow>(
      `WITH due AS (
         SELECT d.id FROM deliveries d
         JOIN endpoints e ON e.id = d.endpoint_id
         WHERE d.status = 'pending'
           AND d.next_attempt_at <= now()
           AND e.enabled
           AND (e.paused_until IS NULL OR e.paused_until <= now())
         ORDER BY d.next_attempt_at
         LIMIT $1
         FOR UPDATE OF d SKIP LOCKED
       ), claimed AS (
         UPDATE deliveries d
         SET next_attempt_at = now() + $2::int * interval '1 millisecond'
         FROM due WHERE d.id = due.id
         RETURNING d.id, d.attempts, d.event_id, d.endpoint_id
       )
       SELECT c.id, c.attempts, ev.id AS event_id, ev.type, ev.payload,
              ev.created_at AS event_created_at, e.id AS endpoint_id, e.url, e.secret
       FROM claimed c
       JOIN events ev ON ev.id = c.event_id
       JOIN endpoints e ON e.id = c.endpoint_id`,
      [limit, leaseMs],
    );

    return rows.map((row) => ({
      deliveryId: row.id,
      attemptCount: row.attempts,
      event: {
        id: row.event_id,
        type: row.type,
        payload: row.payload,
        createdAt: row.event_created_at,
      },
      endpoint: { id: row.endpoint_id, url: row.url, secret: row.secret },
    }));
  }

  async saveAttemptResult(
    deliveryId: string,
    result: AttemptResult,
    next: NextStep,
  ): Promise<void> {
    await this.pool.query(
      `WITH attempt AS (
         INSERT INTO attempts (delivery_id, status_code, error, duration_ms)
         VALUES ($1, $2, $3, $4)
       )
       UPDATE deliveries SET
         status = $5,
         attempts = attempts + 1,
         next_attempt_at = COALESCE($6::timestamptz, next_attempt_at)
       WHERE id = $1`,
      [
        deliveryId,
        result.statusCode,
        result.error,
        result.durationMs,
        next.status,
        next.status === "pending" ? next.nextAttemptAt : null,
      ],
    );
  }

  async msUntilNextDue(): Promise<number | null> {
    const { rows } = await this.pool.query<{ ms: number | null }>(
      `SELECT EXTRACT(EPOCH FROM
                min(GREATEST(d.next_attempt_at, COALESCE(e.paused_until, d.next_attempt_at))) - now()
              ) * 1000 AS ms
       FROM deliveries d
       JOIN endpoints e ON e.id = d.endpoint_id
       WHERE d.status = 'pending' AND e.enabled`,
    );
    const ms = rows[0]?.ms;
    return ms === null || ms === undefined ? null : Number(ms);
  }

  async list(filter: DeliveryFilter): Promise<Delivery[]> {
    const { rows } = await this.pool.query<DeliveryRow>(
      `SELECT ${deliveryColumns}
       FROM deliveries d
       JOIN events ev ON ev.id = d.event_id
       JOIN endpoints e ON e.id = d.endpoint_id
       WHERE ($1::text IS NULL OR d.status = $1)
         AND ($2::text IS NULL OR d.endpoint_id = $2)
       ORDER BY d.id DESC
       LIMIT $3`,
      [filter.status ?? null, filter.endpointId ?? null, filter.limit ?? 50],
    );
    return rows.map(toDelivery);
  }

  async findDetails(id: string): Promise<DeliveryDetails | undefined> {
    const delivery = await this.pool.query<DeliveryRow & { payload: unknown }>(
      `SELECT ${deliveryColumns}, ev.payload
       FROM deliveries d
       JOIN events ev ON ev.id = d.event_id
       JOIN endpoints e ON e.id = d.endpoint_id
       WHERE d.id = $1`,
      [id],
    );
    const row = delivery.rows[0];
    if (!row) return undefined;

    const attempts = await this.pool.query<AttemptRow>(
      "SELECT * FROM attempts WHERE delivery_id = $1 ORDER BY attempted_at",
      [id],
    );
    return { ...toDelivery(row), payload: row.payload, attempts: attempts.rows.map(toAttempt) };
  }

  async stats(endpointId?: string): Promise<DeliveryStats> {
    const { rows } = await this.pool.query<{ status: DeliveryStatus; count: number }>(
      `SELECT status, count(*)::int AS count FROM deliveries
       WHERE ($1::text IS NULL OR endpoint_id = $1)
       GROUP BY status`,
      [endpointId ?? null],
    );
    const stats: DeliveryStats = { pending: 0, delivered: 0, dead: 0 };
    for (const row of rows) stats[row.status] = row.count;
    return stats;
  }

  async replay(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE deliveries SET status = 'pending', attempts = 0, next_attempt_at = now()
       WHERE id = $1 AND status = 'dead'`,
      [id],
    );
    return rowCount === 1;
  }

  async replayDead(endpointId?: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE deliveries SET status = 'pending', attempts = 0, next_attempt_at = now()
       WHERE status = 'dead' AND ($1::text IS NULL OR endpoint_id = $1)`,
      [endpointId ?? null],
    );
    return rowCount ?? 0;
  }
}
