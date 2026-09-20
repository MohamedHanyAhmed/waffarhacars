import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Runs the schema drift check in an isolated temporary directory.
 *
 * Invariants:
 * 1. Zero process.exit() calls.
 * 2. Exit code is assigned to process.exitCode only after cleanup is guaranteed.
 * 3. Uses execFileSync(process.execPath, argumentArray) with no shell: true.
 * 4. Always removes the exact temporary directory in finally block.
 * 5. Cleanup failures fail the check with a sanitized error message (exitCode = 1).
 * 6. Committed schema remains untouched and byte-identical.
 */
export function checkAuthSchema(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const schemaPath = options.schemaPath || path.resolve(repoRoot, "prisma/schema.prisma");
  const configPath = options.configPath || path.resolve(repoRoot, "src/lib/auth.schema.ts");
  const cliScriptPath =
    options.cliScriptPath || path.resolve(repoRoot, "node_modules/auth/dist/index.mjs");

  const committedContent = fs.readFileSync(schemaPath, "utf-8");

  // Create an isolated temporary directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-schema-check-"));
  const tempSchemaPath = path.join(tempDir, "schema.prisma");

  let exitCode = 0;
  let executionError = null;

  try {
    // Seed temporary schema with committed content so CLI respects existing generator settings
    fs.writeFileSync(tempSchemaPath, committedContent, "utf-8");

    if (options.verbose !== false) {
      console.log(
        "[auth:schema:check] Running Better Auth pinned CLI in isolated temporary workspace..."
      );
    }

    // Direct invocation without shell: true
    execFileSync(
      process.execPath,
      [
        cliScriptPath,
        "generate",
        "--config",
        configPath,
        "--output",
        tempSchemaPath,
        "--adapter",
        "prisma",
        "--dialect",
        "postgresql",
        "-y",
      ],
      {
        cwd: repoRoot,
        stdio: options.stdio || (options.verbose === false ? "ignore" : "inherit"),
        env: { ...process.env, ...(options.env || {}) },
      }
    );

    const generatedContent = fs.readFileSync(tempSchemaPath, "utf-8");
    const normalize = (s) => s.replace(/\r\n/g, "\n").trim();

    if (normalize(committedContent) !== normalize(generatedContent)) {
      if (options.verbose !== false) {
        console.error("[auth:schema:check] ERROR: Schema drift detected in prisma/schema.prisma!");
        console.error("The committed Prisma schema does not match the output of auth generate.");
      }
      exitCode = 1;
    } else {
      if (options.verbose !== false) {
        console.log("[auth:schema:check] Schema check passed. Zero drift detected (non-mutating).");
      }
    }
  } catch (err) {
    executionError = err;
    if (options.verbose !== false) {
      console.error("[auth:schema:check] Schema check execution failed.");
    }
    exitCode = 1;
  } finally {
    // Cleanup must always run and cannot be bypassed
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      if (options.verbose !== false) {
        console.error("[auth:schema:check] Cleanup failed: unable to remove temporary directory.");
      }
      exitCode = 1;
    }
  }

  return {
    exitCode,
    tempDir,
    executionError,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (isMain) {
  const result = checkAuthSchema();
  process.exitCode = result.exitCode;
}
