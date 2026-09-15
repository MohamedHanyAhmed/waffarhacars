import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import en from "../../i18n/en.json";
import ar from "../../i18n/ar.json";

function findSourceFiles(dir: string): string[] {
  let files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next" && entry.name !== "test") {
        files = files.concat(findSourceFiles(fullPath));
      }
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractTranslationKeysFromCode(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  // Match t("category.key") where key has letters/numbers/dots and not just dots
  const regex = /\bt\(\s*["']([a-zA-Z][a-zA-Z0-9_.]*)["']/g;
  const keys: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

function getLeafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  let keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys = keys.concat(getLeafKeys(v as Record<string, unknown>, newKey));
    } else {
      keys.push(newKey);
    }
  }
  return keys;
}

function getValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

describe("i18n Dictionary Parity & Completeness", () => {
  const enKeys = getLeafKeys(en);
  const arKeys = getLeafKeys(ar);

  it("ensures every key in en.json exists in ar.json", () => {
    const missingInAr = enKeys.filter((k) => getValue(ar, k) === undefined);
    expect(missingInAr).toEqual([]);
  });

  it("ensures every key in ar.json exists in en.json", () => {
    const missingInEn = arKeys.filter((k) => getValue(en, k) === undefined);
    expect(missingInEn).toEqual([]);
  });

  it("ensures no empty translation strings exist in either dictionary", () => {
    for (const k of enKeys) {
      const val = getValue(en, k);
      expect(typeof val).toBe("string");
      expect((val as string).trim().length).toBeGreaterThan(0);
    }
    for (const k of arKeys) {
      const val = getValue(ar, k);
      expect(typeof val).toBe("string");
      expect((val as string).trim().length).toBeGreaterThan(0);
    }
  });

  it("ensures all critical operations ledger keys resolve cleanly without exposing raw keys", () => {
    const opsKeys = [
      "ops.title",
      "ops.subtitle",
      "ops.approvalsTab",
      "ops.ledgerTab",
      "ops.draftsTitle",
      "ops.approveButton",
      "ops.approvedBadge",
      "ops.statementTitle",
      "ops.kpiCompleted",
      "ops.kpiTotalService",
      "ops.kpiCommissionAccrued",
      "ops.kpiCreditLimit",
      "ops.healthyExposure",
      "ops.limitWarning",
      "ops.ledgerTitle",
      "ops.tableReservation",
      "ops.tablePass",
      "ops.tableService",
      "ops.tablePrice",
      "ops.tableCommission",
      "ops.tableStatus",
      "ops.tableDate",
    ];

    for (const key of opsKeys) {
      const enVal = getValue(en, key);
      const arVal = getValue(ar, key);
      expect(enVal, `Missing English key: ${key}`).toBeDefined();
      expect(arVal, `Missing Arabic key: ${key}`).toBeDefined();
      expect(enVal).not.toBe(key);
      expect(arVal).not.toBe(key);
    }
  });

  it("ensures all 11 scenario drawer keys resolve cleanly in both English and Arabic", () => {
    const drawerKeys = [
      "drawer.title",
      "drawer.routesTitle",
      "drawer.scenariosTitle",
      "drawer.liveStateTitle",
      "drawer.cleanEmptyTitle",
      "drawer.loadingTitle",
      "drawer.incompatibleTitle",
      "drawer.confirmedTitle",
      "drawer.checkedInUnissuedTitle",
      "drawer.checkedInValidPinTitle",
      "drawer.wrongPinTitle",
      "drawer.expiredPinTitle",
      "drawer.cancelledTitle",
      "drawer.noShowTitle",
      "drawer.alreadyCompletedTitle",
    ];

    for (const key of drawerKeys) {
      const enVal = getValue(en, key);
      const arVal = getValue(ar, key);
      expect(enVal, `Missing English drawer key: ${key}`).toBeDefined();
      expect(arVal, `Missing Arabic drawer key: ${key}`).toBeDefined();
    }
  });

  it("statically extracts all t('...') keys across src/ and ensures zero missing keys in en.json and ar.json", () => {
    const srcDir = path.resolve(__dirname, "../../");
    const sourceFiles = findSourceFiles(srcDir);
    expect(sourceFiles.length).toBeGreaterThan(5);

    const allInvokedKeys = new Set<string>();
    for (const file of sourceFiles) {
      const keys = extractTranslationKeysFromCode(file);
      keys.forEach((k) => allInvokedKeys.add(k));
    }

    expect(allInvokedKeys.size).toBeGreaterThan(10);

    const missingInEn: string[] = [];
    const missingInAr: string[] = [];

    allInvokedKeys.forEach((key) => {
      if (getValue(en, key) === undefined) {
        missingInEn.push(key);
      }
      if (getValue(ar, key) === undefined) {
        missingInAr.push(key);
      }
    });

    expect(missingInEn, `Translation keys missing in en.json: ${missingInEn.join(", ")}`).toEqual(
      []
    );
    expect(missingInAr, `Translation keys missing in ar.json: ${missingInAr.join(", ")}`).toEqual(
      []
    );
  });

  it("ensures resolving valid keys never produces a raw fallback string", () => {
    const sampleKeys = [
      "provider.checkInTitle",
      "provider.checkInCta",
      "provider.checkInDone",
      "sales.title",
      "sales.evidenceMissingError",
      "ops.title",
      "ops.statementTitle",
      "pass.confirmed",
      "completed.title",
    ];

    for (const key of sampleKeys) {
      const enVal = getValue(en, key);
      const arVal = getValue(ar, key);
      expect(typeof enVal).toBe("string");
      expect(enVal).not.toBe(key);
      expect(typeof arVal).toBe("string");
      expect(arVal).not.toBe(key);
    }
  });
});
