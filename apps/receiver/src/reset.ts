import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rowCount } = await pool.query("DELETE FROM processed_events");
console.log(`forgot ${rowCount} processed events (endpoints and secrets are kept)`);
await pool.end();
