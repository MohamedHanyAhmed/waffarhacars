import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { getPrisma, disconnectDb } from "@/lib/db";
import { resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import pg from "pg";

const DEFAULT_TEST_DB_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/waffarhacars_test";
const TEST_SECRET = "test-secret-at-least-32-characters-long-12345";

describe("Real CLI Subprocess Staff Provisioning Integration Suite", () => {
  let isDbReachable = false;
  const originalEnv = { ...process.env };
  const createdEmails: string[] = [];

  beforeAll(async () => {
    const probe = new pg.Client({
      connectionString: DEFAULT_TEST_DB_URL,
      connectionTimeoutMillis: 2000,
    });
    try {
      await probe.connect();
      isDbReachable = true;
    } catch {
      isDbReachable = false;
    } finally {
      await probe.end().catch(() => {});
    }
  });

  beforeEach(async () => {
    resetServerEnvCache();
    resetAuth();
    process.env = { ...originalEnv };
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "postgres";
    process.env.DATABASE_URL = DEFAULT_TEST_DB_URL;
    process.env.DATABASE_DIRECT_URL = DEFAULT_TEST_DB_URL;
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.PHONE_LOOKUP_HMAC_KEY = "test-lookup-key-at-least-32-characters-long-12345";
    process.env.STAFF_LOGIN_HMAC_KEY = "test-staff-login-key-at-least-32-characters-long-12345";
    process.env.OTP_PEPPER_SECRET = "test-otp-pepper-key-at-least-32-characters-long-12345";
    process.env.PHONE_ALIAS_HMAC_KEY = "test-phone-alias-key-at-least-32-characters-long-12345";

    if (isDbReachable) {
      try {
        const prisma = getPrisma();
        await prisma.rateLimitBucket.deleteMany({});
      } catch {}
    }
  });

  afterEach(async () => {
    if (isDbReachable) {
      try {
        const prisma = getPrisma();
        await prisma.rateLimitBucket.deleteMany({});
        if (createdEmails.length > 0) {
          const users = await prisma.user.findMany({
            where: { email: { in: createdEmails } },
            select: { id: true },
          });
          const userIds = users.map((u) => u.id);
          if (userIds.length > 0) {
            await prisma.twoFactor.deleteMany({ where: { userId: { in: userIds } } });
            await prisma.internalStaffMembership.deleteMany({ where: { userId: { in: userIds } } });
            await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
            await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
            await prisma.user.deleteMany({ where: { id: { in: userIds } } });
          }
        }
      } catch (err) {
        console.error("Cleanup error in afterEach:", err);
      }
      createdEmails.length = 0;
    }
    await disconnectDb();
    resetAuth();
    resetServerEnvCache();
    process.env = { ...originalEnv };
  });

  afterAll(async () => {
    if (isDbReachable) {
      try {
        const prisma = getPrisma();
        await prisma.rateLimitBucket.deleteMany({});
      } catch {}
    }
    await disconnectDb();
    resetAuth();
    resetServerEnvCache();
    process.env = originalEnv;
  });

  function runCli(
    args: string[],
    stdinInput: string = ""
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const scriptPath = path.resolve(process.cwd(), "scripts/provision-staff.ts");
      const isWindows = process.platform === "win32";
      const cmd = isWindows ? "cmd.exe" : "npx";
      const cmdArgs = isWindows
        ? ["/c", "npx", "tsx", scriptPath, ...args]
        : ["tsx", scriptPath, ...args];

      const child = spawn(cmd, cmdArgs, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: DEFAULT_TEST_DB_URL,
          DATABASE_DIRECT_URL: DEFAULT_TEST_DB_URL,
          BETTER_AUTH_SECRET: TEST_SECRET,
          BETTER_AUTH_URL: "http://localhost:3000",
          APP_RUNTIME_PROFILE: "showcase",
          APP_DATA_BACKEND: "postgres",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      if (stdinInput) {
        child.stdin.write(stdinInput + "\n");
      }
      child.stdin.end();

      child.on("close", (code) => {
        resolve({ code, stdout, stderr });
      });
    });
  }

  it("executes clean Node 24 CLI subprocess, asserts exit code 0, database rows, and zero PII in stdout/stderr", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const unique = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const email = `cli-staff-${unique}@waffarhacars.com`;
    const password = `CliSecurePassword-${unique}-123!`;
    const employeeNumber = `EMP-CLI-${unique.toUpperCase()}`;
    const fullName = `CLI Specialist ${unique}`;
    createdEmails.push(email);

    const { code, stdout, stderr } = await runCli(
      [
        "--bootstrap-first-admin",
        "--email",
        email,
        "--name",
        fullName,
        "--employee",
        employeeNumber,
      ],
      password
    );

    expect(code).toBe(0);
    expect(stdout).toContain("[Staff Provisioning] SUCCESS");
    expect(stdout).toContain("- Department: ADMIN");
    expect(stdout).toContain("- Must Change Password: true");
    expect(stdout).toContain("- Idempotent: false");

    // Assert strict zero-PII invariant in stdout and stderr
    expect(stdout).not.toContain(password);
    expect(stderr).not.toContain(password);
    expect(stdout).not.toContain(email);
    expect(stderr).not.toContain(email);
    expect(stdout).not.toContain(employeeNumber);
    expect(stderr).not.toContain(employeeNumber);

    // Verify database row creation in PostgreSQL
    const prisma = getPrisma();
    const dbUser = await prisma.user.findUnique({
      where: { email },
      include: { internalStaffMembership: true, accounts: true },
    });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.internalStaffMembership).not.toBeNull();
    expect(dbUser!.internalStaffMembership!.employeeNumber).toBe(employeeNumber);
    expect(dbUser!.internalStaffMembership!.department).toBe("ADMIN");
    expect(dbUser!.internalStaffMembership!.mustChangePassword).toBe(true);
    expect(dbUser!.internalStaffMembership!.isActive).toBe(true);
    expect(dbUser!.accounts.length).toBeGreaterThanOrEqual(1);
    expect(dbUser!.accounts[0].password).not.toBe(password); // scrypt hashed
  });

  it("proves CLI rejects unsafe --password argument with exit code 2 and helpful error", async () => {
    const { code, stderr } = await runCli([
      "--email",
      "test@waffarhacars.com",
      "--password",
      "ShouldFail123!",
    ]);

    expect(code).toBe(2);
    expect(stderr).toContain("Passwords cannot be passed via command line flags");
  });

  it("proves CLI rejects missing required arguments in non-TTY mode with exit code 2", async () => {
    const { code, stderr } = await runCli(["--email", "test@waffarhacars.com"], "SomePassword123!");

    expect(code).toBe(2);
    expect(stderr).toContain("MISSING_REQUIRED_ARGUMENTS");
  });
});
