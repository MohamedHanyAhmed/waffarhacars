import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkAuthSchema } from "../../../scripts/check-auth-schema.mjs";

describe("checkAuthSchema Lifecycle and Cleanup Unit Test Suite", () => {
  const repoRoot = process.cwd();
  const realSchemaPath = path.resolve(repoRoot, "prisma/schema.prisma");
  let committedSchemaBytes: Buffer;
  const tempFixtureDirs: string[] = [];

  beforeEach(() => {
    committedSchemaBytes = fs.readFileSync(realSchemaPath);
  });

  afterEach(() => {
    // Assert committed schema is byte-identical to baseline after every test
    const currentBytes = fs.readFileSync(realSchemaPath);
    expect(currentBytes.equals(committedSchemaBytes)).toBe(true);

    // Clean up any test-specific mock directories
    for (const d of tempFixtureDirs) {
      try {
        if (fs.existsSync(d)) {
          fs.rmSync(d, { recursive: true, force: true });
        }
      } catch {}
    }
    tempFixtureDirs.length = 0;
  });

  it("proves cleanup after success and byte-identical committed schema", () => {
    const result = checkAuthSchema({ verbose: false });

    expect(result.exitCode).toBe(0);
    expect(result.executionError).toBeNull();
    // Temporary directory must be completely removed
    expect(fs.existsSync(result.tempDir)).toBe(false);
  });

  it("proves cleanup after detected drift and byte-identical committed schema", () => {
    // Create a temporary mock schema file with artificial drift
    const mockFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-drift-test-"));
    tempFixtureDirs.push(mockFixtureDir);
    const mockSchemaPath = path.join(mockFixtureDir, "schema.prisma");

    // Seed mock schema with content missing the User table
    const modifiedSchemaContent = committedSchemaBytes
      .toString("utf-8")
      .replace(/model User \{[\s\S]*?\n\}/, "// User model removed to induce drift");
    fs.writeFileSync(mockSchemaPath, modifiedSchemaContent, "utf-8");

    const result = checkAuthSchema({
      schemaPath: mockSchemaPath,
      verbose: false,
    });

    expect(result.exitCode).toBe(1);
    // Temporary directory must be completely removed even when drift is detected
    expect(fs.existsSync(result.tempDir)).toBe(false);
  });

  it("proves cleanup after generator failure and byte-identical committed schema", () => {
    const result = checkAuthSchema({
      configPath: path.resolve(repoRoot, "non-existent-config.ts"),
      verbose: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.executionError).not.toBeNull();
    // Temporary directory must be completely removed even on process/CLI exception
    expect(fs.existsSync(result.tempDir)).toBe(false);
  });
});
