import { describe, it, expect } from "vitest";
import { normalizeEgyptianPhone, formatMaskedPhone, normalizeDigits } from "@/lib/phone";

describe("Egyptian Phone Normalization and Masking Suite", () => {
  describe("normalizeDigits", () => {
    it("translates Arabic-Indic numerals (٠-٩) to ASCII 0-9", () => {
      expect(normalizeDigits("٠١٠١٢٣٤٥٦٧٨")).toBe("01012345678");
    });

    it("translates Eastern Arabic-Indic numerals (۰-۹) to ASCII 0-9", () => {
      expect(normalizeDigits("۰۱۰۱۲۳۴۵۶۷۸")).toBe("01012345678");
    });

    it("preserves standard ASCII digits and symbols", () => {
      expect(normalizeDigits("+20 10 1234 5678")).toBe("+20 10 1234 5678");
    });
  });

  describe("normalizeEgyptianPhone", () => {
    it("normalizes national prefixes (010, 011, 012, 015) to identical canonical E.164", () => {
      const inputs = [
        { raw: "01012345678", expected: "+201012345678" },
        { raw: "01112345678", expected: "+201112345678" },
        { raw: "01212345678", expected: "+201212345678" },
        { raw: "01512345678", expected: "+201512345678" },
      ];

      for (const { raw, expected } of inputs) {
        const res = normalizeEgyptianPhone(raw);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.canonicalE164).toBe(expected);
        }
      }
    });

    it("normalizes international prefixes (+20, 0020) and formatted variations", () => {
      const variations = [
        "+201012345678",
        "+20 10 1234 5678",
        "+20-10-1234-5678",
        "00201012345678",
        "0020 10 1234 5678",
        "  010 1234 5678  ",
      ];

      for (const v of variations) {
        const res = normalizeEgyptianPhone(v);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.canonicalE164).toBe("+201012345678");
        }
      }
    });

    it("normalizes Arabic numerals to canonical E.164", () => {
      const res = normalizeEgyptianPhone("٠١٠١٢٣٤٥٦٧٨");
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.canonicalE164).toBe("+201012345678");
      }
    });

    it("rejects Egyptian landlines (Cairo 02, Alex 03)", () => {
      const landlines = [
        "0223456789", // Cairo landline
        "035678901", // Alexandria landline
        "+20223456789",
      ];

      for (const l of landlines) {
        const res = normalizeEgyptianPhone(l);
        expect(res.success).toBe(false);
      }
    });

    it("rejects foreign numbers", () => {
      const foreign = [
        "+14155552671", // US
        "+447911123456", // UK
        "+966501234567", // Saudi Arabia
        "+971501234567", // UAE
      ];

      for (const f of foreign) {
        const res = normalizeEgyptianPhone(f);
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.errorCode).toBe("NOT_EGYPTIAN");
        }
      }
    });

    it("rejects invalid lengths and malformed numbers", () => {
      const malformed = [
        "0101234567", // Too short (9 digits NSN)
        "010123456789", // Too long (11 digits NSN)
        "not-a-number",
        "",
        "01312345678", // 013 is not a mobile block (013 is Benha landline area)
        "010 1234 5678 text after", // extract: false rejects text-embedded numbers
      ];

      for (const m of malformed) {
        const res = normalizeEgyptianPhone(m);
        expect(res.success).toBe(false);
      }
    });
  });

  describe("formatMaskedPhone", () => {
    it("formats canonical E.164 into masked representation", () => {
      expect(formatMaskedPhone("+201012345678")).toBe("+20 10 **** 5678");
      expect(formatMaskedPhone("+201198765432")).toBe("+20 11 **** 5432");
      expect(formatMaskedPhone("+201500001111")).toBe("+20 15 **** 1111");
    });

    it("handles short or malformed fallback safely", () => {
      expect(formatMaskedPhone("invalid")).toBe("+20 ** **** ****");
    });
  });
});
