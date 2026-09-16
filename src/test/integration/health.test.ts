import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { GET as liveHandler } from "@/app/api/live/route";
import { GET as readyHandler } from "@/app/api/ready/route";
import { validateServerEnv, resetServerEnvCache } from "@/lib/env";
import { getPrisma, getPool, disconnectDb } from "@/lib/db";

const DEFAULT_TEST_DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";

describe("Real PostgreSQL 17 Integration & Health Infrastructure Suite", () => {
  let isDbReachable = false;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    // Probe database connectivity to establish baseline
    const probe = new pg.Client({
      connectionString: DEFAULT_TEST_DB_URL,
      connectionTimeoutMillis: 3000,
    });
    try {
      await probe.connect();
      const res = await probe.query("SELECT 1 AS probe");
      if (res.rows[0]?.probe === 1) {
        isDbReachable = true;
      }
      await probe.end();
    } catch {
      isDbReachable = false;
    }
  });

  beforeEach(() => {
    resetServerEnvCache();
    process.env = { ...originalEnv };
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "postgres";
    process.env.DATABASE_URL = DEFAULT_TEST_DB_URL;
    process.env.DATABASE_DIRECT_URL = DEFAULT_TEST_DB_URL;
  });

  afterEach(async () => {
    await disconnectDb();
    resetServerEnvCache();
    process.env = { ...originalEnv };
  });

  afterAll(async () => {
    await disconnectDb();
    resetServerEnvCache();
    process.env = originalEnv;
  });

  it("proves Prisma connects to real PostgreSQL and executes a raw query", async () => {
    if (!isDbReachable) {
      throw new Error(
        `PostgreSQL 17 is not reachable at ${DEFAULT_TEST_DB_URL}. Run 'npm run db:test:up' before executing integration tests.`
      );
    }

    const prisma = getPrisma();
    const result = await prisma.$queryRaw<Array<{ connected: number }>>`SELECT 1 as connected`;

    expect(result).toBeDefined();
    expect(result.length).toBe(1);
    expect(result[0].connected).toBe(1);
  });

  it("proves /api/ready returns 200 with status ready through actual Prisma SELECT 1", async () => {
    if (!isDbReachable) {
      throw new Error(
        `PostgreSQL 17 is not reachable at ${DEFAULT_TEST_DB_URL}. Run 'npm run db:test:up' before executing integration tests.`
      );
    }

    const response = await readyHandler();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const data = await response.json();
    expect(data).toEqual({ status: "ready" });
  });

  it("proves an unavailable PostgreSQL endpoint returns 503 with sanitized body", async () => {
    // Point to an invalid, unavailable port with a short connection timeout
    process.env.DATABASE_URL =
      "postgresql://test_user:test_password@localhost:54329/waffarhacars_test";
    process.env.DATABASE_CONNECTION_TIMEOUT_MS = "500";
    resetServerEnvCache();
    await disconnectDb();

    const response = await readyHandler();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const data = await response.json();
    expect(data).toEqual({ status: "unavailable" });

    // Strict sanitization invariants: no database credentials, URLs, hostnames, or error strings
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("localhost");
    expect(serialized).not.toContain("54329");
    expect(serialized).not.toContain("test_password");
    expect(serialized).not.toContain("ECONNREFUSED");
  });

  it("proves /api/live returns 200 with status ok while PostgreSQL is unavailable", async () => {
    // Point to an unavailable database
    process.env.DATABASE_URL =
      "postgresql://test_user:test_password@localhost:54329/waffarhacars_test";
    process.env.DATABASE_CONNECTION_TIMEOUT_MS = "500";
    resetServerEnvCache();
    await disconnectDb();

    // Verify readiness fails
    const readyRes = await readyHandler();
    expect(readyRes.status).toBe(503);

    // Verify liveness remains HTTP 200 ok with Cache-Control: no-store
    const liveRes = await liveHandler();
    expect(liveRes.status).toBe(200);
    expect(liveRes.headers.get("Cache-Control")).toBe("no-store");

    const liveData = await liveRes.json();
    expect(liveData).toEqual({ status: "ok" });
  });

  it("proves real connection termination via pg_terminate_backend and subsequent pool recovery", async () => {
    if (!isDbReachable) {
      throw new Error(
        `PostgreSQL 17 is not reachable at ${DEFAULT_TEST_DB_URL}. Run 'npm run db:test:up' before executing integration tests.`
      );
    }

    const pool = getPool();

    // 1. Obtain a connection from the pool and record its real backend PID
    const client = await pool.connect();
    const pidRes = await client.query("SELECT pg_backend_pid() AS pid");
    const targetPid: number = pidRes.rows[0].pid;
    expect(targetPid).toBeGreaterThan(0);
    client.release();

    // 2. Terminate that specific connection from a separate administrative client
    const admin = new pg.Client({
      connectionString: DEFAULT_TEST_DB_URL,
    });
    await admin.connect();
    const termRes = await admin.query("SELECT pg_terminate_backend($1) AS terminated", [targetPid]);
    expect(termRes.rows[0].terminated).toBe(true);
    await admin.end();

    // Allow socket to receive termination signal and trigger pool eviction
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 3. Prove that the application pool detects the terminated backend and recovers seamlessly
    const prisma = getPrisma();
    const recoveredResult = await prisma.$queryRaw<
      Array<{ recovered: number }>
    >`SELECT 1 as recovered`;
    expect(recoveredResult[0].recovered).toBe(1);
  });

  it("proves repeated real readiness probes remain within configured connection bounds", async () => {
    if (!isDbReachable) {
      throw new Error(
        `PostgreSQL 17 is not reachable at ${DEFAULT_TEST_DB_URL}. Run 'npm run db:test:up' before executing integration tests.`
      );
    }

    process.env.DATABASE_POOL_MAX = "5";
    resetServerEnvCache();
    await disconnectDb();

    // Execute 25 consecutive readiness probes against the live PostgreSQL instance
    for (let i = 0; i < 25; i++) {
      const res = await readyHandler();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ status: "ready" });
    }

    // Inspect real pg_stat_activity to verify connections to waffarhacars_test do not exceed pool max
    const inspector = new pg.Client({ connectionString: DEFAULT_TEST_DB_URL });
    await inspector.connect();
    const statRes = await inspector.query(
      "SELECT count(*)::int AS conn_count FROM pg_stat_activity WHERE datname = 'waffarhacars_test' AND pid <> pg_backend_pid()"
    );
    await inspector.end();

    const activeConnections = statRes.rows[0].conn_count;
    // Must remain strictly bounded by pool maximum (<= 5)
    expect(activeConnections).toBeLessThanOrEqual(5);
  });

  it("proves fail-closed behavior on invalid server environment configurations", () => {
    // production + demo strictly forbidden
    expect(() => {
      validateServerEnv({
        APP_RUNTIME_PROFILE: "production",
        APP_DATA_BACKEND: "demo",
      });
    }).toThrow("Configuration error: Production runtime profile cannot use demo data backend.");

    // Missing profile
    expect(() => {
      validateServerEnv({
        APP_DATA_BACKEND: "demo",
      });
    }).toThrow("Configuration error: Invalid server environment configuration.");

    // Missing backend
    expect(() => {
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
      });
    }).toThrow("Configuration error: Invalid server environment configuration.");

    // Invalid URL protocol
    expect(() => {
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: "mysql://user:pass@localhost:3306/db",
      });
    }).toThrow("Configuration error: DATABASE_URL must be a valid PostgreSQL connection string.");

    // Out-of-bounds pool max
    expect(() => {
      validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "demo",
        DATABASE_POOL_MAX: "150",
      });
    }).toThrow("Configuration error: Invalid server environment configuration.");
  });
});
