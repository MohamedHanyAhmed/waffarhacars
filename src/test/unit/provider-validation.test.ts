import { describe, it, expect } from "vitest";
import {
  CreateProviderDraftSchema,
  CreateBranchDraftSchema,
  OperatingHoursSchema,
  EGYPTIAN_TAX_ID_REGEX,
  EGYPTIAN_CR_NUMBER_REGEX,
  CAIRO_LATITUDE_MIN,
  CAIRO_LATITUDE_MAX,
  CAIRO_LONGITUDE_MIN,
  CAIRO_LONGITUDE_MAX,
} from "@/lib/provider/validation";

describe("Provider & Branch Validation Unit Test Suite", () => {
  describe("Egyptian Tax Registration Number Invariants", () => {
    it("accepts valid 9-digit tax registration numbers", () => {
      expect(EGYPTIAN_TAX_ID_REGEX.test("123456789")).toBe(true);
      expect(EGYPTIAN_TAX_ID_REGEX.test("987654321")).toBe(true);
    });

    it("rejects invalid tax registration numbers", () => {
      expect(EGYPTIAN_TAX_ID_REGEX.test("12345678")).toBe(false); // 8 digits
      expect(EGYPTIAN_TAX_ID_REGEX.test("1234567890")).toBe(false); // 10 digits
      expect(EGYPTIAN_TAX_ID_REGEX.test("12345678A")).toBe(false); // alphanumeric
      expect(EGYPTIAN_TAX_ID_REGEX.test("")).toBe(false);
      expect(EGYPTIAN_TAX_ID_REGEX.test("-12345678")).toBe(false);
    });
  });

  describe("Commercial Registration Number Invariants", () => {
    it("accepts valid alphanumeric CR numbers with dashes and underscores", () => {
      expect(EGYPTIAN_CR_NUMBER_REGEX.test("CR-12345")).toBe(true);
      expect(EGYPTIAN_CR_NUMBER_REGEX.test("98765_CAIRO")).toBe(true);
      expect(EGYPTIAN_CR_NUMBER_REGEX.test("123456")).toBe(true);
    });

    it("rejects invalid CR numbers", () => {
      expect(EGYPTIAN_CR_NUMBER_REGEX.test("12")).toBe(false); // too short (< 3)
      expect(EGYPTIAN_CR_NUMBER_REGEX.test("A".repeat(33))).toBe(false); // too long (> 32)
      expect(EGYPTIAN_CR_NUMBER_REGEX.test("CR 12345")).toBe(false); // contains space
      expect(EGYPTIAN_CR_NUMBER_REGEX.test("CR#123")).toBe(false); // special char
    });
  });

  describe("Cairo Geographic Coordinate Bounding Box", () => {
    it("accepts valid coordinates within Greater Cairo (Nasr City, Heliopolis, Maadi)", () => {
      // Nasr City center
      const lat = 30.0561;
      const lng = 31.3301;
      expect(lat >= CAIRO_LATITUDE_MIN && lat <= CAIRO_LATITUDE_MAX).toBe(true);
      expect(lng >= CAIRO_LONGITUDE_MIN && lng <= CAIRO_LONGITUDE_MAX).toBe(true);
    });

    it("rejects coordinates outside Greater Cairo", () => {
      // Alexandria
      const alexLat = 31.2001;
      const alexLng = 29.9187;
      expect(alexLat >= CAIRO_LATITUDE_MIN && alexLat <= CAIRO_LATITUDE_MAX).toBe(false);
      expect(alexLng >= CAIRO_LONGITUDE_MIN && alexLng <= CAIRO_LONGITUDE_MAX).toBe(false);

      // Giza desert far west
      const desertLng = 30.8;
      expect(desertLng >= CAIRO_LONGITUDE_MIN).toBe(false);
    });
  });

  describe("Operating Hours Schema Validation", () => {
    it("accepts valid weekly schedule", () => {
      const validSchedule = [
        { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
        { dayOfWeek: 1, openTime: "09:00", closeTime: "18:00", isClosed: false },
        { dayOfWeek: 5, openTime: "00:00", closeTime: "00:00", isClosed: true }, // Friday closed
      ];
      const result = OperatingHoursSchema.safeParse(validSchedule);
      expect(result.success).toBe(true);
    });

    it("rejects malformed time format or day of week", () => {
      const invalidSchedule = [
        { dayOfWeek: 7, openTime: "09:00", closeTime: "18:00", isClosed: false }, // day 7 invalid
      ];
      expect(OperatingHoursSchema.safeParse(invalidSchedule).success).toBe(false);

      const invalidTime = [
        { dayOfWeek: 0, openTime: "25:00", closeTime: "18:00", isClosed: false }, // 25:00 invalid
      ];
      expect(OperatingHoursSchema.safeParse(invalidTime).success).toBe(false);
    });
  });

  describe("CreateProviderDraftSchema", () => {
    it("validates and normalizes Egyptian phone numbers to E.164", () => {
      const valid = {
        nameEn: "AutoFix Workshop",
        nameAr: "ورشة أوتوفيكس",
        legalName: "AutoFix Services SAE",
        taxRegistrationNumber: "123456789",
        commercialRegistrationNumber: "CR-998877",
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Ahmed Hassan",
        contactEmail: "ahmed.hassan@autofix.eg",
        contactPhone: "01012345678",
      };

      const result = CreateProviderDraftSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contactPhone).toBe("+201012345678");
      }
    });

    it("accepts Arabic digits in contact phone and normalizes to standard E.164", () => {
      const valid = {
        nameEn: "AutoFix Workshop",
        nameAr: "ورشة أوتوفيكس",
        legalName: "AutoFix Services SAE",
        taxRegistrationNumber: "123456789",
        commercialRegistrationNumber: "CR-998877",
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Ahmed Hassan",
        contactEmail: "ahmed.hassan@autofix.eg",
        contactPhone: "٠١٠١٢٣٤٥٦٧٨",
      };

      const result = CreateProviderDraftSchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contactPhone).toBe("+201012345678");
      }
    });

    it("rejects non-Egyptian or invalid mobile numbers", () => {
      const invalid = {
        nameEn: "AutoFix Workshop",
        nameAr: "ورشة أوتوفيكس",
        legalName: "AutoFix Services SAE",
        taxRegistrationNumber: "123456789",
        commercialRegistrationNumber: "CR-998877",
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Ahmed Hassan",
        contactEmail: "ahmed.hassan@autofix.eg",
        contactPhone: "+12025550199", // US phone
      };

      const result = CreateProviderDraftSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("CreateBranchDraftSchema", () => {
    it("validates branch in Cairo pilot cluster with valid coordinates", () => {
      const validBranch = {
        branchCode: "NC-01",
        nameEn: "Nasr City Branch",
        nameAr: "فرع مدينة نصر",
        cluster: "NASR_CITY_HELIOPOLIS",
        streetAddressEn: "15 Abbas El Akkad St",
        streetAddressAr: "١٥ شارع عباس العقاد",
        landmarkEn: "Near Enppi",
        latitude: 30.0561,
        longitude: 31.3301,
        contactPhone: "01123456789",
        operatingHours: [{ dayOfWeek: 0, openTime: "09:00", closeTime: "20:00", isClosed: false }],
      };

      const result = CreateBranchDraftSchema.safeParse(validBranch);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contactPhone).toBe("+201123456789");
      }
    });

    it("rejects branch code with invalid characters or out-of-bounds coordinates", () => {
      const invalid = {
        branchCode: "NC 01", // space not allowed
        nameEn: "Nasr City Branch",
        nameAr: "فرع مدينة نصر",
        cluster: "NASR_CITY_HELIOPOLIS",
        streetAddressEn: "15 Abbas El Akkad St",
        streetAddressAr: "١٥ شارع عباس العقاد",
        latitude: 35.0, // Outside Egypt
        longitude: 31.3301,
        contactPhone: "01123456789",
        operatingHours: [{ dayOfWeek: 0, openTime: "09:00", closeTime: "20:00", isClosed: false }],
      };

      const result = CreateBranchDraftSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("ActivateBranchSchema & RejectBranchSchema", () => {
    it("accepts valid branch activation payload with all checklist items true and evidence ref", async () => {
      const { ActivateBranchSchema } = await import("@/lib/provider/validation");
      const valid = {
        expectedVersion: 1,
        legalIdentityChecked: true,
        physicalLocationChecked: true,
        contactAndHoursChecked: true,
        evidenceDocumentRef: "DOC-EGY-2026-0914-01",
      };
      const result = ActivateBranchSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects branch activation if any checklist item is false or evidence ref missing", async () => {
      const { ActivateBranchSchema } = await import("@/lib/provider/validation");
      const incomplete = {
        expectedVersion: 1,
        legalIdentityChecked: true,
        physicalLocationChecked: false, // Incomplete!
        contactAndHoursChecked: true,
        evidenceDocumentRef: "DOC-EGY-2026-0914-01",
      };
      expect(ActivateBranchSchema.safeParse(incomplete).success).toBe(false);

      const missingRef = {
        expectedVersion: 1,
        legalIdentityChecked: true,
        physicalLocationChecked: true,
        contactAndHoursChecked: true,
        evidenceDocumentRef: "",
      };
      expect(ActivateBranchSchema.safeParse(missingRef).success).toBe(false);

      const baseValid = {
        expectedVersion: 1,
        legalIdentityChecked: true,
        physicalLocationChecked: true,
        contactAndHoursChecked: true,
        evidenceDocumentRef: "DOC-EGY-2026-0914-01",
      };

      // Must reject URLs, file paths, contact info, and free-text notes
      const urlRef = { ...baseValid, evidenceDocumentRef: "https://storage.eg/docs/cert.pdf" };
      expect(ActivateBranchSchema.safeParse(urlRef).success).toBe(false);

      const pathRef = { ...baseValid, evidenceDocumentRef: "/var/uploads/evidence/inspection.pdf" };
      expect(ActivateBranchSchema.safeParse(pathRef).success).toBe(false);

      const winPathRef = { ...baseValid, evidenceDocumentRef: "C:\\docs\\evidence\\ref.pdf" };
      expect(ActivateBranchSchema.safeParse(winPathRef).success).toBe(false);

      const emailRef = { ...baseValid, evidenceDocumentRef: "ops-inspector@autofix.eg" };
      expect(ActivateBranchSchema.safeParse(emailRef).success).toBe(false);

      const freeTextRef = {
        ...baseValid,
        evidenceDocumentRef: "Workshop inspected by Ahmed and verified",
      };
      expect(ActivateBranchSchema.safeParse(freeTextRef).success).toBe(false);

      const tooShortRef = { ...baseValid, evidenceDocumentRef: "AB" };
      expect(ActivateBranchSchema.safeParse(tooShortRef).success).toBe(false);

      const tooLongRef = { ...baseValid, evidenceDocumentRef: "A".repeat(65) };
      expect(ActivateBranchSchema.safeParse(tooLongRef).success).toBe(false);
    });

    it("accepts valid branch rejection with allowlisted reason code", async () => {
      const { RejectBranchSchema } = await import("@/lib/provider/validation");
      const valid = {
        expectedVersion: 1,
        remediable: true,
        reasonCode: "UNVERIFIED_LOCATION",
        rejectionReason: "Workshop address does not match physical building number",
      };
      const result = RejectBranchSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects branch rejection with non-allowlisted reason code", async () => {
      const { RejectBranchSchema } = await import("@/lib/provider/validation");
      const invalid = {
        expectedVersion: 1,
        remediable: true,
        reasonCode: "ARBITRARY_UNRECOGNIZED_CODE",
        rejectionReason: "Workshop address does not match physical building number",
      };
      expect(RejectBranchSchema.safeParse(invalid).success).toBe(false);
    });
  });
});
