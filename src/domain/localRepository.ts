import { DemoRepository, CommitCompletionResult } from "./repository";
import {
  OfferVariant,
  OfferDraft,
  Reservation,
  CommissionAccrual,
  ProviderStatement,
  DemoScenarioMode,
  VerifiedReview,
  Vehicle,
  ActorContext,
} from "./types";
import {
  PUBLISHED_OFFERS,
  SEED_OFFER_DRAFTS,
  DEMO_PROVIDERS,
  createPricingSnapshot,
  createSeededReservation,
} from "./fixtures";
import {
  checkInReservation,
  revealCompletionPin,
  prepareCompletion,
  approveOfferDraft,
  validateAndSubmitOfferDraft,
  attachVerifiedReview,
  cancelReservationState,
  markNoShowState,
  deriveProviderStatement,
  CheckInResult,
} from "./stateTransitions";
import { Clock, DEFAULT_CLOCK } from "./clock";
import { IdGenerator, DEFAULT_ID_GENERATOR } from "./idGenerator";
import { calculateCommission } from "./money";

export interface LocalRepositorySerializableState {
  publishedOffers: OfferVariant[];
  offerDrafts: OfferDraft[];
  reservation: Reservation | null;
  accrualsRecord: Record<string, CommissionAccrual>; // Serializable format for Map
  scenario: DemoScenarioMode;
}

export class LocalDemoRepository implements DemoRepository {
  private clock: Clock;
  private idGenerator: IdGenerator;
  private publishedOffers: OfferVariant[];
  private offerDrafts: OfferDraft[];
  private reservation: Reservation | null;
  // Authoritative collection keyed by reservationId to prevent duplicate accrual creation
  private accrualsByReservationId: Map<string, CommissionAccrual>;
  private scenario: DemoScenarioMode;

  constructor(
    clock: Clock = DEFAULT_CLOCK,
    idGenerator: IdGenerator = DEFAULT_ID_GENERATOR,
    initialState?: Partial<LocalRepositorySerializableState>
  ) {
    this.clock = clock;
    this.idGenerator = idGenerator;
    this.publishedOffers = initialState?.publishedOffers
      ? [...initialState.publishedOffers]
      : [...PUBLISHED_OFFERS];
    this.offerDrafts = initialState?.offerDrafts
      ? [...initialState.offerDrafts]
      : [...SEED_OFFER_DRAFTS];
    this.reservation = initialState?.reservation !== undefined ? initialState.reservation : null;
    this.scenario = initialState?.scenario || "clean_empty";

    this.accrualsByReservationId = new Map();
    if (initialState?.accrualsRecord) {
      for (const [resId, accrual] of Object.entries(initialState.accrualsRecord)) {
        this.accrualsByReservationId.set(resId, accrual);
      }
    }
  }

  public getSerializableState(): LocalRepositorySerializableState {
    const accrualsRecord: Record<string, CommissionAccrual> = {};
    this.accrualsByReservationId.forEach((accrual, resId) => {
      accrualsRecord[resId] = accrual;
    });

    return {
      publishedOffers: this.publishedOffers,
      offerDrafts: this.offerDrafts,
      reservation: this.reservation,
      accrualsRecord,
      scenario: this.scenario,
    };
  }

  async getPublishedOffers(): Promise<OfferVariant[]> {
    return this.publishedOffers;
  }

  async getOfferById(id: string): Promise<OfferVariant | null> {
    return this.publishedOffers.find((o) => o.id === id) || null;
  }

  async getActiveReservation(): Promise<Reservation | null> {
    return this.reservation;
  }

