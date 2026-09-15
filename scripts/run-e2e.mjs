import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

export function isPortOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

export function isProcessAlive(pid) {
  if (!pid || typeof pid !== "number" || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && typeof err === "object" && "code" in err && err.code === "EPERM");
  }
}

/**
 * Executes argument-based taskkill.exe with shell: false.
 * Never invokes cmd.exe string parsing.
 *
 * @param {number} pid
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
export function defaultTaskkillSync(pid) {
  if (!pid || typeof pid !== "number" || pid <= 0) {
    return { status: 1, stdout: "", stderr: "Invalid PID provided to taskkill" };
  }
  const res = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    shell: false,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: res.status,
    stdout: res.stdout ? String(res.stdout) : "",
    stderr: res.stderr ? String(res.stderr) : "",
  };
}

export function defaultPosixKill(pid) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    process.kill(pid, "SIGKILL");
  }
}

/**
 * Terminates an owned child process using the mandatory strategy:
 * 1. Try childProcess.kill() first.
 * 2. Await the owned child's close event (bounded).
 * 3. Use argument-based taskkill.exe /PID <owned-pid> /T /F only as fallback.
 * 4. Bound every wait and verify process death.
 *
 * @param {import("node:child_process").ChildProcess | null} [childProcess]
 * @param {number | null} [pid]
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.pollTimeoutMs]
 * @param {object} [options.deps]
 */
