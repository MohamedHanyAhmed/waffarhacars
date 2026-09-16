import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");
const beforeContent = fs.readFileSync(schemaPath, "utf-8");

console.log("[auth:schema:check] Running Better Auth schema generator...");
try {
  execSync("npx auth generate --config src/lib/auth.ts --output prisma/schema.prisma -y", {
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
} catch (err) {
  console.error("[auth:schema:check] Schema generation failed:", err.message);
  process.exit(1);
}

const afterContent = fs.readFileSync(schemaPath, "utf-8");

if (beforeContent.replace(/\r\n/g, "\n").trim() !== afterContent.replace(/\r\n/g, "\n").trim()) {
  console.error("[auth:schema:check] ERROR: Schema drift detected in prisma/schema.prisma!");
  console.error("The committed Prisma schema does not match the output of auth generate.");
  process.exit(1);
}

console.log("[auth:schema:check] Schema check passed. Zero drift detected.");
process.exit(0);