  async createReservation(params: {
    offerId: string;
    vehicle: Vehicle;
    customerName: string;
    customerPhone: string;
    scheduledSlot: string;
  }): Promise<Reservation> {
    const offer = await this.getOfferById(params.offerId);
    if (!offer) {
      throw new Error("Offer " + params.offerId + " not found");
    }

    const pricingSnapshot = createPricingSnapshot(offer);
    const resId = this.idGenerator.nextReservationId();
    const passCode = this.idGenerator.nextPassCode();

    const newRes: Reservation = {
      id: resId,
      revision: 1, // Created at revision 1
      passCode,
      qrTokenHash: `wc:pass:${passCode}:sha256-verified-demo`,
      customerName: params.customerName || "Tarek Mostafa (Demo Customer)",
      customerPhoneMasked: "+20 10 **** 5821",
      vehicle: params.vehicle,
      provider: DEMO_PROVIDERS[0],
      branch: DEMO_PROVIDERS[0].branches[0],
      offerSnapshot: offer,
      pricingSnapshot,
      scheduledSlot: params.scheduledSlot || "Today, 3:30 PM (Nasr City)",
      status: "confirmed",
      completionPinDetails: null, // PIN unissued initially
      isMutuallyConfirmed: false,
    };

    this.reservation = newRes;
    return newRes;
  }

  async checkInReservation(
    passCode: string,
    staffId: string = "staff-orbit-01"
  ): Promise<CheckInResult> {
    if (!this.reservation || this.reservation.passCode !== passCode) {
      return {
        code: "PASS_NOT_FOUND",
        messageEn: "Pass code not found or invalid.",
        messageAr: "كود البطاقة غير موجود أو غير صالح.",
      };
    }

    const result = checkInReservation(this.reservation, staffId, this.clock.now());
    if (result.code === "SUCCESS" && result.reservation) {
      this.reservation = result.reservation;
    }
    return result;
  }

  async revealPin(
    passCode: string
  ): Promise<{ success: boolean; error?: string; reservation?: Reservation }> {
    if (!this.reservation || this.reservation.passCode !== passCode) {
      return { success: false, error: "Pass code not found." };
    }

    const result = revealCompletionPin(this.reservation, this.clock.now());
    if (result.success && result.reservation) {
      this.reservation = result.reservation;
      return { success: true, reservation: result.reservation };
    }
    return { success: false, error: result.error };
  }

  /**
   * Compare-and-Set (CAS) atomic commit for mutual completion.
   */
  async completeReservation(
    passCode: string,
    pin: string,
    expectedRevision: number
  ): Promise<CommitCompletionResult> {
    if (!this.reservation || this.reservation.passCode !== passCode) {
      const fallbackRes: Reservation = this.reservation || {
        id: "unknown",
        revision: 0,
        passCode,
        qrTokenHash: "",
        customerName: "",
        customerPhoneMasked: "",
        vehicle: {} as Vehicle,
        provider: DEMO_PROVIDERS[0],
        branch: DEMO_PROVIDERS[0].branches[0],
        offerSnapshot: PUBLISHED_OFFERS[0],
        pricingSnapshot: createPricingSnapshot(PUBLISHED_OFFERS[0]),
        scheduledSlot: "",
        status: "confirmed",
        completionPinDetails: null,
        isMutuallyConfirmed: false,
      };

      return {
        code: "INVALID_STATE",
        messageEn: "Reservation not found for the supplied pass code.",
        messageAr: "لم يتم العثور على حجز لكود البطاقة المدخل.",
        reservation: fallbackRes,
        accruals: Array.from(this.accrualsByReservationId.values()),
      };
    }

    // Check if already completed
    if (this.reservation.status === "completed") {
      return {
        code: "ALREADY_COMPLETED",
        messageEn: `Reservation was already completed at ${this.reservation.completionTimestamp}. Accrual is unchanged.`,
        messageAr: `تم إتمام الحجز مسبقاً في ${this.reservation.completionTimestamp}. لم يتم تسجيل أي عمولة إضافية.`,
        reservation: this.reservation,
        accruals: Array.from(this.accrualsByReservationId.values()),
      };
    }

    // CAS check: Validate expected revision
    if (this.reservation.revision !== expectedRevision) {
      return {
        code: "STALE_COMMAND",
        messageEn: `Concurrency conflict: Stale revision ${expectedRevision} rejected. Current aggregate revision is ${this.reservation.revision}.`,
        messageAr: `تعارض تزامن: تم رفض الأمر ذي النسخة ${expectedRevision}. النسخة الحالية للحجز هي ${this.reservation.revision}.`,
        reservation: this.reservation,
        accruals: Array.from(this.accrualsByReservationId.values()),
      };
    }

    // Pure domain transition calculation
    const prep = prepareCompletion(this.reservation, pin, this.clock.now());

    if (prep.code !== "PREPARED") {
      return {
        code: prep.code,
        messageEn: prep.messageEn,
        messageAr: prep.messageAr,
        reservation: this.reservation,
        accruals: Array.from(this.accrualsByReservationId.values()),
      };
    }

    // Commit proposal
    const { proposedReservation, calculatedAccrual } = prep.proposal;

    this.reservation = proposedReservation;

    // Persist accrual in keyed Map
    if (!this.accrualsByReservationId.has(proposedReservation.id)) {
      this.accrualsByReservationId.set(proposedReservation.id, calculatedAccrual);
    }

    return {
      code: "SUCCESS",
      messageEn: `Completion Confirmed! EGP ${calculatedAccrual.commissionAmount.amountMinor / 100} commission accrued to WaffarhaCars receivable ledger.`,
      messageAr: `تم تأكيد الإتمام! تم قيد ${calculatedAccrual.commissionAmount.amountMinor / 100 === 96 ? "٩٦" : calculatedAccrual.commissionAmount.amountMinor / 100} ج.م كعمولة مستحقة لوفّرها كارز في دفتر الحسابات.`,
      reservation: proposedReservation,
      accruals: Array.from(this.accrualsByReservationId.values()),
      newlyAccrued: calculatedAccrual,
    };
  }

