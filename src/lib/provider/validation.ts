import { z } from "zod";
import { normalizeEgyptianPhone } from "@/lib/phone";
import {
  PROVIDER_REJECTION_REASON_CODES,
  PROVIDER_PAUSE_REASON_CODES,
  type ProviderRejectionReasonCode,
  type ProviderPauseReasonCode,
} from "@/lib/dal/audit";

export { PROVIDER_REJECTION_REASON_CODES, PROVIDER_PAUSE_REASON_CODES };
export type { ProviderRejectionReasonCode, ProviderPauseReasonCode };

export const CAIRO_CLUSTERS = [
  "NASR_CITY_HELIOPOLIS",
  "NEW_CAIRO",
  "MAADI",
  "OCTOBER_ZAYED",
] as const;

export type CairoClusterType = (typeof CAIRO_CLUSTERS)[number];

export const ACTIVE_PILOT_CLUSTER: CairoClusterType = "NASR_CITY_HELIOPOLIS";

// Egyptian Tax ID: exactly 9 digits
export const EGYPTIAN_TAX_ID_REGEX = /^\d{9}$/;

// Egyptian Commercial Registration: alphanumeric with dashes/underscores, 3 to 32 chars
export const EGYPTIAN_CR_NUMBER_REGEX = /^[A-Za-z0-9_-]{3,32}$/;

// Cairo bounding box: lat 29.75-30.35, lng 31.05-31.75
export const CAIRO_LATITUDE_MIN = 29.75;
export const CAIRO_LATITUDE_MAX = 30.35;
export const CAIRO_LONGITUDE_MIN = 31.05;
export const CAIRO_LONGITUDE_MAX = 31.75;

export const OperatingHoursDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday, 6 = Saturday
  openTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: "openTime must be HH:MM in 24-hour format",
  }),
  closeTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: "closeTime must be HH:MM in 24-hour format",
  }),
  isClosed: z.boolean().default(false),
});

export const OperatingHoursSchema = z
  .array(OperatingHoursDaySchema)
  .min(1, "At least one operating day must be specified")
  .max(7, "Cannot exceed 7 days in operating hours");

