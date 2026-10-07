import type { Pool } from "pg";
import type { WebhookEvent } from "../types/event";
import type { EventRepository, SavedEvent } from "./interfaces";

export class PostgresEventRepository implements EventRepository {
  constructor(private readonly pool: Pool) {}

  async saveWithDeliveries(event: WebhookEvent, onlyEndpointId?: string): Promise<SavedEvent> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const inserted = await client.query(
        `INSERT INTO events (id, type, payload, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [event.id, event.type, JSON.stringify(event.payload), event.idempotencyKey, event.createdAt],
      );

      if (inserted.rowCount === 0) {
        const existing = await client.query<{ id: string }>(
          "SELECT id FROM events WHERE idempotency_key = $1",
          [event.idempotencyKey],
        );
        await client.query("COMMIT");
        return { eventId: existing.rows[0].id, created: false };
      }

      await client.query(
        `INSERT INTO deliveries (event_id, endpoint_id)
         SELECT $1, id FROM endpoints
         WHERE enabled AND $2 = ANY(event_types) AND ($3::text IS NULL OR id = $3)
         ON CONFLICT DO NOTHING`,
        [event.id, event.type, onlyEndpointId ?? null],
      );

      await client.query("COMMIT");
      return { eventId: event.id, created: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