  async cancelReservation(id: string): Promise<Reservation> {
    if (!this.reservation || this.reservation.id !== id) {
      throw new Error("Reservation not found");
    }
    const result = cancelReservationState(this.reservation);
    if (!result.success || !result.reservation) {
      throw new Error(result.error || "Failed to cancel reservation");
    }
    this.reservation = result.reservation;
    return this.reservation;
  }

  async markNoShow(id: string): Promise<Reservation> {
    if (!this.reservation || this.reservation.id !== id) {
      throw new Error("Reservation not found");
    }
    const result = markNoShowState(this.reservation);
    if (!result.success || !result.reservation) {
      throw new Error(result.error || "Failed to mark no-show");
    }
    this.reservation = result.reservation;
    return this.reservation;
  }

  async submitOfferDraft(
    draft: Omit<OfferDraft, "id" | "status" | "createdAt">,
    actor: ActorContext = { actorId: "sales-rep-cairo-01", role: "sales" }
  ): Promise<OfferDraft> {
    const draftId = this.idGenerator.nextDraftId();
    const result = validateAndSubmitOfferDraft(draft, actor, draftId, this.clock.now());
    if (!result.success || !result.draft) {
      throw new Error(result.error || "Failed to submit offer draft");
    }
    this.offerDrafts = [result.draft, ...this.offerDrafts];
    return result.draft;
  }

  async getOfferDrafts(): Promise<OfferDraft[]> {
    return this.offerDrafts;
  }

  async approveOfferDraft(
    draftId: string,
    actor: ActorContext = { actorId: "ops-manager-cairo", role: "operations" }
  ): Promise<{ success: boolean; offer?: OfferVariant; error?: string }> {
    const draft = this.offerDrafts.find((d) => d.id === draftId);
    if (!draft) return { success: false, error: "Draft not found" };

    const res = approveOfferDraft(draft, actor, this.clock.now());
    if (res.success && res.offer && res.updatedDraft) {
      this.publishedOffers = [res.offer, ...this.publishedOffers];
      this.offerDrafts = this.offerDrafts.map((d) => (d.id === draftId ? res.updatedDraft! : d));
      return { success: true, offer: res.offer };
    }
    return { success: false, error: res.error };
  }

  async submitVerifiedReview(reservationId: string, review: VerifiedReview): Promise<Reservation> {
    if (!this.reservation || this.reservation.id !== reservationId) {
      throw new Error("Reservation not found");
    }
    const res = attachVerifiedReview(this.reservation, review);
    if (!res.success || !res.reservation) {
      throw new Error(res.error || "Failed to attach review");
    }
    this.reservation = res.reservation;
    return this.reservation;
  }

