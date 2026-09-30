import { z } from "zod";
import { CAIRO_CLUSTERS, OperatingHoursSchema } from "./validation";

/**
 * Exact canonical status values matching PostgreSQL Prisma schema
 */
export const CanonicalProviderStatusSchema = z.enum([
  "DRAFT",
  "PENDING_REVIEW",
  "ACTIVE",
  "PAUSED",
  "REJECTED",
  "TERMINATED",
]);

export type CanonicalProviderStatus = z.infer<typeof CanonicalProviderStatusSchema>;

export const CanonicalBranchStatusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED", "DECOMMISSIONED"]);

export type CanonicalBranchStatus = z.infer<typeof CanonicalBranchStatusSchema>;

/**
 * Coerces Prisma Decimal, string, or number to a valid number
 */
export function normalizeCoordinate(value: unknown, coordinateName = "coordinate"): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid coordinate for ${coordinateName}: non-finite value ${value}`);
    }
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof (value as { toNumber: () => number }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid coordinate for ${coordinateName}: cannot parse '${value}'`);
    }
    return parsed;
  }
  throw new Error(
    `Invalid coordinate for ${coordinateName}: expected number, Decimal, or numeric string, got: ${value === null ? "null" : typeof value}`
  );
}

/**
 * Branch DTO Schema (API boundary to UI)
 */
export const BranchDtoSchema = z.object({
  id: z.string().uuid(),
  providerOrganizationId: z.string().uuid(),
  branchCode: z.string().min(1).max(32),
  nameEn: z.string().min(1).max(128),
  nameAr: z.string().min(1).max(128),
  cluster: z.enum(CAIRO_CLUSTERS),
  streetAddressEn: z.string().min(1).max(255),
  streetAddressAr: z.string().min(1).max(255),
  landmarkEn: z.string().nullable().optional(),
  landmarkAr: z.string().nullable().optional(),
  latitude: z.preprocess(
    (val) => normalizeCoordinate(val, "latitude"),
    z.number().min(29.75).max(30.35)
  ),
  longitude: z.preprocess(
    (val) => normalizeCoordinate(val, "longitude"),
    z.number().min(31.05).max(31.75)
  ),
  contactPhone: z.string().min(1).max(20),
  operatingHours: OperatingHoursSchema,
  status: CanonicalBranchStatusSchema,
  version: z.number().int().nonnegative(),
  legalIdentityChecked: z.boolean().default(false),
  physicalLocationChecked: z.boolean().default(false),
  contactAndHoursChecked: z.boolean().default(false),
  evidenceDocumentRef: z.string().nullable().optional(),
  vettedAt: z.union([z.date(), z.string()]).nullable().optional(),
  vettedByUserId: z.string().nullable().optional(),
  vettedByUser: z
    .object({
      id: z.string().optional(),
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  rejectionReason: z.string().nullable().optional(),
  pauseReason: z.string().nullable().optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
  updatedAt: z.union([z.date(), z.string()]).optional(),
  isOperationallyAvailable: z.boolean().optional(),
});

export type BranchDto = z.infer<typeof BranchDtoSchema>;

/**
 * Provider Organization DTO Schema (API boundary to UI)
 */
export const ProviderOrganizationDtoSchema = z.object({
  id: z.string().uuid(),
  nameEn: z.string().min(1).max(128),
  nameAr: z.string().min(1).max(128),
  legalName: z.string().min(1).max(255),
  taxRegistrationNumber: z.string().regex(/^\d{9}$/),
  commercialRegistrationNumber: z.string().regex(/^[A-Za-z0-9_-]{3,32}$/),
  primaryCluster: z.enum(CAIRO_CLUSTERS),
  status: CanonicalProviderStatusSchema,
  version: z.number().int().nonnegative(),
  contactPersonName: z.string().min(1).max(128),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(1).max(20),
  submittedByUserId: z.string().nullable().optional(),
  submittedByUser: z
    .object({
      id: z.string().optional(),
      name: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  activatedByUserId: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  pauseReason: z.string().nullable().optional(),
  submittedAt: z.union([z.date(), z.string()]).nullable().optional(),
  activatedAt: z.union([z.date(), z.string()]).nullable().optional(),
  pausedAt: z.union([z.date(), z.string()]).nullable().optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
  updatedAt: z.union([z.date(), z.string()]).optional(),
  branches: z.array(BranchDtoSchema).default([]),
});

export type ProviderOrganizationDto = z.infer<typeof ProviderOrganizationDtoSchema>;

/**
 * Normalizes a raw branch record from Prisma/DB into a strictly typed BranchDto.
 */
export function normalizeBranchDto(raw: unknown): BranchDto {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid raw branch object provided for DTO normalization");
  }
  const obj = raw as Record<string, unknown>;
  const normalized = {
    ...obj,
    latitude: normalizeCoordinate(obj.latitude),
    longitude: normalizeCoordinate(obj.longitude),
    operatingHours: Array.isArray(obj.operatingHours) ? obj.operatingHours : [],
  };
  return BranchDtoSchema.parse(normalized);
}

/**
 * Normalizes a raw provider organization record from Prisma/DB into a strictly typed ProviderOrganizationDto.
 */
export function normalizeProviderDto(raw: unknown): ProviderOrganizationDto {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid raw provider object provided for DTO normalization");
  }
  const obj = raw as Record<string, unknown>;
  const rawBranches = Array.isArray(obj.branches) ? obj.branches : [];
  const normalizedBranches = rawBranches.map(normalizeBranchDto);

  const normalized = {
    ...obj,
    branches: normalizedBranches,
  };
  return ProviderOrganizationDtoSchema.parse(normalized);
}

/**
 * Safe status classification helpers
 */
export function isTerminalStatus(status: unknown): boolean {
  return status === "TERMINATED" || status === "DECOMMISSIONED" || status === "REJECTED";
}

export function isEditableDraft(status: unknown): boolean {
  return status === "DRAFT";
}
