import { describe, it, expect } from "vitest";
import { LocalDemoRepository } from "../../domain/localRepository";
import { StaticClock } from "../../domain/clock";
import { DeterministicIdGenerator } from "../../domain/idGenerator";

describe("Demo Scenario Lifecycle & State Restoration", () => {
  const clock = new StaticClock("2026-09-13T12:00:00.000Z");

  it("1. ensures a first-time visitor receives clean_empty state with null reservation and zero accruals", async () => {
    const idGen = new DeterministicIdGenerator();
    const repo = new LocalDemoRepository(clock, idGen);

    expect(repo.getScenario()).toBe("clean_empty");
    const activeRes = await repo.getActiveReservation();
    expect(activeRes).toBeNull();

    const accruals = await repo.getAccruals();
    expect(accruals).toEqual([]);

    const stmt = await repo.getProviderStatement("prov-orbit-care");
    expect(stmt.completedReservationsCount).toBe(0);
    expect(stmt.totalCommissionAccrued.amountMinor).toBe(0);
  });

  it("2. ensures scenario selection updates repository state deterministically", async () => {
    const idGen = new DeterministicIdGenerator();
    const repo = new LocalDemoRepository(clock, idGen);

    // Select confirmed scenario
    await repo.selectScenario("confirmed");
    expect(repo.getScenario()).toBe("confirmed");
    const res = await repo.getActiveReservation();
    expect(res).not.toBeNull();
    expect(res?.status).toBe("confirmed");
    expect(res?.passCode).toBe("WC-7492");
    expect(res?.completionPinDetails).toBeNull(); // Not issued yet

    // Select already_completed scenario
    await repo.selectScenario("already_completed");
    expect(repo.getScenario()).toBe("already_completed");
    const completedRes = await repo.getActiveReservation();
    expect(completedRes?.status).toBe("completed");
    const accruals = await repo.getAccruals();
    expect(accruals.length).toBe(1);
    expect(accruals[0].commissionAmount.amountMinor).toBe(9600); // EGP 96
  });

  it("3. ensures persisted state correctly restores across simulated reload", async () => {
    const idGen = new DeterministicIdGenerator();
    const repo1 = new LocalDemoRepository(clock, idGen);

    await repo1.selectScenario("checked_in_valid_pin");
    const state1 = repo1.getSerializableState();
    expect(state1.scenario).toBe("checked_in_valid_pin");
    expect(state1.reservation?.status).toBe("checked_in");

    // Simulate reload by creating a new repository with serialized state
    const idGen2 = new DeterministicIdGenerator();
    const repo2 = new LocalDemoRepository(clock, idGen2, state1);
    expect(repo2.getScenario()).toBe("checked_in_valid_pin");
    const restoredRes = await repo2.getActiveReservation();
    expect(restoredRes).not.toBeNull();
    expect(restoredRes?.status).toBe("checked_in");
    expect(restoredRes?.passCode).toBe(state1.reservation?.passCode);
  });

  it("4. ensures resetDemo returns repository to clean empty state", async () => {
    const idGen = new DeterministicIdGenerator();
    const repo = new LocalDemoRepository(clock, idGen);

    // Change to confirmed
    await repo.selectScenario("confirmed");
    expect(await repo.getActiveReservation()).not.toBeNull();

    // Reset demo
    await repo.resetDemo();
    expect(repo.getScenario()).toBe("clean_empty");
    expect(await repo.getActiveReservation()).toBeNull();
    expect(await repo.getAccruals()).toEqual([]);
  });
});