  async getProviderStatement(providerId: string): Promise<ProviderStatement> {
    const provider = DEMO_PROVIDERS.find((p) => p.id === providerId) || DEMO_PROVIDERS[0];
    const accruals = Array.from(this.accrualsByReservationId.values());
    return deriveProviderStatement(
      provider.id,
      provider.nameEn,
      provider.nameAr,
      provider.creditLimit.amountMinor,
      accruals
    );
  }

  async getAccruals(): Promise<CommissionAccrual[]> {
    return Array.from(this.accrualsByReservationId.values());
  }

  async selectScenario(mode: DemoScenarioMode): Promise<void> {
    this.scenario = mode;
    const now = this.clock.now();

    if (mode === "clean_empty") {
      this.reservation = null;
      this.accrualsByReservationId.clear();
    } else if (mode === "loading") {
      // Keep reservation but mark scenario as loading
      this.reservation = null;
      this.accrualsByReservationId.clear();
    } else if (mode === "incompatible_vehicle") {
      this.reservation = null;
      this.accrualsByReservationId.clear();
    } else if (mode === "confirmed") {
      this.reservation = createSeededReservation("confirmed", now);
      this.accrualsByReservationId.clear();
    } else if (mode === "checked_in_unissued") {
      const seeded = createSeededReservation("checked_in", now);
      seeded.completionPinDetails = null; // PIN unissued
      this.reservation = seeded;
      this.accrualsByReservationId.clear();
    } else if (mode === "checked_in_valid_pin") {
      this.reservation = createSeededReservation("checked_in", now);
      this.accrualsByReservationId.clear();
    } else if (mode === "wrong_pin") {
      this.reservation = createSeededReservation("checked_in", now);
      this.accrualsByReservationId.clear();
    } else if (mode === "expired_pin") {
      const seeded = createSeededReservation("checked_in", now);
      seeded.completionPinDetails = {
        pin: "4921",
        isIssued: true,
        issuedAt: "2026-09-13T11:00:00.000Z",
        expiresAt: "2026-09-13T11:15:00.000Z", // Expired at current 12:00
        isConsumed: false,
      };
      this.reservation = seeded;
      this.accrualsByReservationId.clear();
    } else if (mode === "cancelled") {
      this.reservation = createSeededReservation("customer_cancelled", now);
      this.accrualsByReservationId.clear();
    } else if (mode === "no_show") {
      this.reservation = createSeededReservation("no_show", now);
      this.accrualsByReservationId.clear();
    } else if (mode === "already_completed") {
      const seeded = createSeededReservation("completed", now);
      this.reservation = seeded;
      const { commissionAmount, providerNet } = calculateCommission(
        seeded.pricingSnapshot.lockedPrice,
        seeded.pricingSnapshot.commissionBps
      );
      this.accrualsByReservationId.clear();
      this.accrualsByReservationId.set(seeded.id, {
        id: "accrual-" + seeded.id,
        reservationId: seeded.id,
        passCode: seeded.passCode,
        providerId: seeded.provider.id,
        providerNameEn: seeded.provider.nameEn,
        providerNameAr: seeded.provider.nameAr,
        branchNameEn: seeded.branch.nameEn,
        branchNameAr: seeded.branch.nameAr,
        serviceTitleEn: seeded.offerSnapshot.titleEn,
        serviceTitleAr: seeded.offerSnapshot.titleAr,
        lockedPrice: seeded.pricingSnapshot.lockedPrice,
        commissionRateBps: seeded.pricingSnapshot.commissionBps,
        commissionAmount,
        providerNet,
        status: "unbilled",
        accruedAt: now,
      });
    } else {
      this.reservation = null;
      this.accrualsByReservationId.clear();
    }
  }

  getScenario(): DemoScenarioMode {
    return this.scenario;
  }

  async resetDemo(): Promise<void> {
    this.idGenerator.reset();
    this.publishedOffers = [...PUBLISHED_OFFERS];
    this.offerDrafts = [...SEED_OFFER_DRAFTS];
    this.reservation = null; // Truthful baseline: null
    this.accrualsByReservationId.clear(); // 0 accruals
    this.scenario = "clean_empty";
  }
}
