import {
  Reservation,
  CommissionAccrual,
  VerifiedReview,
  OfferDraft,
  OfferVariant,
  ProviderStatement,
  Vehicle,
  CompletionPinDetails,
  ServiceCategoryId,
} from "./types";
import { calculateCommission, moneyFromMinor } from "./money";

export interface CheckInResult {
  code: "SUCCESS" | "INVALID_STATE" | "PASS_NOT_FOUND";
  messageEn: string;
  messageAr: string;
  reservation?: Reservation;
}

export interface CompletionProposal {
  proposedReservation: Reservation;
  calculatedAccrual: CommissionAccrual;
}

export type PrepareCompletionResult =
  | { code: "PREPARED"; proposal: CompletionProposal }
  | { code: "ALREADY_COMPLETED"; messageEn: string; messageAr: string }
  | { code: "INVALID_STATE"; messageEn: string; messageAr: string }
  | { code: "PIN_NOT_ISSUED"; messageEn: string; messageAr: string }
  | { code: "INVALID_PIN"; messageEn: string; messageAr: string }
  | { code: "PIN_EXPIRED"; messageEn: string; messageAr: string };

export interface CompatibilityResult {
  compatible: boolean;
  reasonEn: string;
  reasonAr: string;
}

/**
 * Checks if a vehicle matches compatibility rules
 */
export function checkCompatibility(vehicle: Vehicle, offer: OfferVariant): CompatibilityResult {
  const isMatch = offer.compatibleVehicles.some(
    (rule) =>
      rule.make.toLowerCase() === vehicle.make.toLowerCase() &&
      rule.model.toLowerCase() === vehicle.model.toLowerCase() &&
      vehicle.year >= rule.yearFrom &&
      vehicle.year <= rule.yearTo
  );

  if (isMatch) {
    return {
      compatible: true,
      reasonEn: `Verified fit for ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.engineTrim})`,
      reasonAr: `توافق مؤكد مع ${vehicle.make} ${vehicle.model} موديل ${vehicle.year} (${vehicle.engineTrim})`,
    };
  }

  return {
    compatible: false,
    reasonEn: `This package is formulated for Nissan/Renault models and is not compatible with ${vehicle.year} ${vehicle.make} ${vehicle.model}.`,
    reasonAr: `هذه الباقة مخصصة لسيارات نيسان ورينو ولا تتوافق مع ${vehicle.make} ${vehicle.model} موديل ${vehicle.year}.`,
  };
}

/**
 * Pure check-in transition (Zero commission impact)
 * Increments revision: 1 -> 2
 */
export function checkInReservation(
  reservation: Reservation,
  staffId: string,
  now: string
): CheckInResult {
  if (reservation.status !== "confirmed") {
    return {
      code: "INVALID_STATE",
      messageEn: `Cannot check in: reservation is in '${reservation.status}' state (expected 'confirmed').`,
      messageAr: `لا يمكن تسجيل الوصول: حالة الحجز هي '${reservation.status}' (المطلوب 'مؤكد').`,
    };
  }

  const updated: Reservation = {
    ...reservation,
    status: "checked_in",
    revision: reservation.revision + 1, // Advance revision (e.g. 1 -> 2)
    checkInTimestamp: now,
    checkedInByStaffId: staffId,
  };

  return {
    code: "SUCCESS",
    messageEn: "Customer checked in successfully. Review work scope before requesting PIN.",
    messageAr: "تم تسجيل وصول العميل بنجاح. راجع بنود الخدمة قبل طلب رمز PIN.",
    reservation: updated,
  };
}

/**
 * Customer reveals/issues PIN after check-in.
 * Increments revision: 2 -> 3
 */
export function revealCompletionPin(
  reservation: Reservation,
  now: string,
  pin: string = "4921",
  validityMinutes: number = 15
): { success: boolean; error?: string; reservation?: Reservation } {
  if (reservation.status !== "checked_in") {
    return {
      success: false,
      error: "PIN can only be revealed after customer arrival check-in.",
    };
  }

  const issuedDate = new Date(now);
  const expiresDate = new Date(issuedDate.getTime() + validityMinutes * 60 * 1000);

  const pinDetails: CompletionPinDetails = {
    pin,
    isIssued: true,
    issuedAt: now,
    expiresAt: expiresDate.toISOString(),
    isConsumed: false,
  };

  const updated: Reservation = {
    ...reservation,
    revision: reservation.revision + 1, // Advance revision (e.g. 2 -> 3)
    completionPinDetails: pinDetails,
  };

  return {
    success: true,
    reservation: updated,
  };
}

/**
 * Pure prepare-completion function.
 * Validates PIN, state, and calculates commission dynamically from authoritative pricingSnapshot.
 * Proposes incremented revision (e.g. 3 -> 4) and CommissionAccrual.
 */
