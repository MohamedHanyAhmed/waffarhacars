import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  evaluateAuditReport,
  parseAuditJson,
  EXCEPTION_ADVISORY,
  EXCEPTION_EXPIRES_AT,
} from "../../../scripts/check-full-audit.mjs";

const lock = JSON.parse(readFileSync(path.resolve(process.cwd(), "package-lock.json"), "utf8"));
const reviewTime = new Date("2026-10-08T12:00:00Z");

function finding(
  name: string,
  severity: string,
  isDirect: boolean,
  via: Array<string | Record<string, unknown>>,
  effects: string[],
  nodes: string[]
) {
  return { name, severity, isDirect, via, effects, nodes, range: "*", fixAvailable: false };
}

function expectedReport() {
  const vulnerabilities = {
    braces: finding(
      "braces",
      "high",
      false,
      [{ name: "braces", dependency: "braces", severity: "high", url: EXCEPTION_ADVISORY }],
      ["chokidar", "micromatch"],
      ["node_modules/braces"]
    ),
    chokidar: finding(
      "chokidar",
      "high",
      false,
      ["braces"],
      ["tailwindcss"],
      ["node_modules/chokidar"]
    ),
    micromatch: finding(
      "micromatch",
      "high",
      false,
      ["braces"],
      ["fast-glob", "tailwindcss"],
      ["node_modules/micromatch"]
    ),
    "fast-glob": finding(
      "fast-glob",
      "high",
      false,
      ["micromatch"],
      ["@next/eslint-plugin-next"],
      ["node_modules/fast-glob", "node_modules/tailwindcss/node_modules/fast-glob"]
    ),
    "@next/eslint-plugin-next": finding(
      "@next/eslint-plugin-next",
      "high",
      false,
      ["fast-glob"],
      ["eslint-config-next"],
      ["node_modules/@next/eslint-plugin-next"]
    ),
    "eslint-config-next": finding(
      "eslint-config-next",
      "high",
      true,
      ["@next/eslint-plugin-next"],
      [],
      ["node_modules/eslint-config-next"]
    ),
    tailwindcss: finding(
      "tailwindcss",
      "high",
      true,
      ["chokidar", "fast-glob", "micromatch", "postcss-nested", "postcss-selector-parser"],
      [],
      ["node_modules/tailwindcss"]
    ),
    "postcss-selector-parser": finding(
      "postcss-selector-parser",
      "moderate",
      false,
      [{ name: "postcss-selector-parser", severity: "moderate" }],
      ["postcss-nested", "tailwindcss"],
      ["node_modules/postcss-selector-parser"]
    ),
    "postcss-nested": finding(
      "postcss-nested",
      "moderate",
      false,
      ["postcss-selector-parser"],
      [],
      ["node_modules/postcss-nested"]
    ),
  };
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 2, high: 7, critical: 0, total: 9 },
    },
  };
}

describe("expiring full npm audit gate", () => {
  it("permits only the known dev-only propagation and still reports both moderate findings", () => {
    const summary = evaluateAuditReport(expectedReport(), lock, reviewTime);
    expect(summary.allowed).toHaveLength(7);
    expect(summary.moderate).toEqual(["postcss-selector-parser", "postcss-nested"]);
  });

  it("rejects a new high advisory on the already excepted braces package", () => {
    const report = expectedReport();
    report.vulnerabilities.braces.via.push({
      name: "braces",
      dependency: "braces",
      severity: "high",
      url: "https://github.com/advisories/GHSA-new-advisory",
    });
    expect(() => evaluateAuditReport(report, lock, reviewTime)).toThrow(/new or changed advisory/);
  });

  it("rejects a new high advisory on a different package", () => {
    const report = expectedReport();
    Object.assign(report.vulnerabilities, {
      "new-package": finding(
        "new-package",
        "high",
        false,
        ["braces"],
        [],
        ["node_modules/new-package"]
      ),
    });
    report.metadata.vulnerabilities.high++;
    report.metadata.vulnerabilities.total++;
    expect(() => evaluateAuditReport(report, lock, reviewTime)).toThrow(
      /new high-severity package/
    );
  });

  it("rejects a newly high direct advisory on an otherwise excepted package", () => {
    const report = expectedReport();
    report.vulnerabilities.tailwindcss.via.push({
      name: "tailwindcss",
      dependency: "tailwindcss",
      severity: "high",
      url: "https://github.com/advisories/GHSA-new-direct",
    });
    expect(() => evaluateAuditReport(report, lock, reviewTime)).toThrow(/new or changed advisory/);
  });

  it("rejects a production-exposed or unverified lockfile node", () => {
    const changedLock = structuredClone(lock);
    changedLock.packages["node_modules/braces"].dev = false;
    expect(() => evaluateAuditReport(expectedReport(), changedLock, reviewTime)).toThrow(
      /production or unverified dependency exposure/
    );
  });

  it("rejects a new dependency path even for the same advisory", () => {
    const report = expectedReport();
    report.vulnerabilities.braces.nodes.push("node_modules/other/node_modules/braces");
    expect(() => evaluateAuditReport(report, lock, reviewTime)).toThrow(/dependency path/);
  });

  it("rejects missing and malformed audit JSON", () => {
    expect(() => parseAuditJson("")).toThrow(/no JSON/);
    expect(() => parseAuditJson("{not json")).toThrow(/malformed JSON/);
    expect(() => evaluateAuditReport({ error: "registry unavailable" }, lock, reviewTime)).toThrow(
      /invalid npm audit vulnerabilities report/
    );
  });

  it("rejects an expired exception even when the known advisory is unchanged", () => {
    const afterExpiry = new Date(Date.parse(EXCEPTION_EXPIRES_AT) + 1);
    expect(() => evaluateAuditReport(expectedReport(), lock, afterExpiry)).toThrow(/expired/);
  });

  it("rejects a changed audit summary instead of trusting incomplete JSON", () => {
    const report = expectedReport();
    report.metadata.vulnerabilities.high = 6;
    expect(() => evaluateAuditReport(report, lock, reviewTime)).toThrow(/summary does not match/);
  });
});
