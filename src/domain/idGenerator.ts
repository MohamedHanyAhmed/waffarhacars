export interface IdGenerator {
  nextReservationId(): string;
  nextPassCode(): string;
  nextDraftId(): string;
  nextOfferId(draftId: string): string;
  nextAccrualId(reservationId: string): string;
  nextReviewId(): string;
  nextPin(): string;
  reset(): void;
}

export class DeterministicIdGenerator implements IdGenerator {
  private reservationSeq = 5688;
  private passCodeSeq = 7492;
  private draftSeq = 101;
  private reviewSeq = 1;

  nextReservationId(): string {
    const id = `res-sunny-${this.reservationSeq}`;
    this.reservationSeq++;
    return id;
  }

  nextPassCode(): string {
    const code = `WC-${this.passCodeSeq}`;
    this.passCodeSeq++;
    return code;
  }

  nextDraftId(): string {
    const id = `draft-partner-${this.draftSeq}`;
    this.draftSeq++;
    return id;
  }

  nextOfferId(draftId: string): string {
    return `offer-${draftId.replace("draft-", "")}`;
  }

  nextAccrualId(reservationId: string): string {
    return `accrual-${reservationId}`;
  }

  nextReviewId(): string {
    const id = `review-${String(this.reviewSeq).padStart(3, "0")}`;
    this.reviewSeq++;
    return id;
  }

  nextPin(): string {
    return "4921";
  }

  reset(): void {
    this.reservationSeq = 5688;
    this.passCodeSeq = 7492;
    this.draftSeq = 101;
    this.reviewSeq = 1;
  }
}

export const DEFAULT_ID_GENERATOR = new DeterministicIdGenerator();
