import type { Pool } from "pg";
import type { Endpoint, EndpointChanges } from "../types/endpoint";
import type { EndpointHealthRepository, EndpointRepository } from "./interfaces";

type EndpointRow = {
  id: string;
  url: string;
  event_types: string[];
  secret: string;
  enabled: boolean;
  created_at: Date;
};

function toEndpoint(row: EndpointRow): Endpoint {
  return {
    id: row.id,
    url: row.url,
    eventTypes: row.event_types,
    secret: row.secret,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}

export class PostgresEndpointRepository implements EndpointRepository, EndpointHealthRepository {
  constructor(private readonly pool: Pool) {}

  async insert(endpoint: Endpoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO endpoints (id, url, event_types, secret, enabled, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        endpoint.id,
        endpoint.url,
        endpoint.eventTypes,
        endpoint.secret,
        endpoint.enabled,
        endpoint.createdAt,
      ],
    );
  }

  async findAll(): Promise<Endpoint[]> {
    const { rows } = await this.pool.query<EndpointRow>(
      "SELECT * FROM endpoints ORDER BY created_at DESC",
    );
    return rows.map(toEndpoint);
  }

  async findByUrlAndEventType(url: string, eventType: string): Promise<Endpoint | undefined> {
    const { rows } = await this.pool.query<EndpointRow>(
      "SELECT * FROM endpoints WHERE url = $1 AND $2 = ANY(event_types) LIMIT 1",
      [url, eventType],
    );
    return rows[0] && toEndpoint(rows[0]);
  }

  async update(id: string, changes: EndpointChanges): Promise<Endpoint | undefined> {
    const { rows } = await this.pool.query<EndpointRow>(
      `UPDATE endpoints SET
         url         = COALESCE($2, url),
         event_types = COALESCE($3, event_types),
         enabled     = COALESCE($4, enabled)
       WHERE id = $1
       RETURNING *`,
      [id, changes.url ?? null, changes.eventTypes ?? null, changes.enabled ?? null],
    );
    return rows[0] && toEndpoint(rows[0]);
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM endpoints WHERE id = $1", [id]);
    return rowCount === 1;
  }

  async recordSuccess(endpointId: string): Promise<void> {
    await this.pool.query(
      `UPDATE endpoints SET consecutive_failures = 0, paused_until = NULL
       WHERE id = $1 AND consecutive_failures > 0`,
      [endpointId],
    );
  }

  async recordFailure(
    endpointId: string,
    failureThreshold: number,
    pauseMs: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE endpoints SET
         consecutive_failures = consecutive_failures + 1,
         paused_until = CASE
           WHEN consecutive_failures + 1 >= $2 THEN now() + $3::int * interval '1 millisecond'
           ELSE paused_until
         END
       WHERE id = $1`,
      [endpointId, failureThreshold, pauseMs],
    );
  }
}
