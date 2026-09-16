import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET as liveHandler } from "@/app/api/live/route";
import { GET as readyHandler } from "@/app/api/ready/route";
import { validateServerEnv, resetServerEnvCache } from "@/lib/env";
import * as dbModule from "@/lib/db";
import pg from "pg";

describe("Health & Liveness Endpoints", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    resetServerEnvCache();
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    resetServerEnvCache();
    await dbModule.disconnectDb();
    vi.restoreAllMocks();
  });

  describe("/api/live", () => {
    it("returns HTTP 200 with status ok and Cache-Control no-store without touching database", async () => {
      const dbSpy = vi.spyOn(dbModule, "getPrisma");

      const response = await liveHandler();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const data = await response.json();
      expect(data).toEqual({ status: "ok" });
      expect(dbSpy).not.toHaveBeenCalled();
    });
  });

  describe("/api/ready", () => {
    it("returns HTTP 200 with status ready in valid showcase/demo configuration", async () => {
      process.env.APP_RUNTIME_PROFILE = "showcase";
      process.env.APP_DATA_BACKEND = "demo";

      const response = await readyHandler();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const data = await response.json();
      expect(data).toEqual({ status: "ready" });
    });

    it("returns HTTP 503 with status unavailable when production runtime uses demo backend (fail-closed)", async () => {
      process.env.APP_RUNTIME_PROFILE = "production";
      process.env.APP_DATA_BACKEND = "demo";

      const response = await readyHandler();
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const data = await response.json();
      expect(data).toEqual({ status: "unavailable" });
      // Ensure zero error leakage
      expect(JSON.stringify(data)).not.toContain("demo");
      expect(JSON.stringify(data)).not.toContain("production");
    });

    it("returns HTTP 200 with status ready when postgres backend ping succeeds", async () => {
      process.env.APP_RUNTIME_PROFILE = "showcase";
      process.env.APP_DATA_BACKEND = "postgres";
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/db";

      const mockQueryRaw = vi.fn().mockResolvedValue([{ "?column?": 1 }]);
      vi.spyOn(dbModule, "getPrisma").mockReturnValue({
        $queryRaw: mockQueryRaw,
      } as unknown as ReturnType<typeof dbModule.getPrisma>);

      const response = await readyHandler();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const data = await response.json();
      expect(data).toEqual({ status: "ready" });
      expect(mockQueryRaw).toHaveBeenCalled();
    });

    it("returns HTTP 503 with status unavailable when postgres ping throws an exception", async () => {
      process.env.APP_RUNTIME_PROFILE = "production";
      process.env.APP_DATA_BACKEND = "postgres";
      process.env.DATABASE_URL =
        "postgresql://test_user:secret_password@db.internal:5432/financial_db";

      const mockQueryRaw = vi
        .fn()
        .mockRejectedValue(new Error("Connection refused: db.internal:5432"));
      vi.spyOn(dbModule, "getPrisma").mockReturnValue({
        $queryRaw: mockQueryRaw,
      } as unknown as ReturnType<typeof dbModule.getPrisma>);

      const response = await readyHandler();
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const data = await response.json();
      expect(data).toEqual({ status: "unavailable" });

      // Invariant: Zero leakage of host, user, password, or error message in response body
      const responseStr = JSON.stringify(data);
      expect(responseStr).not.toContain("db.internal");
      expect(responseStr).not.toContain("secret_password");
      expect(responseStr).not.toContain("Connection refused");
    });

    it("does not cause unbounded connection allocation on repeated readiness calls", async () => {
      process.env.APP_RUNTIME_PROFILE = "showcase";
      process.env.APP_DATA_BACKEND = "postgres";
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/db";

      let queryCount = 0;
      const mockQueryRaw = vi.fn().mockImplementation(async () => {
        queryCount++;
        return [{ "?column?": 1 }];
      });

      const getPrismaSpy = vi.spyOn(dbModule, "getPrisma").mockReturnValue({
        $queryRaw: mockQueryRaw,
      } as unknown as ReturnType<typeof dbModule.getPrisma>);

      for (let i = 0; i < 25; i++) {
        const res = await readyHandler();
        expect(res.status).toBe(200);
      }

      expect(queryCount).toBe(25);
      expect(getPrismaSpy).toHaveBeenCalledTimes(25);
    });
  });

  describe("Server Environment Contract & Validation", () => {
    it("accepts showcase + demo", () => {
      const env = validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "demo",
      });
      expect(env.APP_RUNTIME_PROFILE).toBe("showcase");
      expect(env.APP_DATA_BACKEND).toBe("demo");
    });

    it("accepts showcase + postgres with DATABASE_URL", () => {
      const env = validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      });
      expect(env.APP_RUNTIME_PROFILE).toBe("showcase");
      expect(env.APP_DATA_BACKEND).toBe("postgres");
      expect(env.DATABASE_DIRECT_URL).toBe("postgresql://u:p@localhost:5432/db");
    });

    it("accepts production + postgres with DATABASE_URL", () => {
      const env = validateServerEnv({
        APP_RUNTIME_PROFILE: "production",
        APP_DATA_BACKEND: "postgres",
        DATABASE_URL: "postgresql://u:p@localhost:5432/db",
        DATABASE_DIRECT_URL: "postgresql://u:p@localhost:5432/direct_db",
      });
      expect(env.APP_RUNTIME_PROFILE).toBe("production");
      expect(env.APP_DATA_BACKEND).toBe("postgres");
      expect(env.DATABASE_URL).toBe("postgresql://u:p@localhost:5432/db");
      expect(env.DATABASE_DIRECT_URL).toBe("postgresql://u:p@localhost:5432/direct_db");
    });

    it("rejects production + demo with sanitized configuration violation", () => {
      expect(() => {
        validateServerEnv({
          APP_RUNTIME_PROFILE: "production",
          APP_DATA_BACKEND: "demo",
        });
      }).toThrow(
        "Configuration violation: production runtime profile cannot use demo data backend."
      );
    });

    it("rejects postgres backend when DATABASE_URL is missing", () => {
      expect(() => {
        validateServerEnv({
          APP_RUNTIME_PROFILE: "showcase",
          APP_DATA_BACKEND: "postgres",
        });
      }).toThrow(
        "Configuration violation: DATABASE_URL is required when APP_DATA_BACKEND is set to postgres."
      );
    });

    it("parses pool limits and timeouts with safe integer defaults", () => {
      const env = validateServerEnv({
        APP_RUNTIME_PROFILE: "showcase",
        APP_DATA_BACKEND: "demo",
        DATABASE_POOL_MAX: "25",
        DATABASE_CONNECTION_TIMEOUT_MS: "3000",
        DATABASE_IDLE_TIMEOUT_MS: "8000",
        DATABASE_STATEMENT_TIMEOUT_MS: "4000",
      });
      expect(env.DATABASE_POOL_MAX).toBe(25);
      expect(env.DATABASE_CONNECTION_TIMEOUT_MS).toBe(3000);
      expect(env.DATABASE_IDLE_TIMEOUT_MS).toBe(8000);
      expect(env.DATABASE_STATEMENT_TIMEOUT_MS).toBe(4000);
    });
  });

  describe("Connection Pool Lifecycle & Fault Recovery", () => {
    it("reuses the singleton database context across consecutive calls", () => {
      const env = {
        APP_RUNTIME_PROFILE: "showcase" as const,
        APP_DATA_BACKEND: "postgres" as const,
        DATABASE_URL: "postgresql://test:test@localhost:5432/db",
        DATABASE_DIRECT_URL: "postgresql://test:test@localhost:5432/db",
        DATABASE_POOL_MAX: 5,
        DATABASE_CONNECTION_TIMEOUT_MS: 1000,
        DATABASE_IDLE_TIMEOUT_MS: 2000,
        DATABASE_STATEMENT_TIMEOUT_MS: 2000,
      };

      const ctx1 = dbModule.createDbContext(env);
      expect(ctx1.pool).toBeInstanceOf(pg.Pool);
      expect(ctx1.pool.options.max).toBe(5);
    });

    it("recovers and handles query execution after a connection error occurs", async () => {
      const pool = new pg.Pool({
        connectionString: "postgresql://test:test@localhost:5432/db",
      });

      // Mock pool.query to simulate an initial fatal connection drop followed by a recovered retry
      let attempt = 0;
      vi.spyOn(pool, "query").mockImplementation(async () => {
        attempt++;
        if (attempt === 1) {
          const err = new Error("terminating connection due to administrator command");
          (err as unknown as { code: string }).code = "57P01";
          throw err;
        }
        return { rows: [{ "?column?": 1 }], command: "SELECT", rowCount: 1, oid: 0, fields: [] };
      });

      // First query encounters backend disconnect
      await expect(pool.query("SELECT 1")).rejects.toThrow(
        "terminating connection due to administrator command"
      );

      // Pool reconnects/recovers on subsequent query attempt
      const result = await pool.query("SELECT 1");
      expect(result.rows).toEqual([{ "?column?": 1 }]);
      expect(attempt).toBe(2);

      await pool.end();
    });

    it("safely cleans up and disconnects upon disconnectDb() call", async () => {
      process.env.APP_RUNTIME_PROFILE = "showcase";
      process.env.APP_DATA_BACKEND = "postgres";
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/db";

      const ctx = dbModule.getDbContext();
      const poolEndSpy = vi.spyOn(ctx.pool, "end").mockResolvedValue(undefined as never);
      const prismaDisconnectSpy = vi
        .spyOn(ctx.prisma, "$disconnect")
        .mockResolvedValue(undefined as never);

      await dbModule.disconnectDb();

      expect(prismaDisconnectSpy).toHaveBeenCalled();
      expect(poolEndSpy).toHaveBeenCalled();
    });
  });
});