export function prepareCompletion(
  reservation: Reservation,
  suppliedPin: string,
  now: string
): PrepareCompletionResult {
  // 1. Idempotency Check
  if (reservation.status === "completed") {
    return {
      code: "ALREADY_COMPLETED",
      messageEn: `Service was already completed at ${reservation.completionTimestamp}. Accrual is unchanged.`,
      messageAr: `تم تأكيد إتمام الخدمة مسبقاً في ${reservation.completionTimestamp}. لا توجد أي عمولة إضافية.`,
    };
  }

  // 2. Strict State Sequence Check: MUST be checked_in
  if (reservation.status !== "checked_in") {
    return {
      code: "INVALID_STATE",
      messageEn: `Cannot complete service: reservation status is '${reservation.status}'. Customer must be checked in first.`,
      messageAr: `لا يمكن إتمام الخدمة: حالة الحجز هي '${reservation.status}'. يجب تسجيل وصول العميل أولاً.`,
    };
  }

  // 3. PIN Lifecycle Check
  const pinDetails = reservation.completionPinDetails;
  if (!pinDetails || !pinDetails.isIssued) {
    return {
      code: "PIN_NOT_ISSUED",
      messageEn:
        "Completion PIN has not been issued yet. Customer must reveal PIN on discount pass after arrival.",
      messageAr: "لم يتم إصدار رمز PIN بعد. يجب على العميل إظهار الرمز من بطاقة الخصم بعد الوصول.",
    };
  }

  if (pinDetails.isConsumed) {
    return {
      code: "ALREADY_COMPLETED",
      messageEn: "Completion PIN has already been consumed.",
      messageAr: "تم استخدام رمز PIN مسبقاً.",
    };
  }

  if (suppliedPin.trim() !== pinDetails.pin) {
    return {
      code: "INVALID_PIN",
      messageEn:
        "Incorrect completion PIN. Customer must provide the 4-digit PIN displayed on their discount pass.",
      messageAr: "رمز PIN غير صحيح. يجب على العميل إملاء الرمز المكون من ٤ أرقام من بطاقة الخصم.",
    };
  }

  // Epoch-based time comparison
  const nowEpoch = Date.parse(now);
  const expiryEpoch = Date.parse(pinDetails.expiresAt);
  if (nowEpoch > expiryEpoch) {
    return {
      code: "PIN_EXPIRED",
      messageEn: "Completion PIN has expired. Please refresh the discount pass.",
      messageAr: "انتهت صلاحية رمز PIN. يرجى تحديث بطاقة الخصم.",
    };
  }

  // 4. Authoritative Commission Calculation (Fresh calculation, never copied or trusted from UI)
  const { commissionAmount, providerNet } = calculateCommission(
    reservation.pricingSnapshot.lockedPrice,
    reservation.pricingSnapshot.commissionBps
  );

  const accrualId = `ACCRUAL-${reservation.id}`;
  const calculatedAccrual: CommissionAccrual = {
    id: accrualId,
    reservationId: reservation.id,
    passCode: reservation.passCode,
    providerId: reservation.provider.id,
    providerNameEn: reservation.provider.nameEn,
    providerNameAr: reservation.provider.nameAr,
    branchNameEn: reservation.branch.nameEn,
    branchNameAr: reservation.branch.nameAr,
    serviceTitleEn: reservation.offerSnapshot.titleEn,
    serviceTitleAr: reservation.offerSnapshot.titleAr,
    lockedPrice: reservation.pricingSnapshot.lockedPrice,
    commissionRateBps: reservation.pricingSnapshot.commissionBps,
    commissionAmount,
    providerNet,
    status: "unbilled",
    accruedAt: now,
  };

  const proposedReservation: Reservation = {
    ...reservation,
    status: "completed",
    revision: reservation.revision + 1, // Advance revision (e.g. 3 -> 4)
    completionTimestamp: now,
    commissionAccrualId: accrualId,
    isMutuallyConfirmed: true,
    completionPinDetails: {
      ...pinDetails,
      isConsumed: true,
    },
  };

  return {
    code: "PREPARED",
    proposal: {
      proposedReservation,
      calculatedAccrual,
    },
  };
}

/**
 * Attaches customer verified review strictly to completed reservations.
 * Increments revision.
 */
export function attachVerifiedReview(
  reservation: Reservation,
  review: VerifiedReview
): { success: boolean; error?: string; reservation?: Reservation } {
  if (reservation.status !== "completed") {
    return {
      success: false,
      error: "Cannot submit verified review: reservation has not been mutually completed.",
    };
  }

  return {
    success: true,
    reservation: {
      ...reservation,
      revision: reservation.revision + 1,
      verifiedReview: review,
    },
  };
}

/**
 * Cancels reservation if prior to check-in.
 * Increments revision.
 */
