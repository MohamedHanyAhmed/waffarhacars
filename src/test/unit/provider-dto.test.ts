import { describe, it, expect } from "vitest";
import {
  normalizeCoordinate,
  normalizeBranchDto,
  normalizeProviderDto,
  isTerminalStatus,
  CanonicalBranchStatusSchema,
  CanonicalProviderStatusSchema,
} from "@/lib/provider/dto";

describe("Provider & Branch DTO Normalization Unit Tests", () => {
  describe("normalizeCoordinate", () => {
    it("preserves JS number coordinates accurately", () => {
      expect(normalizeCoordinate(30.05, "latitude")).toBe(30.05);
      expect(normalizeCoordinate(31.33, "longitude")).toBe(31.33);
    });

    it("normalizes Prisma Decimal-like objects with .toNumber()", () => {
      const fakePrismaDecimal = {
        toNumber() {
          return 30.051234;
        },
      };
      expect(normalizeCoordinate(fakePrismaDecimal, "latitude")).toBe(30.051234);
    });

    it("normalizes Decimal strings returned by JSON serialization", () => {
      expect(normalizeCoordinate("30.050000", "latitude")).toBe(30.05);
      expect(normalizeCoordinate("31.330000", "longitude")).toBe(31.33);
    });

    it("throws when coordinate is null, undefined, or not a finite number", () => {
      expect(() => normalizeCoordinate(null, "latitude")).toThrow(
        "Invalid coordinate for latitude"
      );
      expect(() => normalizeCoordinate(undefined, "longitude")).toThrow(
        "Invalid coordinate for longitude"
      );
      expect(() => normalizeCoordinate("not-a-number", "latitude")).toThrow(
        "Invalid coordinate for latitude"
      );
      expect(() => normalizeCoordinate(NaN, "latitude")).toThrow("Invalid coordinate for latitude");
      expect(() => normalizeCoordinate(Infinity, "latitude")).toThrow(
        "Invalid coordinate for latitude"
      );
    });
  });

  describe("Canonical Status Schemas & Terminal Predicates", () => {
    it("validates canonical branch statuses", () => {
      expect(CanonicalBranchStatusSchema.safeParse("DRAFT").success).toBe(true);
      expect(CanonicalBranchStatusSchema.safeParse("ACTIVE").success).toBe(true);
      expect(CanonicalBranchStatusSchema.safeParse("PAUSED").success).toBe(true);
      expect(CanonicalBranchStatusSchema.safeParse("DECOMMISSIONED").success).toBe(true);

      // Non-canonical statuses must be rejected by branch schema
      expect(CanonicalBranchStatusSchema.safeParse("PENDING_REVIEW").success).toBe(false);
      expect(CanonicalBranchStatusSchema.safeParse("REJECTED").success).toBe(false);
      expect(CanonicalBranchStatusSchema.safeParse("UNKNOWN").success).toBe(false);
    });

    it("validates canonical provider statuses", () => {
      expect(CanonicalProviderStatusSchema.safeParse("DRAFT").success).toBe(true);
      expect(CanonicalProviderStatusSchema.safeParse("PENDING_REVIEW").success).toBe(true);
      expect(CanonicalProviderStatusSchema.safeParse("ACTIVE").success).toBe(true);
      expect(CanonicalProviderStatusSchema.safeParse("PAUSED").success).toBe(true);
      expect(CanonicalProviderStatusSchema.safeParse("REJECTED").success).toBe(true);
      expect(CanonicalProviderStatusSchema.safeParse("TERMINATED").success).toBe(true);

      // Invalid statuses
      expect(CanonicalProviderStatusSchema.safeParse("DECOMMISSIONED").success).toBe(false);
      expect(CanonicalProviderStatusSchema.safeParse("UNKNOWN").success).toBe(false);
    });

    it("correctly identifies terminal statuses", () => {
      expect(isTerminalStatus("DECOMMISSIONED")).toBe(true);
      expect(isTerminalStatus("TERMINATED")).toBe(true);
      expect(isTerminalStatus("REJECTED")).toBe(true);

      expect(isTerminalStatus("DRAFT")).toBe(false);
      expect(isTerminalStatus("PENDING_REVIEW")).toBe(false);
      expect(isTerminalStatus("ACTIVE")).toBe(false);
      expect(isTerminalStatus("PAUSED")).toBe(false);
    });
  });

  describe("normalizeBranchDto & JSON Roundtrip", () => {
    it("normalizes a raw branch record with Decimal-like coordinates into a strictly typed DTO", () => {
      const rawBranch = {
        id: "c7b5f3a0-1234-4567-89ab-cdef01234567",
        providerOrganizationId: "e9a1b2c3-4567-489a-bcde-f01234567890",
        branchCode: "BR-NASR-01",
        nameEn: "Nasr City Main Branch",
        nameAr: "فرع مدينة نصر الرئيسي",
        cluster: "NASR_CITY_HELIOPOLIS",
        streetAddressEn: "15 Abbas El Akkad St",
        streetAddressAr: "١٥ شارع عباس العقاد",
        landmarkEn: "Near Cairo Festival",
        landmarkAr: null,
        latitude: {
          toNumber() {
            return 30.058123;
          },
        },
        longitude: "31.332456",
        contactPhone: "+201012345678",
        operatingHours: [{ dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false }],
        status: "DRAFT",
        version: 1,
        vettedAt: new Date("2026-09-29T10:00:00Z"),
        evidenceDocumentRef: null,
        rejectionReason: null,
      };

      const dto = normalizeBranchDto(rawBranch);

      expect(typeof dto.latitude).toBe("number");
      expect(dto.latitude).toBe(30.058123);
      expect(typeof dto.longitude).toBe("number");
      expect(dto.longitude).toBe(31.332456);
      expect(dto.status).toBe("DRAFT");
      expect(new Date(dto.vettedAt!).toISOString()).toBe("2026-09-29T10:00:00.000Z");

      // Verify JSON serialization produces clean JSON without Decimal artifacts
      const serialized = JSON.stringify(dto);
      const parsed = JSON.parse(serialized);
      expect(parsed.latitude).toBe(30.058123);
      expect(parsed.longitude).toBe(31.332456);
      expect(parsed.status).toBe("DRAFT");
      expect(parsed.vettedAt).toBe("2026-09-29T10:00:00.000Z");
    });
  });

  describe("normalizeProviderDto & JSON Roundtrip", () => {
    it("normalizes a raw provider organization with nested branches", () => {
      const rawProvider = {
        id: "e9a1b2c3-4567-489a-bcde-f01234567890",
        nameEn: "Orbit Auto Care",
        nameAr: "أوربت لصيانة السيارات",
        legalName: "Orbit Automotive Services LLC",
        taxRegistrationNumber: "123456789",
        commercialRegistrationNumber: "CR-123456",
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Hassan Ali",
        contactEmail: "hassan@orbitauto.eg",
        contactPhone: "+201098765432",
        status: "DRAFT",
        version: 1,
        submittedByUserId: null,
        submittedAt: null,
        activatedAt: null,
        pausedAt: null,
        rejectionReason: null,
        createdAt: new Date("2026-09-29T09:00:00Z"),
        updatedAt: new Date("2026-09-29T09:00:00Z"),
        branches: [
          {
            id: "c7b5f3a0-1234-4567-89ab-cdef01234567",
            providerOrganizationId: "e9a1b2c3-4567-489a-bcde-f01234567890",
            branchCode: "BR-NASR-01",
            nameEn: "Nasr City Main Branch",
            nameAr: "فرع مدينة نصر الرئيسي",
            cluster: "NASR_CITY_HELIOPOLIS",
            streetAddressEn: "15 Abbas El Akkad St",
            streetAddressAr: "١٥ شارع عباس العقاد",
            landmarkEn: null,
            landmarkAr: null,
            latitude: "30.050000",
            longitude: "31.330000",
            contactPhone: "+201012345678",
            operatingHours: [
              { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
            ],
            status: "DRAFT",
            version: 1,
            vettedAt: null,
            evidenceDocumentRef: null,
            rejectionReason: null,
          },
        ],
      };

      const dto = normalizeProviderDto(rawProvider);

      expect(dto.nameEn).toBe("Orbit Auto Care");
      expect(dto.status).toBe("DRAFT");
      expect(dto.branches).toHaveLength(1);
      expect(dto.branches[0].latitude).toBe(30.05);
      expect(dto.branches[0].longitude).toBe(31.33);

      // JSON serialization check
      const json = JSON.parse(JSON.stringify(dto));
      expect(json.branches[0].latitude).toBe(30.05);
      expect(json.branches[0].longitude).toBe(31.33);
    });

    it("defaults branches to empty array when branches field is absent", () => {
      const rawProviderWithoutBranches = {
        id: "e9a1b2c3-4567-489a-bcde-f01234567890",
        nameEn: "Orbit Auto Care",
        nameAr: "أوربت لصيانة السيارات",
        legalName: "Orbit Automotive Services LLC",
        taxRegistrationNumber: "123456789",
        commercialRegistrationNumber: "CR-123456",
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Hassan Ali",
        contactEmail: "hassan@orbitauto.eg",
        contactPhone: "+201098765432",
        status: "DRAFT",
        version: 1,
      };

      const dto = normalizeProviderDto(rawProviderWithoutBranches);
      expect(dto.branches).toEqual([]);
    });
  });
});
