// One-shot migration pusher for Turso.
// Reads every prisma/migrations/*/migration.sql in lexical order and
// executes it against the database referenced by TURSO_DATABASE_URL
// and TURSO_AUTH_TOKEN. Intended for first-time deploy; for subsequent
// migrations, run with care (repeatedly applying the same SQL will
// error on ALTER / CREATE statements that already took effect).

import { createClient } from "@libsql/client";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  console.error("TURSO_DATABASE_URL is not set.");
  process.exit(1);
}

const db = createClient({ url, authToken });

const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const entries = readdirSync(migrationsDir)
  .filter((name) => {
    const full = path.join(migrationsDir, name);
    return statSync(full).isDirectory();
  })
  .sort();

async function main() {
  for (const name of entries) {
    const sqlPath = path.join(migrationsDir, name, "migration.sql");
    const sql = readFileSync(sqlPath, "utf8");
    process.stdout.write(`Applying ${name}... `);
    try {
      await db.executeMultiple(sql);
      console.log("ok");
    } catch (err) {
      console.log("failed");
      console.error(err);
      process.exit(1);
    }
  }
  console.log("All migrations applied.");
}

main();
