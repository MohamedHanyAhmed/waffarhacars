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
import { CheckInResult } from "./stateTransitions";

export interface CommitCompletionResult {
  code:
    | "SUCCESS"
    | "STALE_COMMAND"
    | "ALREADY_COMPLETED"
    | "INVALID_STATE"
    | "INVALID_PIN"
    | "PIN_EXPIRED"
    | "PIN_NOT_ISSUED";
  messageEn: string;
  messageAr: string;
  reservation: Reservation;
  accruals: CommissionAccrual[];
  newlyAccrued?: CommissionAccrual;
}

export interface DemoRepository {
  getPublishedOffers(): Promise<OfferVariant[]>;
  getOfferById(id: string): Promise<OfferVariant | null>;
  getActiveReservation(): Promise<Reservation | null>;
  createReservation(params: {
    offerId: string;
    vehicle: Vehicle;
    customerName: string;
    customerPhone: string;
    scheduledSlot: string;
  }): Promise<Reservation>;
  checkInReservation(passCode: string, staffId: string): Promise<CheckInResult>;
  revealPin(
    passCode: string
  ): Promise<{ success: boolean; error?: string; reservation?: Reservation }>;
  completeReservation(
    passCode: string,
    pin: string,
    expectedRevision: number
  ): Promise<CommitCompletionResult>;
  cancelReservation(id: string): Promise<Reservation>;
  markNoShow(id: string): Promise<Reservation>;
  submitOfferDraft(
    draft: Omit<OfferDraft, "id" | "status" | "createdAt">,
    actor?: ActorContext
  ): Promise<OfferDraft>;
  getOfferDrafts(): Promise<OfferDraft[]>;
  approveOfferDraft(
    draftId: string,
    actor?: ActorContext
  ): Promise<{ success: boolean; offer?: OfferVariant; error?: string }>;
  submitVerifiedReview(reservationId: string, review: VerifiedReview): Promise<Reservation>;
  getProviderStatement(providerId: string): Promise<ProviderStatement>;
  selectScenario(mode: DemoScenarioMode): Promise<void>;
  getScenario(): DemoScenarioMode;
  resetDemo(): Promise<void>;
  getAccruals(): Promise<CommissionAccrual[]>;
}
