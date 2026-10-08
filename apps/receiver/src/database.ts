import { Pool } from "pg";

export async function createDatabaseIfMissing(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  const name = target.pathname.slice(1);
  const admin = new URL(databaseUrl);
  admin.pathname = "/postgres";

  const pool = new Pool({ connectionString: admin.toString() });
  const { rowCount } = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (rowCount === 0) {
    await pool.query(`CREATE DATABASE "${name.replaceAll('"', "")}"`);
    console.log(`created database "${name}"`);
  }
  await pool.end();
}

export async function createTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receiver_endpoints (
      name        text PRIMARY KEY,
      endpoint_id text NOT NULL,
      secret      text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_events (
      receiver     text NOT NULL,
      event_id     text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (receiver, event_id)
    );
  `);
}
