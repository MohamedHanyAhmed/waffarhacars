import { describe, it, expect } from "vitest";
import {
  createMoney,
  moneyFromMinor,
  formatMoney,
  formatBps,
  calculateDiscount,
  calculateCommission,
  sumCommissionAccruals,
} from "../../domain/money";
import en from "../../i18n/en.json";
import ar from "../../i18n/ar.json";
import { interpolateTranslation } from "../../context/I18nContext";

describe("Domain: Money & Basis Points Calculations", () => {
  it("correctly creates Money in integer minor units (piastres)", () => {
    const m = createMoney(1200);
    expect(m.amountMinor).toBe(120000);
    expect(m.currency).toBe("EGP");

    const m2 = moneyFromMinor(96000);
    expect(m2.amountMinor).toBe(96000);
    expect(m2.currency).toBe("EGP");
  });

  it("calculates 20% discount (2000 bps) accurately with zero floating point drift", () => {
    const normalPrice = createMoney(1200); // 120000 minor
    const { lockedPrice, saving } = calculateDiscount(normalPrice, 2000);

    expect(saving.amountMinor).toBe(24000); // EGP 240
    expect(lockedPrice.amountMinor).toBe(96000); // EGP 960
    expect(lockedPrice.amountMinor + saving.amountMinor).toBe(normalPrice.amountMinor);
  });

  it("calculates 10% commission (1000 bps) resulting in exactly EGP 96 (9600 minor) and provider net EGP 864 (86400 minor)", () => {
    const lockedPrice = createMoney(960); // 96000 minor
    const { commissionAmount, providerNet } = calculateCommission(lockedPrice, 1000);

    expect(commissionAmount.amountMinor).toBe(9600); // EGP 96
    expect(providerNet.amountMinor).toBe(86400); // EGP 864
    expect(commissionAmount.amountMinor + providerNet.amountMinor).toBe(lockedPrice.amountMinor);
  });

  it("formats currency cleanly with exactly one currency label in English and Arabic", () => {
    const m = createMoney(960);
    const enFormatted = formatMoney(m, "en");
    const arFormatted = formatMoney(m, "ar");

    // Exactly one instance of currency symbol/label
    const enMatches = enFormatted.match(/EGP/g) || [];
    const arMatches = arFormatted.match(/ج\.م/g) || [];

    expect(enMatches.length).toBe(1);
    expect(arMatches.length).toBe(1);
    expect(enFormatted).toBe("EGP 960");
    expect(arFormatted).toBe("٩٦٠ ج.م");
  });

  it("ensures real translation dictionary templates receiving formatted money contain exactly one currency label", () => {
    const testMoney = createMoney(960);
    const enMoneyStr = formatMoney(testMoney, "en");
    const arMoneyStr = formatMoney(testMoney, "ar");

    // Test real dictionary values from en.json and ar.json
    const testCases = [
      {
        name: "provider.lockedPriceNotice",
        enTemplate: en.provider.lockedPriceNotice,
        arTemplate: ar.provider.lockedPriceNotice,
      },
      {
        name: "pass.payAtCenterNotice",
        enTemplate: en.pass.payAtCenterNotice,
        arTemplate: ar.pass.payAtCenterNotice,
      },
      {
        name: "completed.amountPaid",
        enTemplate: en.completed.amountPaid,
        arTemplate: ar.completed.amountPaid,
      },
      {
        name: "offer.reserveCta",
        enTemplate: en.offer.reserveCta,
        arTemplate: ar.offer.reserveCta,
      },
    ];

    for (const { name, enTemplate, arTemplate } of testCases) {
      const enResult = interpolateTranslation(enTemplate, { price: enMoneyStr });
      const arResult = interpolateTranslation(arTemplate, { price: arMoneyStr });

      const enMatches = enResult.match(/EGP/g) || [];
      const arMatches = arResult.match(/ج\.م/g) || [];

      expect(enMatches.length, `Expected single EGP in ${name} (en)`).toBe(1);
      expect(arMatches.length, `Expected single ج.م in ${name} (ar)`).toBe(1);
      expect(enResult).not.toContain("EGP EGP");
      expect(arResult).not.toContain("ج.م ج.م");
    }
  });

  describe("Production Helper: sumCommissionAccruals", () => {
    it("returns zero EGP for an empty ledger", () => {
      const result = sumCommissionAccruals([]);
      expect(result).toEqual({ amountMinor: 0, currency: "EGP" });
      expect(formatMoney(result, "en")).toBe("EGP 0");
    });

    it("returns exactly the single accrual amount for a one-item ledger (EGP 96)", () => {
      const singleAccrual = [{ commissionAmount: moneyFromMinor(9600) }];
      const result = sumCommissionAccruals(singleAccrual);
      expect(result).toEqual({ amountMinor: 9600, currency: "EGP" });
      expect(formatMoney(result, "en")).toBe("EGP 96");
    });

    it("sums EGP 96 plus EGP 180 producing exactly 27,600 minor units / EGP 276", () => {
      const distinctAccruals = [
        { commissionAmount: moneyFromMinor(9600) }, // EGP 96 (9,600 minor)
        { commissionAmount: moneyFromMinor(18000) }, // EGP 180 (18,000 minor)
      ];
      const result = sumCommissionAccruals(distinctAccruals);
      expect(result).toEqual({ amountMinor: 27600, currency: "EGP" });
      expect(formatMoney(result, "en")).toBe("EGP 276");
      // Distinct sum ensures it fails any count * 96 flawed logic (which would be 19,200)
      expect(result.amountMinor).not.toBe(19200);
    });
  });

  it("formats basis points to percentage strings", () => {
    expect(formatBps(2000)).toBe("20%");
    expect(formatBps(1000)).toBe("10%");
    expect(formatBps(1500)).toBe("15%");
  });
});
