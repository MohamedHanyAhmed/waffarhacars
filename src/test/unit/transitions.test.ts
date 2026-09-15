import { describe, it, expect } from "vitest";
import { DEMO_VEHICLES, PUBLISHED_OFFERS, createPricingSnapshot } from "../../domain/fixtures";
import {
  checkInReservation,
  revealCompletionPin,
  prepareCompletion,
  attachVerifiedReview,
  cancelReservationState,
  markNoShowState,
} from "../../domain/stateTransitions";
import { Reservation, ReservationStatus } from "../../domain/types";
import { LocalDemoRepository } from "../../domain/localRepository";
import { StaticClock } from "../../domain/clock";

describe("Domain: Authoritative Mutual Completion & Revision Tracking", () => {
  const clock = new StaticClock("2026-09-13T12:00:00.000Z");

  function makeInitialConfirmedReservation(): Reservation {
    const offer = PUBLISHED_OFFERS[0];
    return {
      id: "res-test-01",
      revision: 1,
      passCode: "WC-7492",
      qrTokenHash: "hash-7492",
      customerName: "Tarek Mostafa",
      customerPhoneMasked: "+20 10 **** 5821",
      vehicle: DEMO_VEHICLES.defaultSunny,
      provider: {
        id: "prov-orbit-care",
        nameEn: "Orbit Auto Care",
        nameAr: "مركز أوربيت لصيانة السيارات",
        isDemo: true,
        verifiedBusiness: true,
        creditLimit: { amountMinor: 200000, currency: "EGP" },
        branches: [],
      },
      branch: {
        id: "branch-01",
        providerId: "prov-orbit-care",
        nameEn: "Nasr City Branch",
        nameAr: "فرع مدينة نصر",
        areaEn: "Nasr City",
        areaAr: "مدينة نصر",
        addressEn: "Abbas St",
        addressAr: "شارع عباس",
        distanceKm: 2.4,
        phone: "02 2401 9820",
      },
      offerSnapshot: offer,
      pricingSnapshot: createPricingSnapshot(offer),
      scheduledSlot: "Today, 3:30 PM",
      status: "confirmed",
      completionPinDetails: null, // PIN unissued initially
      isMutuallyConfirmed: false,
    };
  }

  it("progresses aggregate revision exactly: 1 (confirmed) -> 2 (checked_in) -> 3 (PIN revealed) -> 4 (completed)", () => {
    const res1 = makeInitialConfirmedReservation();
    expect(res1.revision).toBe(1);
    expect(res1.status).toBe("confirmed");
    expect(res1.completionPinDetails).toBeNull();

    // 1. Check in (advances revision 1 -> 2)
    const checkInRes = checkInReservation(res1, "staff-01", clock.now());
    expect(checkInRes.code).toBe("SUCCESS");
    const res2 = checkInRes.reservation!;
    expect(res2.revision).toBe(2);
    expect(res2.status).toBe("checked_in");
    expect(res2.completionPinDetails).toBeNull();

    // 2. Reveal PIN (advances revision 2 -> 3)
    const revealRes = revealCompletionPin(res2, clock.now(), "4921", 15);
    expect(revealRes.success).toBe(true);
    const res3 = revealRes.reservation!;
    expect(res3.revision).toBe(3);
    expect(res3.completionPinDetails?.isIssued).toBe(true);
    expect(res3.completionPinDetails?.isConsumed).toBe(false);

    // 3. Prepare completion (proposes revision 3 -> 4)
    const prep = prepareCompletion(res3, "4921", clock.now());
    expect(prep.code).toBe("PREPARED");
    if (prep.code === "PREPARED" && prep.proposal) {
      const res4 = prep.proposal.proposedReservation;
      expect(res4.revision).toBe(4);
      expect(res4.status).toBe("completed");
      expect(res4.completionPinDetails?.isConsumed).toBe(true);
      expect(prep.proposal.calculatedAccrual.commissionAmount.amountMinor).toBe(9600); // Freshly calculated EGP 96
    }
  });

  it("rejects completion before PIN is issued", () => {
    const res1 = makeInitialConfirmedReservation();
    const res2 = checkInReservation(res1, "staff-01", clock.now()).reservation!;
    // res2 is checked_in, but PIN is not yet revealed/issued
    const prep = prepareCompletion(res2, "4921", clock.now());
    expect(prep.code).toBe("PIN_NOT_ISSUED");
  });

  it("rejects completion when deterministic clock exceeds PIN expiration", () => {
    const res1 = makeInitialConfirmedReservation();
    const res2 = checkInReservation(res1, "staff-01", clock.now()).reservation!;
    const res3 = revealCompletionPin(res2, clock.now(), "4921", 15).reservation!;

    // Advance clock by 16 minutes
    const advancedClock = new StaticClock(clock.now());
    advancedClock.advanceMinutes(16);

    const prep = prepareCompletion(res3, "4921", advancedClock.now());
    expect(prep.code).toBe("PIN_EXPIRED");
  });

  it("executes real competing-command CAS test against repository", async () => {
    const repoClock = new StaticClock("2026-09-13T12:00:00.000Z");
    const repo = new LocalDemoRepository(repoClock);

    // Create reservation (revision 1)
    const res1 = await repo.createReservation({
      offerId: "offer-oil-change-sunny",
      vehicle: DEMO_VEHICLES.defaultSunny,
      customerName: "Tarek Mostafa",
      customerPhone: "+20 10 1234 5678",
      scheduledSlot: "Today, 3:30 PM",
    });
    expect(res1.revision).toBe(1);

    // Provider checks in arrival (revision 2)
    const checkInResult = await repo.checkInReservation(res1.passCode, "staff-orbit-01");
    expect(checkInResult.code).toBe("SUCCESS");

    // Customer reveals PIN on pass (revision 3)
    const revealResult = await repo.revealPin(res1.passCode);
    expect(revealResult.success).toBe(true);
    expect(revealResult.reservation?.revision).toBe(3);

    // Two competing completion commands dispatched concurrently carrying the same pre-state expectedRevision (3)
    const call1Promise = repo.completeReservation(res1.passCode, "4921", 3);
    const call2Promise = repo.completeReservation(res1.passCode, "4921", 3);

    const [result1, result2] = await Promise.all([call1Promise, call2Promise]);

    const results = [result1, result2];
    const successes = results.filter((r) => r.code === "SUCCESS");
    const failures = results.filter(
      (r) => r.code === "STALE_COMMAND" || r.code === "ALREADY_COMPLETED"
    );

    // Invariant: Exactly one commit succeeded, exactly one rejected as stale
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const currentRes = await repo.getActiveReservation();
    expect(currentRes?.status).toBe("completed");
    expect(currentRes?.revision).toBe(4); // Incremented exactly once
    expect(currentRes?.completionPinDetails?.isConsumed).toBe(true);

    // Invariant: Exactly one accrual exists, total commission is strictly 9,600 minor (EGP 96)
    const accruals = await repo.getAccruals();
    expect(accruals.length).toBe(1);
    expect(accruals[0].commissionAmount.amountMinor).toBe(9600);
    expect(accruals[0].lockedPrice.amountMinor).toBe(96000);
  });

  describe("Strict Terminal-State Transitions (cancelReservationState)", () => {
    it("accepts cancellation only from confirmed state, advancing revision", () => {
      const res = makeInitialConfirmedReservation();
      const cancelRes = cancelReservationState(res);
      expect(cancelRes.success).toBe(true);
      expect(cancelRes.reservation?.status).toBe("customer_cancelled");
      expect(cancelRes.reservation?.revision).toBe(2);
    });

    it("rejects repeated cancellation from already-cancelled state", () => {
      const res = makeInitialConfirmedReservation();
      const firstCancel = cancelReservationState(res);
      expect(firstCancel.success).toBe(true);
      const cancelledRes = firstCancel.reservation!;

      const secondCancel = cancelReservationState(cancelledRes);
      expect(secondCancel.success).toBe(false);
      expect(secondCancel.error).toContain("Current status is 'customer_cancelled'");
    });

    it("rejects cancellation from checked_in state", () => {
      const res = makeInitialConfirmedReservation();
      res.status = "checked_in";
      res.revision = 2;

      const cancelRes = cancelReservationState(res);
      expect(cancelRes.success).toBe(false);
      expect(cancelRes.error).toContain("Current status is 'checked_in'");
    });

    it("rejects cancellation from completed state", () => {
      const res = makeInitialConfirmedReservation();
      res.status = "completed";
      res.revision = 4;

      const cancelRes = cancelReservationState(res);
      expect(cancelRes.success).toBe(false);
      expect(cancelRes.error).toContain("Current status is 'completed'");
    });

    it("rejects cancellation from no_show state", () => {
      const res = makeInitialConfirmedReservation();
      res.status = "no_show";
      res.revision = 2;

      const cancelRes = cancelReservationState(res);
      expect(cancelRes.success).toBe(false);
      expect(cancelRes.error).toContain("Current status is 'no_show'");
    });

    it("rejects cancellation from disputed state", () => {
      const res = makeInitialConfirmedReservation();
      res.status = "disputed";
      res.revision = 3;

      const cancelRes = cancelReservationState(res);
      expect(cancelRes.success).toBe(false);
      expect(cancelRes.error).toContain("Current status is 'disputed'");
    });
  });

  describe("markNoShowState() Terminal Invariants", () => {
    it("marks confirmed reservation as no_show and advances revision", () => {
      const res = makeInitialConfirmedReservation();
      const noShowRes = markNoShowState(res);
      expect(noShowRes.success).toBe(true);
      expect(noShowRes.reservation?.status).toBe("no_show");
      expect(noShowRes.reservation?.revision).toBe(2);
    });

    it("rejects marking no-show from non-confirmed states", () => {
      const invalidStates: ReservationStatus[] = [
        "checked_in",
        "completed",
        "customer_cancelled",
        "no_show",
        "disputed",
      ];
      for (const st of invalidStates) {
        const res = makeInitialConfirmedReservation();
        res.status = st;
        const noShowRes = markNoShowState(res);
        expect(noShowRes.success).toBe(false);
        expect(noShowRes.error).toContain(`Cannot mark no-show for reservation in '${st}' state`);
      }
    });
  });

  it("increments revision when verified review is attached", () => {
    const res1 = makeInitialConfirmedReservation();
    res1.status = "completed";
    res1.revision = 4;

    const reviewRes = attachVerifiedReview(res1, {
      rating: 5,
      scopeHonored: true,
      priceHonored: true,
      comment: "Top quality service",
      submittedAt: clock.now(),
    });
    expect(reviewRes.success).toBe(true);
    expect(reviewRes.reservation?.revision).toBe(5);
    expect(reviewRes.reservation?.verifiedReview?.rating).toBe(5);
  });
});
