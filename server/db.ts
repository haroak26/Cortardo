import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { WebSocket } from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = WebSocket;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function normalizeConnectionString(url: string): string {
  return url.replace(
    /sslmode=(prefer|require|verify-ca)/gi,
    "sslmode=verify-full",
  );
}

const connectionString = normalizeConnectionString(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle(pool, { schema });
