import { Pool, type PoolConfig } from "pg";
import { hasDatabaseConfig } from "@/lib/xmonitor/config";

declare global {
  // eslint-disable-next-line no-var
  var __xmonitorPool: Pool | undefined;
}

function poolConfigFromEnv(): PoolConfig {
  if (process.env.DATABASE_URL) {
    const sslMode = (process.env.PGSSLMODE || "").toLowerCase();
    const ssl = sslMode && sslMode !== "disable" ? { rejectUnauthorized: false } : undefined;
    return {
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    };
  }

  const host = process.env.PGHOST;
  const database = process.env.PGDATABASE;
  const user = process.env.PGUSER;

  if (!host || !database || !user) {
    throw new Error("Missing database configuration. Set DATABASE_URL or PGHOST/PGDATABASE/PGUSER.");
  }

  const sslMode = (process.env.PGSSLMODE || "").toLowerCase();

  return {
    host,
    port: Number.parseInt(process.env.PGPORT || "5432", 10),
    database,
    user,
    password: process.env.PGPASSWORD,
    ssl: sslMode && sslMode !== "disable" ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
}

export function getDbPool(): Pool {
  if (!global.__xmonitorPool) {
    global.__xmonitorPool = new Pool(poolConfigFromEnv());
  }
  return global.__xmonitorPool;
}

export function ensureDatabaseConfigured(): void {
  if (!hasDatabaseConfig()) {
    throw new Error("Database is not configured. Set DATABASE_URL or PG* variables.");
  }
}