/**
 * Cancels reservation state.
 * Subject to demo cut-off rule: ONLY 'confirmed' can be cancelled.
 * Rejects checked_in, completed, customer_cancelled, no_show, and disputed.
 * Increments revision.
 */
export function cancelReservationState(reservation: Reservation): {
  success: boolean;
  error?: string;
  reservation?: Reservation;
} {
  if (reservation.status !== "confirmed") {
    return {
      success: false,
      error: `Cannot cancel reservation: Current status is '${reservation.status}'. Only reservations in 'confirmed' status before arrival can be cancelled.`,
    };
  }

  return {
    success: true,
    reservation: {
      ...reservation,
      status: "customer_cancelled",
      revision: reservation.revision + 1,
    },
  };
}

/**
 * Marks reservation no-show.
 * Increments revision.
 */
export function markNoShowState(reservation: Reservation): {
  success: boolean;
  error?: string;
  reservation?: Reservation;
} {
  if (reservation.status !== "confirmed") {
    return {
      success: false,
      error: `Cannot mark no-show for reservation in '${reservation.status}' state.`,
    };
  }

  return {
    success: true,
    reservation: {
      ...reservation,
      status: "no_show",
      revision: reservation.revision + 1,
    },
  };
}

/**
 * Validates and submits an offer draft below the UI.
 * Enforces:
 * - Actor must have 'sales' role
 * - Mandatory price evidence with valid metadata
 * - Valid category
 * - Integer Money in EGP > 0
 * - Discount within approved range (500 bps to 5000 bps / 5% to 50%)
 * - Commission within approved range (500 bps to 3000 bps / 5% to 30%)
 */
export function validateAndSubmitOfferDraft(
  draft: Omit<OfferDraft, "id" | "status" | "createdAt">,
  actor: { actorId: string; role: string },
  generatedId: string,
  now: string
): { success: boolean; error?: string; draft?: OfferDraft } {
  if (actor.role !== "sales") {
    return {
      success: false,
      error: `Unauthorized: Only actors with 'sales' role can submit offer drafts (current: '${actor.role}').`,
    };
  }

  if (
    !draft.priceEvidence ||
    !draft.priceEvidence.fileName ||
    !draft.priceEvidence.description ||
    draft.priceEvidence.fileSizeBytes <= 0
  ) {
    return {
      success: false,
      error: "Validation failed: Price evidence is mandatory to submit an offer draft.",
    };
  }

  const validCategories: ServiceCategoryId[] = [
    "maintenance",
    "repairs",
    "wash",
    "tyres",
    "batteries",
    "ac",
    "accessories",
  ];
  if (!validCategories.includes(draft.serviceCategory)) {
    return {
      success: false,
      error: `Validation failed: Invalid service category '${draft.serviceCategory}'.`,
    };
  }

  if (
    !draft.normalPrice ||
    typeof draft.normalPrice.amountMinor !== "number" ||
    !Number.isInteger(draft.normalPrice.amountMinor) ||
    draft.normalPrice.amountMinor <= 0 ||
    draft.normalPrice.currency !== "EGP"
  ) {
    return {
      success: false,
      error: "Validation failed: Normal price must be a positive integer minor amount in EGP.",
    };
  }

  if (
    typeof draft.discountBps !== "number" ||
    !Number.isInteger(draft.discountBps) ||
    draft.discountBps < 500 ||
    draft.discountBps > 5000
  ) {
    return {
      success: false,
      error: `Validation failed: Discount (${draft.discountBps} bps) is outside approved range (500 bps to 5000 bps / 5% to 50%).`,
    };
  }

  if (
    typeof draft.commissionBps !== "number" ||
    !Number.isInteger(draft.commissionBps) ||
    draft.commissionBps < 500 ||
    draft.commissionBps > 3000
  ) {
    return {
      success: false,
      error: `Validation failed: Commission (${draft.commissionBps} bps) is outside approved range (500 bps to 3000 bps / 5% to 30%).`,
    };
  }

  const newDraft: OfferDraft = {
    ...draft,
    id: generatedId,
    status: "pending_ops_approval",
    createdAt: now,
  };

  return {
    success: true,
    draft: newDraft,
  };
}

/**
 * Maker-Checker Ops Approval for Sales Draft
 * Enforces:
 * - Actor must have 'operations' role
 * - Approving actor cannot be submitting actor
 * - Draft must be in 'pending_ops_approval' status
 * - Mandatory price evidence
 */
