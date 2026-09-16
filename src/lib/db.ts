import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import pg from "pg";
import { getServerEnv, type ServerEnv } from "./env";

export interface DbContext {
  prisma: PrismaClient;
  pool: pg.Pool;
}

declare global {
  var __waffarhacars_db_context: DbContext | undefined;
}

export function createDbContext(env: ServerEnv): DbContext {
  if (env.APP_DATA_BACKEND !== "postgres" || !env.DATABASE_URL) {
    throw new Error("Database is not configured for postgres backend.");
  }

  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
    statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
  });

  // Handle errors on idle clients so they do not bubble as unhandled exceptions.
  // node-postgres automatically evicts the terminated client from the pool.
  pool.on("error", (_err) => {
    // Expected when idle backend connections are terminated by database administrator
  });

  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({
    adapter,
    log: env.APP_RUNTIME_PROFILE === "production" ? ["error"] : ["warn", "error"],
  });

  return { prisma, pool };
}

export function getDbContext(): DbContext {
  const env = getServerEnv();

  if (globalThis.__waffarhacars_db_context) {
    return globalThis.__waffarhacars_db_context;
  }

  const ctx = createDbContext(env);

  // In non-production profiles or development, preserve across module hot-reloading
  globalThis.__waffarhacars_db_context = ctx;

  return ctx;
}

export function getPrisma(): PrismaClient {
  return getDbContext().prisma;
}

export function getPool(): pg.Pool {
  return getDbContext().pool;
}

export async function disconnectDb(): Promise<void> {
  if (globalThis.__waffarhacars_db_context) {
    const { prisma, pool } = globalThis.__waffarhacars_db_context;
    await prisma.$disconnect();
    await pool.end();
    globalThis.__waffarhacars_db_context = undefined;
  }
}