export async function terminateChildProcess(childProcess = null, pid = null, options = {}) {
  const targetPid = pid || childProcess?.pid || null;
  const timeoutMs = options.timeoutMs ?? options.deps?.timeoutMs ?? 1500;
  const pollTimeoutMs = options.pollTimeoutMs ?? options.deps?.pollTimeoutMs ?? 500;
  const deps = options.deps || {};
  const platform = deps.platform ?? process.platform;

  const isAlive = deps.isProcessAlive || isProcessAlive;
  const killFn = deps.killProcess || ((proc, sig) => proc?.kill?.(sig));
  const taskkillFn = deps.taskkillSync || defaultTaskkillSync;
  const posixKillFn = deps.posixKill || defaultPosixKill;

  const result = {
    attempted: false,
    method: null,
    pid: targetPid,
    success: false,
    exitCode: null,
    errorMessage: null,
    taskkillResult: null,
  };

  // Safety check: Never kill guessed or invalid PIDs
  if (!targetPid || typeof targetPid !== "number" || targetPid <= 0) {
    result.errorMessage = "Invalid PID provided";
    return result;
  }

  result.attempted = true;

  // If process is already dead, return clean success immediately
  if (!isAlive(targetPid)) {
    result.success = true;
    result.exitCode = 0;
    result.method = "already_dead";
    return result;
  }

  // 1. Try serverProcess.kill() first
  try {
    if (childProcess && typeof childProcess.kill === "function") {
      killFn(childProcess, "SIGTERM");
      result.method = "child_kill";
    }
  } catch {
    // Non-fatal, fallback will execute
  }

  // Clean up stdio streams on child handle so they do not block event loop
  try {
    childProcess?.stdout?.destroy?.();
    childProcess?.stderr?.destroy?.();
  } catch {
    // Non-fatal
  }

  // 2. Await the owned child's close event (bounded)
  if (childProcess) {
    await new Promise((resolve) => {
      if (childProcess.killed || childProcess.exitCode !== null) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => resolve(false), timeoutMs);
      const onEnd = () => {
        clearTimeout(timer);
        resolve(true);
      };
      childProcess.once?.("close", onEnd);
      childProcess.once?.("exit", onEnd);
    });
  } else {
    // Polling fallback when only PID is available
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!isAlive(targetPid)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // Verify whether .kill() succeeded
  if (!isAlive(targetPid)) {
    result.success = true;
    result.exitCode = 0;
    if (!result.method) result.method = "child_kill";
    return result;
  }

  // 3. Fallback: argument-based taskkill.exe /PID <owned-pid> /T /F on Windows or SIGKILL on POSIX
  result.method = "fallback";
  if (platform === "win32") {
    try {
      const tk = taskkillFn(targetPid);
      result.taskkillResult = tk;
      if (tk.status === 0 || tk.status === 128 || !isAlive(targetPid)) {
        result.success = true;
        result.exitCode = 0;
      } else {
        result.success = false;
        result.exitCode = tk.status ?? 1;
        result.errorMessage =
          `taskkill failed with status ${tk.status}: ${tk.stderr || tk.stdout}`.trim();
      }
    } catch (err) {
      if (!isAlive(targetPid)) {
        result.success = true;
        result.exitCode = 0;
      } else {
        result.success = false;
        result.errorMessage = err instanceof Error ? err.message : String(err);
      }
    }
  } else {
    try {
      posixKillFn(targetPid);
      result.success = !isAlive(targetPid);
      result.exitCode = result.success ? 0 : 1;
    } catch (err) {
      result.success = !isAlive(targetPid);
      result.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  // Final bounded confirmation
  const pollStart = Date.now();
  while (Date.now() - pollStart < pollTimeoutMs) {
    if (!isAlive(targetPid)) {
      result.success = true;
      result.exitCode = 0;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  if (isAlive(targetPid)) {
    result.success = false;
    result.errorMessage = `Process with PID ${targetPid} remained alive after fallback termination.`;
  }

  return result;
}

/**
 * Backward-compatible wrapper for terminateProcessTree.
 *
 * @param {number} pid
 * @param {object} [options]
 */
export function terminateProcessTree(pid, options = {}) {
  const targetPid = pid;
  if (!targetPid || typeof targetPid !== "number" || targetPid <= 0) {
    return {
      attempted: false,
      platform: process.platform,
      success: false,
      exitCode: null,
      errorMessage: "Invalid PID provided",
      pid: targetPid,
    };
  }

  const isAlive = (options.deps?.isProcessAlive || isProcessAlive)(targetPid);
  if (!isAlive) {
    return {
      attempted: true,
      platform: process.platform,
      success: true,
      exitCode: 0,
      errorMessage: null,
      pid: targetPid,
    };
  }

  const platform = options.deps?.platform ?? process.platform;

  if (platform === "win32") {
    const tk = (options.deps?.taskkillSync || defaultTaskkillSync)(targetPid);
    const postAlive = (options.deps?.isProcessAlive || isProcessAlive)(targetPid);
    const success = tk.status === 0 || tk.status === 128 || !postAlive;
    return {
      attempted: true,
      platform,
      success,
      exitCode: success ? 0 : (tk.status ?? 1),
      errorMessage: success ? null : tk.stderr || tk.stdout || "taskkill failed",
      pid: targetPid,
    };
  } else {
    try {
      (options.deps?.posixKill || defaultPosixKill)(targetPid);
      const postAlive = (options.deps?.isProcessAlive || isProcessAlive)(targetPid);
      return {
        attempted: true,
        platform,
        success: !postAlive,
        exitCode: !postAlive ? 0 : 1,
        errorMessage: !postAlive ? null : "Process alive after SIGKILL",
        pid: targetPid,
      };
    } catch (err) {
      return {
        attempted: true,
        platform: process.platform,
        success: false,
        exitCode: 1,
        errorMessage: err instanceof Error ? err.message : String(err),
        pid: targetPid,
      };
    }
  }
}

/**
 * @param {number} port
 * @param {number} [timeoutMs]
 * @param {object} [deps]
 */
export async function waitForPortRelease(port, timeoutMs = 10000, deps = {}) {
  const isPort = deps.isPortOpen || isPortOpen;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const open = await isPort(port);
    if (!open) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 * @param {import("node:child_process").ChildProcess | null} [childProcess]
 */
export async function waitForServer(url, timeoutMs = 30000, childProcess = null) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (childProcess && childProcess.exitCode !== null) {
      throw new Error(
        `Server child process exited prematurely with code ${childProcess.exitCode} before becoming ready`
      );
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      const text = await res.text();
      if (res.status === 200 && text.length > 0) {
        return true;
      }
    } catch {
      // Connection refused or booting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server at ${url} failed to respond with HTTP 200 within ${timeoutMs}ms`);
}

/**
 * Bounded cleanup supervisor for both Playwright and Next.js child process trees.
 *
 * @param {object} params
 * @param {import("node:child_process").ChildProcess | null} [params.serverProcess]
 * @param {import("node:child_process").ChildProcess | null} [params.playwrightProcess]
 * @param {number | null} [params.serverPid]
 * @param {number | null} [params.playwrightPid]
 * @param {number} [params.port]
 * @param {object} [params.options]
 * @param {object} [params.deps]
 */
export async function cleanupSupervisor({
  serverProcess = null,
  playwrightProcess = null,
  serverPid = null,
  playwrightPid = null,
  port = 3000,
  options = {},
  deps = {},
}) {
  const effectiveServerPid = serverPid || serverProcess?.pid || null;
  const effectivePlaywrightPid = playwrightPid || playwrightProcess?.pid || null;
  const errors = [];
  const timeoutMs = options.timeoutMs ?? deps.timeoutMs ?? 1500;
  const pollTimeoutMs = options.pollTimeoutMs ?? deps.pollTimeoutMs ?? 500;

  // 1. Clean up Playwright child process if active
  if (effectivePlaywrightPid || playwrightProcess) {
    console.log(
      `[E2E Runner] Terminating tracked Playwright child process (PID ${effectivePlaywrightPid})...`
    );
    const pwTerm = await terminateChildProcess(playwrightProcess, effectivePlaywrightPid, {
      timeoutMs,
      pollTimeoutMs,
      deps,
    });
    if (!pwTerm.success) {
      errors.push(
        `Playwright termination failed for PID ${effectivePlaywrightPid}: ${pwTerm.errorMessage}`
      );
    }
  }

  // 2. Clean up Server child process
  if (effectiveServerPid || serverProcess) {
    console.log(
      `[E2E Runner] Terminating tracked Server child process (PID ${effectiveServerPid})...`
    );
    const srvTerm = await terminateChildProcess(serverProcess, effectiveServerPid, {
      timeoutMs,
      pollTimeoutMs,
      deps,
    });
    if (!srvTerm.success) {
      errors.push(
        `Server termination failed for PID ${effectiveServerPid}: ${srvTerm.errorMessage}`
      );
    }
  }

  // 3. Confirm port release (bounded)
  if (port) {
    const waitPort = deps.waitForPortRelease || waitForPortRelease;
    const portTimeout = options.portTimeoutMs ?? deps.portTimeoutMs ?? 10000;
    const released = await waitPort(port, portTimeout, deps);
    if (!released) {
      errors.push(`Port ${port} was not released within timeout.`);
    } else {
      console.log(`[E2E Runner] Port ${port} successfully released.`);
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

export async function run(options = {}) {
  const port = options.port ?? parseInt(process.env.PORT || "3000", 10);
  const baseUrl = options.baseUrl ?? (process.env.BASE_URL || `http://localhost:${port}`);
  const forwardArgs = options.forwardArgs ?? process.argv.slice(2);
  const deps = options.deps || {};

  const isPort = deps.isPortOpen || isPortOpen;
  const spawnFn = deps.spawn || spawn;

  // Pre-flight check: fail immediately without touching existing port owner
  if (await isPort(port)) {
    console.error(
      `[E2E Runner] Port ${port} is already in use by another process. Startup aborted.`
    );
    process.exitCode = 1;
    return 1;
  }

  let serverProcess = null;
  let playwrightProcess = null;
  let playwrightExitCode = 1;
  let isCleaningUp = false;

  async function performCleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;

    console.log(`[E2E Runner] Performing cleanup for tracked processes...`);
    const cleanupResult = await (deps.cleanupSupervisor || cleanupSupervisor)({
      serverProcess,
      playwrightProcess,
      serverPid: serverProcess?.pid || null,
      playwrightPid: playwrightProcess?.pid || null,
      port,
      deps,
    });

    if (!cleanupResult.success) {
      for (const err of cleanupResult.errors) {
        console.error(`[E2E Runner] Cleanup error: ${err}`);
      }
      process.exitCode = 1;
      return 1;
    }

    process.exitCode = playwrightExitCode;
    return playwrightExitCode;
  }

  const onSignal = async (sig) => {
    console.warn(`[E2E Runner] Received ${sig}. Initiating bounded cleanup...`);
    playwrightExitCode = 1;
    await performCleanup();
    process.exit(process.exitCode || 1);
  };

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    console.log(`[E2E Runner] Starting Next.js production server on port ${port}...`);
    serverProcess = spawnFn(
      process.execPath,
      ["./node_modules/next/dist/bin/next", "start", "-p", String(port)],
      {
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        env: { ...process.env, PORT: String(port) },
      }
    );

    const serverPid = serverProcess.pid;
    console.log(`[E2E Runner] Server process started with PID ${serverPid}.`);

    const MAX_LOG_BYTES = 65536;
    let serverOutput = "";
    serverProcess.stdout?.on?.("data", (chunk) => {
      if (serverOutput.length < MAX_LOG_BYTES) serverOutput += chunk.toString();
    });
    serverProcess.stderr?.on?.("data", (chunk) => {
      if (serverOutput.length < MAX_LOG_BYTES) serverOutput += chunk.toString();
    });

    const waitServer = deps.waitForServer || waitForServer;
    await waitServer(baseUrl, 30000, serverProcess);
    console.log(`[E2E Runner] Server is ready at ${baseUrl}. Launching Playwright...`);

    const testArgs = ["./node_modules/@playwright/test/cli.js", "test", ...forwardArgs];
    playwrightExitCode = await new Promise((resolve) => {
      playwrightProcess = spawnFn(process.execPath, testArgs, {
        stdio: "inherit",
        env: { ...process.env, BASE_URL: baseUrl, PORT: String(port) },
      });
      playwrightProcess.on?.("close", (code) => resolve(code ?? 1));
      playwrightProcess.on?.("error", (err) => {
        console.error("[E2E Runner] Failed to start Playwright:", err);
        resolve(1);
      });
    });
  } catch (err) {
    console.error("[E2E Runner] Error during server startup or execution:", err);
    playwrightExitCode = 1;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await performCleanup();
  }

  return process.exitCode;
}

if (process.argv[1] && process.argv[1].endsWith("run-e2e.mjs")) {
  run();
}