const EgyptianPhoneSchema = z.string().transform((val, ctx) => {
  const result = normalizeEgyptianPhone(val);
  if (!result.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid Egyptian mobile number (${result.errorCode})`,
    });
    return z.NEVER;
  }
  return result.canonicalE164;
});

export const CreateProviderDraftSchema = z.object({
  nameEn: z.string().trim().min(2).max(128),
  nameAr: z.string().trim().min(2).max(128),
  legalName: z.string().trim().min(2).max(255),
  taxRegistrationNumber: z.string().trim().regex(EGYPTIAN_TAX_ID_REGEX, {
    message: "Tax Registration Number must be exactly 9 digits",
  }),
  commercialRegistrationNumber: z.string().trim().regex(EGYPTIAN_CR_NUMBER_REGEX, {
    message: "Commercial Registration Number must be between 3 and 32 alphanumeric characters",
  }),
  primaryCluster: z.enum(CAIRO_CLUSTERS, {
    message: "Primary cluster must be a valid Cairo cluster",
  }),
  contactPersonName: z.string().trim().min(2).max(128),
  contactEmail: z.string().trim().email(),
  contactPhone: EgyptianPhoneSchema,
});

export type CreateProviderDraftInput = z.infer<typeof CreateProviderDraftSchema>;

export const UpdateProviderDraftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  nameEn: z.string().trim().min(2).max(128).optional(),
  nameAr: z.string().trim().min(2).max(128).optional(),
  legalName: z.string().trim().min(2).max(255).optional(),
  taxRegistrationNumber: z
    .string()
    .trim()
    .regex(EGYPTIAN_TAX_ID_REGEX, {
      message: "Tax Registration Number must be exactly 9 digits",
    })
    .optional(),
  commercialRegistrationNumber: z
    .string()
    .trim()
    .regex(EGYPTIAN_CR_NUMBER_REGEX, {
      message: "Commercial Registration Number must be between 3 and 32 alphanumeric characters",
    })
    .optional(),
  primaryCluster: z.enum(CAIRO_CLUSTERS).optional(),
  contactPersonName: z.string().trim().min(2).max(128).optional(),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: EgyptianPhoneSchema.optional(),
});

export type UpdateProviderDraftInput = z.infer<typeof UpdateProviderDraftSchema>;

export const CreateBranchDraftSchema = z.object({
  branchCode: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, {
      message: "Branch code must be alphanumeric with optional dashes or underscores",
    }),
  nameEn: z.string().trim().min(2).max(128),
  nameAr: z.string().trim().min(2).max(128),
  cluster: z.enum(CAIRO_CLUSTERS),
  streetAddressEn: z.string().trim().min(5).max(255),
  streetAddressAr: z.string().trim().min(5).max(255),
  landmarkEn: z.string().trim().max(255).optional().nullable(),
  landmarkAr: z.string().trim().max(255).optional().nullable(),
  latitude: z
    .number()
    .min(CAIRO_LATITUDE_MIN, `Latitude must be within Greater Cairo (>= ${CAIRO_LATITUDE_MIN})`)
    .max(CAIRO_LATITUDE_MAX, `Latitude must be within Greater Cairo (<= ${CAIRO_LATITUDE_MAX})`),
  longitude: z
    .number()
    .min(CAIRO_LONGITUDE_MIN, `Longitude must be within Greater Cairo (>= ${CAIRO_LONGITUDE_MIN})`)
    .max(CAIRO_LONGITUDE_MAX, `Longitude must be within Greater Cairo (<= ${CAIRO_LONGITUDE_MAX})`),
  contactPhone: EgyptianPhoneSchema,
  operatingHours: OperatingHoursSchema,
});

export type CreateBranchDraftInput = z.infer<typeof CreateBranchDraftSchema>;

export const UpdateBranchDraftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  nameEn: z.string().trim().min(2).max(128).optional(),
  nameAr: z.string().trim().min(2).max(128).optional(),
  cluster: z.enum(CAIRO_CLUSTERS).optional(),
  streetAddressEn: z.string().trim().min(5).max(255).optional(),
  streetAddressAr: z.string().trim().min(5).max(255).optional(),
  landmarkEn: z.string().trim().max(255).optional().nullable(),
  landmarkAr: z.string().trim().max(255).optional().nullable(),
  latitude: z.number().min(CAIRO_LATITUDE_MIN).max(CAIRO_LATITUDE_MAX).optional(),
  longitude: z.number().min(CAIRO_LONGITUDE_MIN).max(CAIRO_LONGITUDE_MAX).optional(),
  contactPhone: EgyptianPhoneSchema.optional(),
  operatingHours: OperatingHoursSchema.optional(),
});

export type UpdateBranchDraftInput = z.infer<typeof UpdateBranchDraftSchema>;

export const SubmitProviderSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const ActivateProviderSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const RejectProviderSchema = z.object({
  expectedVersion: z.number().int().positive(),
  remediable: z.boolean().default(true),
  reasonCode: z.enum(PROVIDER_REJECTION_REASON_CODES),
  rejectionReason: z.string().trim().min(5).max(1000),
});

export type RejectProviderInput = z.infer<typeof RejectProviderSchema>;

export const PauseProviderSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reasonCode: z.enum(PROVIDER_PAUSE_REASON_CODES),
  pauseReason: z.string().trim().min(5).max(1000),
});

export type PauseProviderInput = z.infer<typeof PauseProviderSchema>;

export const ResumeProviderSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const ActivateBranchSchema = z.object({
  expectedVersion: z.number().int().positive(),
  legalIdentityChecked: z.literal(true, {
    message: "Legal identity check must be confirmed before branch activation",
  }),
  physicalLocationChecked: z.literal(true, {
    message: "Physical location check must be confirmed before branch activation",
  }),
  contactAndHoursChecked: z.literal(true, {
    message: "Contact details and operating hours check must be confirmed before branch activation",
  }),
  evidenceDocumentRef: z
    .string()
    .trim()
    .min(3)
    .max(128)
    .regex(/^[A-Za-z0-9_./:-]+$/, {
      message: "Evidence reference must be an opaque alphanumeric document or ticket identifier",
    }),
});

export type ActivateBranchInput = z.infer<typeof ActivateBranchSchema>;

export const RejectBranchSchema = z.object({
  expectedVersion: z.number().int().positive(),
  remediable: z.boolean().default(true),
  reasonCode: z.enum(PROVIDER_REJECTION_REASON_CODES),
  rejectionReason: z.string().trim().min(5).max(1000),
});

export type RejectBranchInput = z.infer<typeof RejectBranchSchema>;

export const PauseBranchSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reasonCode: z.enum(PROVIDER_PAUSE_REASON_CODES),
  pauseReason: z.string().trim().min(5).max(1000),
});

export type PauseBranchInput = z.infer<typeof PauseBranchSchema>;

export const ResumeBranchSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
