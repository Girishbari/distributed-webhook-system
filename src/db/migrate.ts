import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config";
import { createPool } from "./createPool";

async function migrate() {
  const pool = createPool(loadConfig().databaseUrl);
  const schema = await readFile(path.join(process.cwd(), "db", "schema.sql"), "utf8");

  await pool.query(schema);
  console.log("schema applied");
  await pool.end();
}

migrate();
