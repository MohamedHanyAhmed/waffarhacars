import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const repoRoot = process.cwd();
const schemaPath = path.resolve(repoRoot, "prisma/schema.prisma");
const committedContent = fs.readFileSync(schemaPath, "utf-8");

// Create an isolated temporary directory for non-mutating schema generation
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-schema-check-"));
const tempSchemaPath = path.join(tempDir, "schema.prisma");

// Seed the temporary schema file with the committed schema content so the CLI respects existing generator settings
fs.writeFileSync(tempSchemaPath, committedContent, "utf-8");

console.log(
  "[auth:schema:check] Running Better Auth pinned CLI in isolated temporary workspace..."
);
try {
  // Pinned local CLI execution targeting the temporary schema file
  execSync(
    `node node_modules/auth/dist/index.mjs generate --config src/lib/auth.schema.ts --output "${tempSchemaPath}" --adapter prisma --dialect postgresql -y`,
    {
      stdio: "inherit",
      env: process.env,
      shell: true,
      cwd: repoRoot,
    }
  );

  const generatedContent = fs.readFileSync(tempSchemaPath, "utf-8");

  const normalize = (s) => s.replace(/\r\n/g, "\n").trim();

  if (normalize(committedContent) !== normalize(generatedContent)) {
    console.error("[auth:schema:check] ERROR: Schema drift detected in prisma/schema.prisma!");
    console.error("The committed Prisma schema does not match the output of auth generate.");
    process.exit(1);
  }

  console.log("[auth:schema:check] Schema check passed. Zero drift detected (non-mutating).");
  process.exit(0);
} catch (err) {
  console.error("[auth:schema:check] Schema check failed:", err.message);
  process.exit(1);
} finally {
  // Clean up temporary workspace ensuring no repository mutation
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
}
