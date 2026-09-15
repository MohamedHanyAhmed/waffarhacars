import { describe, it, expect } from "vitest";
import {
  isPortOpen,
  isProcessAlive,
  waitForPortRelease,
  terminateProcessTree,
  terminateChildProcess,
  cleanupSupervisor,
  waitForServer,
  run,
} from "../../../scripts/run-e2e.mjs";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

describe("E2E Test Runner Lifecycle & Process Supervisor", () => {
  it("detects actively bound and released ports using OS-allocated ephemeral port 0", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as net.AddressInfo;
    const assignedPort = addr.port;

    // Must detect port as open while server is active
    expect(await isPortOpen(assignedPort)).toBe(true);

    // Close the server and confirm port is detected as closed
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await isPortOpen(assignedPort)).toBe(false);
  });

  it("waitForPortRelease resolves true after an owned server releases its port", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as net.AddressInfo;
    const assignedPort = addr.port;

    setTimeout(() => {
      server.close();
    }, 100);

    const released = await waitForPortRelease(assignedPort, 2000);
    expect(released).toBe(true);
  });

  it("terminates an owned disposable child process cleanly using child.kill() first", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    const pid = child.pid;
    expect(typeof pid).toBe("number");
    expect(isProcessAlive(pid)).toBe(true);

    const result = await terminateChildProcess(child, pid);
    expect(result.attempted).toBe(true);
    expect(result.success).toBe(true);
    expect(result.pid).toBe(pid);

    let alive = true;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (!isProcessAlive(pid)) {
        alive = false;
        break;
      }
    }
    expect(alive).toBe(false);
  });

  it("falls back to argument-based taskkill when child.kill() fails to terminate process", async () => {
    let taskkillCalledWith: number | null = null;
    let aliveChecks = 0;

    const dummyChild = new EventEmitter() as unknown as import("node:child_process").ChildProcess;
    Object.assign(dummyChild, {
      pid: 12345,
      killed: false,
      exitCode: null,
      kill: () => true,
    });

    const mockDeps = {
      isProcessAlive: () => {
        aliveChecks++;
        return aliveChecks <= 2;
      },
      taskkillSync: (pid: number) => {
        taskkillCalledWith = pid;
        return { status: 0, stdout: "SUCCESS: Terminated", stderr: "" };
      },
    };

    const result = await terminateChildProcess(dummyChild, 12345, {
      timeoutMs: 100,
      deps: mockDeps,
    });

    expect(result.attempted).toBe(true);
    expect(result.method).toBe("fallback");
    expect(result.success).toBe(true);
    expect(taskkillCalledWith).toBe(12345);
  });

  it("cleanupSupervisor succeeds when all owned processes terminate and port releases", async () => {
    const mockDeps = {
      isProcessAlive: () => false,
      waitForPortRelease: async () => true,
    };

    const result = await cleanupSupervisor({
      serverPid: 20001,
      playwrightPid: 20002,
      port: 39999,
      deps: mockDeps,
    });

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("cleanupSupervisor reports error and fails when process termination fails (dependency injected)", async () => {
    const mockDeps = {
      timeoutMs: 50,
      pollTimeoutMs: 50,
      isProcessAlive: () => true, // simulates process that refuses to terminate
      taskkillSync: () => ({ status: 1, stdout: "", stderr: "Access is denied" }),
      waitForPortRelease: async () => true,
    };

    const result = await cleanupSupervisor({
      serverPid: 20003,
      port: 39998,
      deps: mockDeps,
    });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Server termination failed");
  });

  it("cleanupSupervisor reports error and fails when port release fails (dependency injected)", async () => {
    const mockDeps = {
      timeoutMs: 50,
      pollTimeoutMs: 50,
      isProcessAlive: () => false,
      waitForPortRelease: async () => false,
    };

    const result = await cleanupSupervisor({
      serverPid: 20004,
      port: 39997,
      deps: mockDeps,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("was not released"))).toBe(true);
  });

  it("simulated cleanup failure causes run() to return nonzero exit code 1", async () => {
    const origExitCode = process.exitCode;
    try {
      type MockProc = import("node:child_process").ChildProcess & {
        exitCode: number | null;
      };

      const createMockProc = (pid: number): MockProc => {
        const proc = new EventEmitter() as unknown as MockProc;
        Object.assign(proc, {
          pid,
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          exitCode: null,
          killed: false,
          kill: () => {
            proc.exitCode = 0;
            proc.emit("close", 0);
            return true;
          },
        });
        return proc;
      };

      const serverMock = createMockProc(30001);
      const pwMock = createMockProc(30002);

      let spawnCall = 0;
      const mockSpawn = () => {
        spawnCall++;
        if (spawnCall === 1) {
          return serverMock;
        }
        // Emit close asynchronously for Playwright
        setTimeout(() => {
          pwMock.exitCode = 0;
          pwMock.emit("close", 0);
        }, 50);
        return pwMock;
      };

      const mockDeps = {
        isPortOpen: async () => false,
        spawn: mockSpawn,
        waitForServer: async () => true,
        cleanupSupervisor: async () => ({
          success: false,
          errors: ["Simulated cleanup failure: port 3000 remained active"],
        }),
      };

      const exitCode = await run({
        port: 3000,
        forwardArgs: [],
        deps: mockDeps,
      });

      expect(exitCode).toBe(1);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = origExitCode;
    }
  });

  it("rejects invalid PIDs without targeting random or guessed process numbers", () => {
    const r1 = terminateProcessTree(null as unknown as number);
    expect(r1.attempted).toBe(false);
    expect(r1.success).toBe(false);
    expect(r1.errorMessage).toBe("Invalid PID provided");

    const r2 = terminateProcessTree(undefined as unknown as number);
    expect(r2.attempted).toBe(false);
    expect(r2.success).toBe(false);

    const r3 = terminateProcessTree(-5);
    expect(r3.attempted).toBe(false);
    expect(r3.success).toBe(false);

    const r4 = terminateProcessTree(0);
    expect(r4.attempted).toBe(false);
    expect(r4.success).toBe(false);
  });

  it("waitForServer succeeds on HTTP 200 and consumes response body", async () => {
    const testServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    });
    await new Promise<void>((resolve) => {
      testServer.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (testServer.address() as net.AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;

    const ready = await waitForServer(url, 2000);
    expect(ready).toBe(true);

    await new Promise<void>((resolve) => testServer.close(() => resolve()));
  });

  it("waitForServer rejects immediately when childProcess exits prematurely", async () => {
    const deadProcess = { exitCode: 1 } as unknown as import("node:child_process").ChildProcess;
    await expect(waitForServer("http://127.0.0.1:49999", 500, deadProcess)).rejects.toThrow(
      /exited prematurely with code 1/
    );
  });

  it("waitForServer rejects when endpoint fails to return HTTP 200 within timeout", async () => {
    const errorServer = http.createServer((_req, res) => {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Service Unavailable");
    });
    await new Promise<void>((resolve) => {
      errorServer.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (errorServer.address() as net.AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;

    await expect(waitForServer(url, 400)).rejects.toThrow(/failed to respond with HTTP 200/);

    await new Promise<void>((resolve) => errorServer.close(() => resolve()));
  });
});