export function approveOfferDraft(
  draft: OfferDraft,
  actor: { actorId: string; role: string },
  now: string
): { success: boolean; error?: string; offer?: OfferVariant; updatedDraft?: OfferDraft } {
  if (actor.role !== "operations") {
    return {
      success: false,
      error: `Unauthorized: Only actors with 'operations' role can approve offer drafts (current: '${actor.role}').`,
    };
  }

  if (actor.actorId === draft.createdBySalesId) {
    return {
      success: false,
      error:
        "Maker-Checker segregation violation: The approving operations actor cannot be the submitting sales actor.",
    };
  }

  if (draft.status !== "pending_ops_approval") {
    return {
      success: false,
      error: `Cannot approve draft: Current status is '${draft.status}'. Only drafts in 'pending_ops_approval' status can be approved.`,
    };
  }

  if (!draft.priceEvidence) {
    return {
      success: false,
      error: "Maker-Checker policy violation: price evidence is required before approval.",
    };
  }

  const publishedOffer: OfferVariant = {
    id: `offer-${draft.id.replace("draft-", "")}`,
    providerId: draft.providerId,
    branchId: draft.branchId,
    serviceCategory: draft.serviceCategory,
    titleEn: draft.titleEn,
    titleAr: draft.titleAr,
    subtitleEn: draft.subtitleEn,
    subtitleAr: draft.subtitleAr,
    normalPrice: draft.normalPrice,
    discountBps: draft.discountBps,
    lockedPrice: {
      amountMinor: Math.round(
        (draft.normalPrice.amountMinor * (10000 - draft.discountBps)) / 10000
      ),
      currency: "EGP",
    },
    saving: {
      amountMinor: Math.round((draft.normalPrice.amountMinor * draft.discountBps) / 10000),
      currency: "EGP",
    },
    commissionBps: draft.commissionBps,
    inclusionsEn: ["Standard service scope verified with partner workshop"],
    inclusionsAr: ["نطاق الخدمة القياسي المسجل من الورشة الشريكة"],
    exclusionsEn: ["Any extra work outside standard scope requires customer approval"],
    exclusionsAr: ["أي أعمال إضافية خارج النطاق تتطلب موافقة العميل المسبقة"],
    partsSpecificationEn: "Brand-compliant replacement parts",
    partsSpecificationAr: "قطع غيار مطابقة للمواصفات القياسية",
    laborIncluded: true,
    durationMinutes: 60,
    warrantyTermsEn: "Provisional workshop recourse policy on workmanship",
    warrantyTermsAr: "سياسة رجوع مؤقتة للورشة على جودة التنفيذ",
    additionalWorkRuleEn: "Additional work requires separate quote and customer approval",
    additionalWorkRuleAr: "الأعمال الإضافية تتطلب مقايسة منفصلة وموافقة العميل",
    cancellationPolicyEn: "Free cancellation before check-in arrival",
    cancellationPolicyAr: "إلغاء مجاني قبل تسجيل الحضور",
    compatibleVehicles: [{ make: "Nissan", model: "Sunny", yearFrom: 2013, yearTo: 2025 }],
    status: "published",
    rating: 4.8,
    reviewCount: 12,
  };

  const updatedDraft: OfferDraft = {
    ...draft,
    status: "approved",
    approvalMetadata: {
      draftId: draft.id,
      submittedBySalesId: draft.createdBySalesId,
      submittedAt: draft.createdAt,
      reviewedByOpsId: actor.actorId,
      reviewedAt: now,
      decision: "approved",
      decisionRationaleEn:
        "Price evidence attached for review verified against Cairo cluster benchmarks.",
      decisionRationaleAr: "تم التحقق من إثبات السعر المرفق مقارنة بأسعار السوق في القاهرة.",
    },
  };

  return {
    success: true,
    offer: publishedOffer,
    updatedDraft,
  };
}

/**
 * Derives provider financial exposure statement from immutable accruals.
 */
export function deriveProviderStatement(
  providerId: string,
  providerNameEn: string,
  providerNameAr: string,
  creditLimitMinor: number,
  accruals: CommissionAccrual[]
): ProviderStatement {
  const providerAccruals = accruals.filter((a) => a.providerId === providerId);
  const totalServiceVolumeMinor = providerAccruals.reduce(
    (sum, a) => sum + a.lockedPrice.amountMinor,
    0
  );
  const totalCommissionMinor = providerAccruals.reduce(
    (sum, a) => sum + a.commissionAmount.amountMinor,
    0
  );
  const currentExposureMinor = providerAccruals
    .filter((a) => a.status === "unbilled" || a.status === "invoiced")
    .reduce((sum, a) => sum + a.commissionAmount.amountMinor, 0);

  return {
    providerId,
    providerNameEn,
    providerNameAr,
    completedReservationsCount: providerAccruals.length,
    totalServiceVolume: moneyFromMinor(totalServiceVolumeMinor),
    totalCommissionAccrued: moneyFromMinor(totalCommissionMinor),
    creditLimit: moneyFromMinor(creditLimitMinor),
    currentExposure: moneyFromMinor(currentExposureMinor),
    isExposureHealthy: currentExposureMinor < creditLimitMinor,
    accruals: providerAccruals,
  };
}
