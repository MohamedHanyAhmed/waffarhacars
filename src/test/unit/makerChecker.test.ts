import { describe, it, expect } from "vitest";
import {
  DEMO_PRICE_EVIDENCE,
  SEED_OFFER_DRAFTS,
  createSeededReservation,
} from "../../domain/fixtures";
import { approveOfferDraft, validateAndSubmitOfferDraft } from "../../domain/stateTransitions";
import { OfferDraft, ActorContext, ServiceCategoryId } from "../../domain/types";
import { createMoney } from "../../domain/money";

describe("Domain: Operations Maker-Checker Separation & Invariant Enforcement", () => {
  const clockNow = "2026-09-13T12:00:00.000Z";
  const salesActor: ActorContext = { actorId: "sales-rep-01", role: "sales" };
  const opsActor: ActorContext = { actorId: "ops-manager-01", role: "operations" };

  const validDraftInput: Omit<OfferDraft, "id" | "status" | "createdAt"> = {
    providerId: "prov-orbit-care",
    branchId: "branch-heliopolis-01",
    serviceCategory: "maintenance",
    titleEn: "Standard Periodic Service",
    titleAr: "خدمة صيانة دورية قياسية",
    subtitleEn: "Comprehensive multi-point inspection",
    subtitleAr: "فحص شامل متعدد النقاط",
    normalPrice: createMoney(1200),
    discountBps: 2000, // 20%
    commissionBps: 1000, // 10%
    priceEvidence: DEMO_PRICE_EVIDENCE,
    createdBySalesId: "sales-rep-01",
  };

  describe("submitOfferDraft() Invariants", () => {
    it("accepts compliant submission by sales actor", () => {
      const res = validateAndSubmitOfferDraft(
        validDraftInput,
        salesActor,
        "draft-test-01",
        clockNow
      );
      expect(res.success).toBe(true);
      expect(res.draft).toBeDefined();
      expect(res.draft?.status).toBe("pending_ops_approval");
      expect(res.draft?.id).toBe("draft-test-01");
    });

    it("rejects submission if actor role is not sales", () => {
      const nonSalesActor: ActorContext = { actorId: "ops-01", role: "operations" };
      const res = validateAndSubmitOfferDraft(
        validDraftInput,
        nonSalesActor,
        "draft-test-01",
        clockNow
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain("Only actors with 'sales' role can submit offer drafts");
    });

    it("rejects submission if price evidence is missing or incomplete", () => {
      const missingEvidence = { ...validDraftInput, priceEvidence: null };
      const res = validateAndSubmitOfferDraft(
        missingEvidence,
        salesActor,
        "draft-test-01",
        clockNow
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain("Price evidence is mandatory");
    });

    it("rejects submission if service category is invalid", () => {
      const invalidCat = {
        ...validDraftInput,
        serviceCategory: "invalid_cat" as ServiceCategoryId,
      };
      const res = validateAndSubmitOfferDraft(invalidCat, salesActor, "draft-test-01", clockNow);
      expect(res.success).toBe(false);
      expect(res.error).toContain("Invalid service category");
    });

    it("rejects submission if normal price is not positive integer money in EGP", () => {
      const negativePrice = {
        ...validDraftInput,
        normalPrice: { amountMinor: -500, currency: "EGP" as const },
      };
      const res1 = validateAndSubmitOfferDraft(
        negativePrice,
        salesActor,
        "draft-test-01",
        clockNow
      );
      expect(res1.success).toBe(false);
      expect(res1.error).toContain("Normal price must be a positive integer minor amount");

      const nonIntegerPrice = {
        ...validDraftInput,
        normalPrice: { amountMinor: 1200.5, currency: "EGP" as const },
      };
      const res2 = validateAndSubmitOfferDraft(
        nonIntegerPrice,
        salesActor,
        "draft-test-01",
        clockNow
      );
      expect(res2.success).toBe(false);
      expect(res2.error).toContain("Normal price must be a positive integer minor amount");
    });

    it("rejects submission if discount is outside approved range (500 to 5000 bps / 5% to 50%)", () => {
      const tooLowDiscount = { ...validDraftInput, discountBps: 200 }; // 2%
      const res1 = validateAndSubmitOfferDraft(
        tooLowDiscount,
        salesActor,
        "draft-test-01",
        clockNow
      );
      expect(res1.success).toBe(false);
      expect(res1.error).toContain("outside approved range");

      const tooHighDiscount = { ...validDraftInput, discountBps: 6000 }; // 60%
      const res2 = validateAndSubmitOfferDraft(
        tooHighDiscount,
        salesActor,
        "draft-test-01",
        clockNow
      );
      expect(res2.success).toBe(false);
      expect(res2.error).toContain("outside approved range");
    });

    it("rejects submission if commission is outside approved range (500 to 3000 bps / 5% to 30%)", () => {
      const tooLowCommission = { ...validDraftInput, commissionBps: 300 }; // 3%
      const res1 = validateAndSubmitOfferDraft(
        tooLowCommission,
        salesActor,
        "draft-test-01",
        clockNow
      );
      expect(res1.success).toBe(false);
      expect(res1.error).toContain("outside approved range");

      const tooHighCommission = { ...validDraftInput, commissionBps: 4000 }; // 40%
      const res2 = validateAndSubmitOfferDraft(
        tooHighCommission,
        salesActor,
        "draft-test-01",
        clockNow
      );
      expect(res2.success).toBe(false);
      expect(res2.error).toContain("outside approved range");
    });
  });

  describe("approveOfferDraft() Maker-Checker Invariants", () => {
    const pendingDraft: OfferDraft = {
      ...SEED_OFFER_DRAFTS[0],
      status: "pending_ops_approval",
      priceEvidence: DEMO_PRICE_EVIDENCE,
      createdBySalesId: "sales-rep-01",
    };

    it("rejects approval if actor role is not operations", () => {
      const nonOpsActor: ActorContext = { actorId: "sales-rep-02", role: "sales" };
      const res = approveOfferDraft(pendingDraft, nonOpsActor, clockNow);
      expect(res.success).toBe(false);
      expect(res.error).toContain("Only actors with 'operations' role can approve offer drafts");
    });

    it("rejects approval if approving operations actor is the submitting sales actor", () => {
      const dualActor: ActorContext = { actorId: "sales-rep-01", role: "operations" };
      const res = approveOfferDraft(pendingDraft, dualActor, clockNow);
      expect(res.success).toBe(false);
      expect(res.error).toContain(
        "The approving operations actor cannot be the submitting sales actor"
      );
    });

    it("rejects approval if draft is not in pending_ops_approval status", () => {
      const alreadyApproved: OfferDraft = { ...pendingDraft, status: "approved" };
      const res1 = approveOfferDraft(alreadyApproved, opsActor, clockNow);
      expect(res1.success).toBe(false);
      expect(res1.error).toContain("Current status is 'approved'");

      const alreadyRejected: OfferDraft = { ...pendingDraft, status: "rejected" };
      const res2 = approveOfferDraft(alreadyRejected, opsActor, clockNow);
      expect(res2.success).toBe(false);
      expect(res2.error).toContain("Current status is 'rejected'");
    });

    it("rejects approval if price evidence is missing", () => {
      const noEvidenceDraft: OfferDraft = { ...pendingDraft, priceEvidence: null };
      const res = approveOfferDraft(noEvidenceDraft, opsActor, clockNow);
      expect(res.success).toBe(false);
      expect(res.error).toContain("price evidence is required before approval");
    });

    it("approves compliant draft and creates published offer with ApprovalMetadata", () => {
      const res = approveOfferDraft(pendingDraft, opsActor, clockNow);
      expect(res.success).toBe(true);
      expect(res.offer).toBeDefined();
      expect(res.offer?.status).toBe("published");
      expect(res.updatedDraft?.status).toBe("approved");
      expect(res.updatedDraft?.approvalMetadata?.reviewedByOpsId).toBe("ops-manager-01");
      expect(res.updatedDraft?.approvalMetadata?.decision).toBe("approved");
    });

    it("publishing a new offer does not mutate existing frozen customer reservation snapshot", () => {
      const frozenReservation = createSeededReservation("confirmed", clockNow);
      const originalTitle = frozenReservation.offerSnapshot.titleEn;
      const originalNormalMinor = frozenReservation.pricingSnapshot.normalPrice.amountMinor;

      const res = approveOfferDraft(pendingDraft, opsActor, clockNow);
      expect(res.success).toBe(true);

      // Assert reservation snapshot remains 100% frozen
      expect(frozenReservation.offerSnapshot.titleEn).toBe(originalTitle);
      expect(frozenReservation.pricingSnapshot.normalPrice.amountMinor).toBe(originalNormalMinor);
    });
  });
});
