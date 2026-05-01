import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let client: postgres.Sql | null = null;
let database: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for Drizzle-backed database operations");
  }

  if (!client) {
    client = postgres(url, { prepare: false });
  }

  if (!database) {
    database = drizzle(client, { schema });
  }

  return database;
}

export { schema };
