import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const url = process.env.DATABASE_URL.replace(
  /sslmode=(prefer|require|verify-ca)/gi,
  "sslmode=verify-full",
);

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
});
