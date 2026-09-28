import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
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
            await prisma.internalRoleAssignment.deleteMany({
              where: { staffMembership: { userId: { in: userIds } } },
            });
            await prisma.internalStaffMembership.deleteMany({ where: { userId: { in: userIds } } });
            await prisma.securityAuditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
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

  interface RunCliOptions {
    timeoutMs?: number;
    executable?: string;
  }

  function runCli(
    args: string[],
    stdinInput: string = "",
    options: RunCliOptions = {}
  ): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise((resolve, reject) => {
      const tsxCliPath = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
      const scriptPath = path.resolve(process.cwd(), "scripts/provision-staff.ts");
      const executable = options.executable ?? process.execPath;
      const timeoutMs = options.timeoutMs ?? 15000;

      // Cross-platform, shell-free invocation using process.execPath directly.
      // Paths and argument values are passed as an array without shell interpolation.
      const cmdArgs = [tsxCliPath, scriptPath, ...args];

      let child: ChildProcess;
      try {
        child = spawn(executable, cmdArgs, {
          cwd: process.cwd(),
          shell: false,
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
      } catch (err) {
        return reject(err);
      }

      let stdout = "";
      let stderr = "";
      let settled = false;

      child.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            child.kill("SIGTERM");
          } catch {}
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {}
          }, 500);
          resolve({ code: null, stdout, stderr, timedOut: true });
        }
      }, timeoutMs);

      if (stdinInput) {
        child.stdin?.write(stdinInput + "\n");
      }
      child.stdin?.end();

      child.on("close", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ code, stdout, stderr, timedOut: false });
        }
      });
    });
  }

  it("executes clean Node 24 CLI subprocess, handles shell metacharacters in arguments literally without shell execution, asserts exit code 0, database rows, and zero PII in stdout/stderr", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const unique = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const email = `cli-staff-${unique}@waffarhacars.com`;
    const password = `CliSecurePassword-${unique}-123!`;
    const employeeNumber = `EMP-CLI-${unique.toUpperCase()}`;
    // Pass name with shell metacharacters (& and spaces) to prove literal handling without shell execution
    const fullName = `Alice & Bob Operations Specialist ${unique}`;
    createdEmails.push(email);

    const { code, stdout, stderr, timedOut } = await runCli(
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

    expect(timedOut).toBe(false);
    expect(code).toBe(0);
    expect(stdout).toContain("[Staff Provisioning] SUCCESS");
    expect(stdout).toContain("- Department: ADMIN");
    expect(stdout).toContain("- Role: PLATFORM_ADMIN");
    expect(stdout).toContain("- Must Change Password: true");
    expect(stdout).toContain("- Idempotent: false");

    // Assert strict zero-PII invariant in stdout and stderr
    expect(stdout).not.toContain(password);
    expect(stderr).not.toContain(password);
    expect(stdout).not.toContain(email);
    expect(stderr).not.toContain(email);
    expect(stdout).not.toContain(employeeNumber);
    expect(stderr).not.toContain(employeeNumber);

    // Verify database row creation in PostgreSQL with literal metacharacter preservation
    const prisma = getPrisma();
    const dbUser = await prisma.user.findUnique({
      where: { email },
      include: {
        internalStaffMembership: {
          include: { roleAssignments: true },
        },
        accounts: true,
      },
    });
    expect(dbUser).not.toBeNull();
    // Proves literal data preservation: & was not interpreted as backgrounding or shell command chaining
    expect(dbUser!.name).toBe(fullName);
    expect(dbUser!.internalStaffMembership).not.toBeNull();
    expect(dbUser!.internalStaffMembership!.employeeNumber).toBe(employeeNumber);
    expect(dbUser!.internalStaffMembership!.department).toBe("ADMIN");
    expect(dbUser!.internalStaffMembership!.mustChangePassword).toBe(true);
    expect(dbUser!.internalStaffMembership!.isActive).toBe(true);
    expect(dbUser!.internalStaffMembership!.roleAssignments.length).toBe(1);
    expect(dbUser!.internalStaffMembership!.roleAssignments[0].role).toBe("PLATFORM_ADMIN");
    expect(dbUser!.internalStaffMembership!.roleAssignments[0].isActive).toBe(true);

    const auditEvent = await prisma.securityAuditEvent.findFirst({
      where: { actorUserId: dbUser!.id },
    });
    expect(auditEvent).not.toBeNull();
    expect(auditEvent!.eventType).toBe("STAFF_PROVISIONED");
    expect(dbUser!.accounts.length).toBeGreaterThanOrEqual(1);
    expect(dbUser!.accounts[0].password).not.toBe(password); // scrypt hashed
  });

  it("proves duplicate bootstrap invocation exits with code 1 and preserves existing database state", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const unique1 = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const email1 = `cli-admin1-${unique1}@waffarhacars.com`;
    const password1 = `AdminPass1-${unique1}-123!`;
    const emp1 = `EMP-ADMIN1-${unique1.toUpperCase()}`;
    const name1 = `Primary Admin ${unique1}`;
    createdEmails.push(email1);

    // Initial bootstrap succeeds
    const firstRes = await runCli(
      ["--bootstrap-first-admin", "--email", email1, "--name", name1, "--employee", emp1],
      password1
    );
    expect(firstRes.code).toBe(0);

    // Attempt second bootstrap invocation
    const unique2 = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const email2 = `cli-admin2-${unique2}@waffarhacars.com`;
    const password2 = `AdminPass2-${unique2}-123!`;
    const emp2 = `EMP-ADMIN2-${unique2.toUpperCase()}`;
    const name2 = `Duplicate Admin ${unique2}`;
    createdEmails.push(email2);

    const secondRes = await runCli(
      ["--bootstrap-first-admin", "--email", email2, "--name", name2, "--employee", emp2],
      password2
    );

    // Duplicate bootstrap must exit with code 1 (ProvisioningError)
    expect(secondRes.code).toBe(1);
    expect(secondRes.stderr).toContain(
      "[Staff Provisioning] FAILED: BOOTSTRAP_ALREADY_INITIALIZED"
    );

    // Zero-PII check on failure
    expect(secondRes.stderr).not.toContain(password2);
    expect(secondRes.stderr).not.toContain(email2);
    expect(secondRes.stderr).not.toContain(emp2);

    // Final database state check: exactly 1 staff membership exists; second user was never created
    const prisma = getPrisma();
    const count = await prisma.internalStaffMembership.count();
    expect(count).toBe(1);
    const secondUser = await prisma.user.findUnique({ where: { email: email2 } });
    expect(secondUser).toBeNull();
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

  it("proves spawn failure with invalid executable rejects promptly with error", async () => {
    const invalidExecutable = path.resolve(process.cwd(), "nonexistent-binary-path-xyz");
    await expect(runCli(["--help"], "", { executable: invalidExecutable })).rejects.toThrow();
  });

  it("proves subprocess timeout cleanly terminates child process without hanging", async () => {
    // A timeout of 1ms forces prompt timeout resolution and process termination
    const res = await runCli(["--help"], "", { timeoutMs: 1 });
    expect(res.timedOut).toBe(true);
    expect(res.code).toBeNull();
  });
});
