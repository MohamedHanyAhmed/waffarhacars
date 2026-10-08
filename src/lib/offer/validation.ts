import { z } from "zod";

const uuid = z.string().uuid();
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);
const customerCopy = (max: number) =>
  nonEmpty(max).refine(
    (value) =>
      !/(?:https?:\/\/|www\.)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\+?\d[\d\s().-]{8,}\d/i.test(value),
    "Customer copy and evidence notes must not contain URLs, email addresses, or phone numbers."
  );
const evidencePacketId = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Use an opaque internal packet ID, not a URL or path.");
const piastres = z
  .string()
  .regex(/^[0-9]{1,18}$/, "Price must be an integer number of EGP piastres.")
  .transform((value) => BigInt(value));
const dateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const CreateServiceDefinitionSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  categoryId: uuid,
  nameEn: customerCopy(160),
  nameAr: customerCopy(160),
  scopeEn: customerCopy(1000),
  scopeAr: customerCopy(1000),
  pricingMode: z.enum(["FIXED_SCOPE", "QUOTE_REQUIRED"]),
  itemSku: z.string().trim().min(1).max(80).nullable().optional(),
});

export const UpdateServiceDefinitionSchema = CreateServiceDefinitionSchema.partial().extend({
  expectedVersion: z.number().int().positive(),
  isActive: z.boolean().optional(),
});

export const OfferDraftFieldsSchema = z
  .object({
    titleEn: customerCopy(160),
    titleAr: customerCopy(160),
    includedLaborEn: customerCopy(1000),
    includedLaborAr: customerCopy(1000),
    includedPartsEn: customerCopy(1000),
    includedPartsAr: customerCopy(1000),
    excludedLaborEn: customerCopy(1000),
    excludedLaborAr: customerCopy(1000),
    excludedPartsEn: customerCopy(1000),
    excludedPartsAr: customerCopy(1000),
    bookingRule: z.enum(["APPOINTMENT_REQUIRED", "WALK_IN_ALLOWED", "CONTACT_TO_BOOK"]),
    durationMinutes: z.number().int().min(1).max(1440),
    validFrom: dateTime,
    validUntil: dateTime,
    normalPriceMinor: piastres,
    customerPriceMinor: piastres,
    evidencePacketId,
    evidenceType: z.enum([
      "PROVIDER_PRICE_LIST",
      "WRITTEN_QUOTE",
      "PROVIDER_WRITTEN_CONFIRMATION",
      "OTHER",
    ]),
    evidenceDate: dateTime,
    priceBasisNotes: customerCopy(1000),
    commercialTermsPacketId: evidencePacketId,
    commercialTermsAgreedAt: dateTime,
    commissionBasis: z.literal("DISCOUNTED_CUSTOMER_PRICE"),
    commissionRateBps: z.number().int().min(0).max(10000),
  })
  .superRefine((input, ctx) => {
    if (input.customerPriceMinor <= 0n) {
      ctx.addIssue({
        code: "custom",
        path: ["customerPriceMinor"],
        message: "Free offers are not supported in this MVP.",
      });
    }
    if (input.customerPriceMinor >= input.normalPriceMinor) {
      ctx.addIssue({
        code: "custom",
        path: ["customerPriceMinor"],
        message: "Customer price must be lower than the evidenced normal price.",
      });
    }
    if (input.validUntil <= input.validFrom) {
      ctx.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "Offer validity must end after it starts.",
      });
    }
  });

export const CreateOfferSchema = z.object({
  creationRequestId: uuid,
  providerOrganizationId: uuid,
  branchId: uuid,
  serviceDefinitionId: uuid,
  revisionRequestId: uuid,
  fields: OfferDraftFieldsSchema,
});

export const UpdateOfferDraftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  fields: OfferDraftFieldsSchema,
});

export const CreateOfferRevisionSchema = z.object({ requestId: uuid });

export const SubmitOfferSchema = z.object({ expectedVersion: z.number().int().positive() });

export const ApproveOfferSchema = z.object({
  expectedVersion: z.number().int().positive(),
  evidenceInspected: z.literal(true),
  priceVerified: z.literal(true),
  scopeVerified: z.literal(true),
  providerConsentVerified: z.literal(true),
});

export const RejectOfferSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reasonCode: z.enum([
    "PRICE_EVIDENCE_UNAVAILABLE",
    "PRICE_NOT_VERIFIED",
    "SCOPE_INCOMPLETE",
    "PROVIDER_CONSENT_UNVERIFIED",
    "COMMERCIAL_TERMS_INCOMPLETE",
    "OTHER",
  ]),
});

export type OfferDraftFields = z.infer<typeof OfferDraftFieldsSchema>;
