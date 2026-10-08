import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPool } from "./createPool";

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const pool = createPool(databaseUrl);
  const schema = await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf8");

  await pool.query(schema);
  console.log("schema applied");
  await pool.end();
}

migrate();
