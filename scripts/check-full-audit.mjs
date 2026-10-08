import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const EXCEPTION_EXPIRES_AT = "2026-11-08T23:59:59.000Z";
export const EXCEPTION_ADVISORY = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";

// Exact npm audit propagation observed on the pinned lockfile. Any changed node or
// edge requires a fresh security review rather than silently widening the exception.
const ALLOWED_HIGH = Object.freeze({
  braces: {
    direct: false,
    via: ["GHSA-vfj7-8cjw-p6xm"],
    effects: ["chokidar", "micromatch"],
    nodes: ["node_modules/braces"],
  },
  micromatch: {
    direct: false,
    via: ["braces"],
    effects: ["fast-glob", "tailwindcss"],
    nodes: ["node_modules/micromatch"],
  },
  chokidar: {
    direct: false,
    via: ["braces"],
    effects: ["tailwindcss"],
    nodes: ["node_modules/chokidar"],
  },
  "fast-glob": {
    direct: false,
    via: ["micromatch"],
    effects: ["@next/eslint-plugin-next"],
    nodes: ["node_modules/fast-glob", "node_modules/tailwindcss/node_modules/fast-glob"],
  },
  "@next/eslint-plugin-next": {
    direct: false,
    via: ["fast-glob"],
    effects: ["eslint-config-next"],
    nodes: ["node_modules/@next/eslint-plugin-next"],
  },
  "eslint-config-next": {
    direct: true,
    via: ["@next/eslint-plugin-next"],
    effects: [],
    nodes: ["node_modules/eslint-config-next"],
  },
  tailwindcss: {
    direct: true,
    via: ["chokidar", "fast-glob", "micromatch", "postcss-nested", "postcss-selector-parser"],
    effects: [],
    nodes: ["node_modules/tailwindcss"],
  },
});

const SEVERITIES = ["info", "low", "moderate", "high", "critical"];

function fail(message) {
  throw new Error(`Full audit gate failed: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameMembers(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value) => typeof value === "string") &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

export function parseAuditJson(raw) {
  if (typeof raw !== "string" || !raw.trim()) fail("npm audit returned no JSON report");
  try {
    return JSON.parse(raw);
  } catch {
    fail("npm audit returned malformed JSON");
  }
}

export function evaluateAuditReport(report, lock, now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) fail("invalid security review time");
  if (date.getTime() > Date.parse(EXCEPTION_EXPIRES_AT)) {
    fail(`temporary braces exception expired on ${EXCEPTION_EXPIRES_AT}`);
  }
  if (
    !isRecord(report) ||
    report.error ||
    report.auditReportVersion !== 2 ||
    !isRecord(report.vulnerabilities)
  ) {
    fail("missing or invalid npm audit vulnerabilities report");
  }
  if (!isRecord(report.metadata?.vulnerabilities)) fail("missing audit severity summary");
  if (!isRecord(lock) || lock.lockfileVersion !== 3 || !isRecord(lock.packages)) {
    fail("missing or invalid npm v3 lockfile");
  }

  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  const allowed = [];
  const moderate = [];
  const entries = Object.entries(report.vulnerabilities);
  for (const [name, finding] of entries) {
    if (!isRecord(finding) || finding.name !== name || !SEVERITIES.includes(finding.severity)) {
      fail(`malformed finding for ${name}`);
    }
    if (
      typeof finding.isDirect !== "boolean" ||
      !Array.isArray(finding.via) ||
      !Array.isArray(finding.effects) ||
      !finding.effects.every((effect) => typeof effect === "string") ||
      !Array.isArray(finding.nodes) ||
      finding.nodes.length === 0 ||
      !finding.nodes.every((node) => typeof node === "string")
    ) {
      fail(`malformed dependency evidence for ${name}`);
    }
    for (const via of finding.via) {
      if (typeof via === "string") continue;
      if (!isRecord(via) || !SEVERITIES.includes(via.severity)) {
        fail(`malformed advisory evidence for ${name}`);
      }
      if (
        (via.severity === "high" || via.severity === "critical") &&
        finding.severity !== "high" &&
        finding.severity !== "critical"
      ) {
        fail(`unreported high-severity advisory affects ${name}`);
      }
    }
    counts[finding.severity]++;
    if (finding.severity === "moderate") moderate.push(name);
    if (finding.severity !== "high" && finding.severity !== "critical") continue;

    if (finding.severity === "critical") fail(`critical finding is not excepted: ${name}`);
    const expected = ALLOWED_HIGH[name];
    if (!expected) fail(`new high-severity package is not excepted: ${name}`);
    if (
      finding.isDirect !== expected.direct ||
      !sameMembers(finding.nodes, expected.nodes) ||
      !sameMembers(finding.effects, expected.effects)
    ) {
      fail(`dependency path or directness changed for ${name}`);
    }

    const via = finding.via.map((item) => {
      if (typeof item === "string") return item;
      if (
        name !== "braces" ||
        !isRecord(item) ||
        item.name !== "braces" ||
        item.dependency !== "braces" ||
        item.severity !== "high" ||
        item.url !== EXCEPTION_ADVISORY
      ) {
        fail(`new or changed advisory affects ${name}`);
      }
      return "GHSA-vfj7-8cjw-p6xm";
    });
    if (!sameMembers(via, expected.via)) fail(`advisory propagation changed for ${name}`);
    for (const node of finding.nodes) {
      if (lock.packages[node]?.dev !== true) {
        fail(`production or unverified dependency exposure for ${name} at ${node}`);
      }
    }
    allowed.push(name);
  }

  for (const severity of SEVERITIES) {
    if (report.metadata.vulnerabilities[severity] !== counts[severity]) {
      fail(`audit ${severity} summary does not match findings`);
    }
  }
  if (report.metadata.vulnerabilities.total !== entries.length) {
    fail("audit total does not match findings");
  }
  if (allowed.length > 0 && !allowed.includes("braces")) {
    fail("indirect exception exists without the original braces advisory");
  }
  return { allowed, moderate, counts };
}

function runAudit() {
  const windows = process.platform === "win32";
  const command = windows ? "cmd.exe" : "npm";
  const args = windows ? ["/d", "/s", "/c", "npm.cmd audit --json"] : ["audit", "--json"];
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 20_000_000,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    fail("npm audit could not complete reliably");
  }
  const report = parseAuditJson(result.stdout);
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const summary = evaluateAuditReport(report, lock);
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    process.stdout.write(`[full-audit] ${finding.severity}: ${name}\n`);
  }
  if (summary.allowed.length) {
    process.stdout.write(
      `[full-audit] TEMPORARY exception: ${EXCEPTION_ADVISORY}; dev-only paths ${summary.allowed.join(", ")}; expires ${EXCEPTION_EXPIRES_AT}; review owner @MohamedHanyAhmed.\n`
    );
  }
  process.stdout.write(
    `[full-audit] ${summary.counts.moderate} moderate finding(s) reported; no unexcepted high/critical findings.\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runAudit();
  } catch (error) {
    const message =
      error instanceof Error && error.message.startsWith("Full audit gate failed:")
        ? error.message
        : "Full audit gate failed: unexpected execution error";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
