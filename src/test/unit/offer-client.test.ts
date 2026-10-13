import { describe, expect, it } from "vitest";
import {
  cairoInputToUtc,
  clearPendingOfferOperation,
  clearPendingCatalogOperation,
  clearPendingPublicationOperation,
  editReconciliationAdvanced,
  egpToMinor,
  minorToEgp,
  offerDiscountBps,
  ownsPendingOfferCallback,
  ownsPendingCatalogCallback,
  ownsPendingPublicationCallback,
  readPendingOfferOperation,
  readPendingCatalogOperation,
  readPendingPublicationOperation,
  utcToCairoInput,
  writePendingOfferOperation,
  writePendingCatalogOperation,
  writePendingPublicationOperation,
} from "@/lib/offer/client";

describe("staff offer client-safe money and Cairo time helpers", () => {
  it("converts decimal EGP exactly and preserves explicit zero commission independently", () => {
    expect(egpToMinor("0")).toBe("0");
    expect(egpToMinor("1234.5")).toBe("123450");
    expect(minorToEgp("123450")).toBe("1234.50");
    expect(egpToMinor("9999999999999999.99")).toBe("999999999999999999");
    expect(egpToMinor("10000000000000000")).toBeNull();
    expect(offerDiscountBps("100000", "80000")).toBe("2000");
  });

  it("rejects invalid monetary precision and non-decimal input", () => {
    for (const value of ["", "1.234", "1e3", "-1", ".50", "1,000", "01.00"]) {
      expect(egpToMinor(value)).toBeNull();
    }
  });

  it("round-trips Cairo local time without assuming a fixed UTC offset", () => {
    for (const instant of ["2026-01-15T10:30:00.000Z", "2026-07-15T10:30:00.000Z"]) {
      const cairo = utcToCairoInput(instant);
      expect(cairoInputToUtc(cairo)).toBe(instant);
    }
  });

  it("rejects invalid, skipped, and repeated Cairo clock times at DST boundaries", () => {
    expect(cairoInputToUtc("2026-02-31T12:00")).toBeNull();
    // Egypt advances at the last Friday in April and reverses at the last Thursday in October.
    expect(cairoInputToUtc("2026-04-24T00:30")).toBeNull();
    expect(cairoInputToUtc("2026-10-29T23:30")).toBeNull();
  });

  it("retains only request identity and unresolved status in the tab journal", () => {
    const operation = {
      operationId: "operation-1",
      kind: "create" as const,
      creationRequestId: "creation-1",
      revisionRequestId: "revision-1",
      unresolved: true as const,
    };
    writePendingOfferOperation(operation);
    expect(readPendingOfferOperation()).toEqual(operation);
    const stored = sessionStorage.getItem("waffarhacars_offer_pending_v1");
    expect(stored).not.toContain("normalPriceMinor");
    expect(stored).not.toContain("evidencePacketId");
    expect(clearPendingOfferOperation(operation.operationId)).toBe(true);
    expect(readPendingOfferOperation()).toBeNull();
  });

  it("keeps unresolved A when unrelated B is inspected or an old callback tries to clear it", () => {
    const operation = {
      operationId: "operation-A",
      kind: "edit" as const,
      offerId: "offer-A",
      revisionId: "revision-A",
      expectedVersion: 1,
      unresolved: true as const,
    };
    writePendingOfferOperation(operation);
    expect(editReconciliationAdvanced(operation, "offer-B", "revision-B", 5)).toBe(false);
    expect(clearPendingOfferOperation("operation-B")).toBe(false);
    expect(() =>
      writePendingOfferOperation({ ...operation, operationId: "operation-B", offerId: "offer-B" })
    ).toThrow();
    expect(readPendingOfferOperation()).toEqual(operation);
    expect(clearPendingOfferOperation(operation.operationId)).toBe(true);
  });

  it("uses the original expected version after reload without claiming which values won", () => {
    const operation = {
      operationId: "edit-1",
      kind: "edit" as const,
      offerId: "offer-A",
      revisionId: "revision-A",
      expectedVersion: 1,
      unresolved: true as const,
    };
    writePendingOfferOperation(operation);
    const restored = readPendingOfferOperation()!;
    expect(editReconciliationAdvanced(restored, "offer-A", "revision-A", 1)).toBe(false);
    expect(editReconciliationAdvanced(restored, "offer-A", "revision-A", 2)).toBe(true);
    expect(editReconciliationAdvanced(restored, "offer-B", "revision-A", 2)).toBe(false);
    expect(clearPendingOfferOperation(restored.operationId)).toBe(true);
  });

  it("catalog callbacks cannot replace or clear another pending operation", () => {
    const operation = { operationId: "catalog-A", code: "SERVICE_A" };
    writePendingCatalogOperation(operation);
    expect(clearPendingCatalogOperation("catalog-B")).toBe(false);
    expect(() =>
      writePendingCatalogOperation({ operationId: "catalog-B", code: "SERVICE_B" })
    ).toThrow();
    expect(readPendingCatalogOperation()).toEqual(operation);
    expect(clearPendingCatalogOperation(operation.operationId)).toBe(true);
  });

  it("a deferred offer callback for settled A cannot clear B or act after a route generation change", async () => {
    const a = {
      operationId: "A",
      kind: "edit" as const,
      offerId: "offer-A",
      revisionId: "revision-A",
      expectedVersion: 1,
      unresolved: true as const,
    };
    const b = { ...a, operationId: "B", offerId: "offer-B", revisionId: "revision-B" };
    writePendingOfferOperation(a);
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    let staleCallbackActed = false;
    const lateA = response.then(() => {
      if (ownsPendingOfferCallback(a.operationId, 1, 2)) {
        staleCallbackActed = true;
        clearPendingOfferOperation(a.operationId);
      }
    });
    expect(clearPendingOfferOperation(a.operationId)).toBe(true);
    writePendingOfferOperation(b);
    release();
    await lateA;
    expect(staleCallbackActed).toBe(false);
    expect(readPendingOfferOperation()).toEqual(b);
    expect(ownsPendingOfferCallback(b.operationId, 2, 2)).toBe(true);
    expect(clearPendingOfferOperation(b.operationId)).toBe(true);
  });

  it("a deferred catalog callback cannot clear a newer catalog intent", async () => {
    writePendingCatalogOperation({ operationId: "A", code: "SERVICE_A" });
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lateA = response.then(() => {
      if (ownsPendingCatalogCallback("A", 1, 1)) clearPendingCatalogOperation("A");
    });
    expect(clearPendingCatalogOperation("A")).toBe(true);
    writePendingCatalogOperation({ operationId: "B", code: "SERVICE_B" });
    release();
    await lateA;
    expect(readPendingCatalogOperation()?.operationId).toBe("B");
    expect(clearPendingCatalogOperation("B")).toBe(true);
  });

  it("publication journal preserves unresolved A when another offer B is inspected", () => {
    const a = {
      commandId: "command-A",
      offerId: "offer-A",
      actorUserId: "operator-A",
      action: "PUBLISH" as const,
      revisionId: "revision-A",
      expectedVersion: 0,
    };
    writePendingPublicationOperation(a);
    expect(readPendingPublicationOperation()).toEqual(a);
    expect(clearPendingPublicationOperation("command-B")).toBe(false);
    expect(() =>
      writePendingPublicationOperation({
        ...a,
        commandId: "command-B",
        offerId: "offer-B",
        revisionId: "revision-B",
      })
    ).toThrow();
    const stored = sessionStorage.getItem("waffarhacars_publication_pending_v1");
    expect(stored).not.toContain("normalPriceMinor");
    expect(stored).not.toContain("evidencePacketId");
    expect(readPendingPublicationOperation()?.actorUserId).toBe("operator-A");
    expect(readPendingPublicationOperation()).toEqual(a);
    expect(clearPendingPublicationOperation(a.commandId)).toBe(true);
  });

  it("a deferred publication response A cannot clear B or act after route generation changes", async () => {
    const a = {
      commandId: "command-A",
      offerId: "offer-A",
      actorUserId: "operator-A",
      action: "PUBLISH" as const,
      revisionId: "revision-A",
      expectedVersion: 0,
    };
    const b = {
      commandId: "command-B",
      offerId: "offer-B",
      actorUserId: "operator-B",
      action: "UNPUBLISH" as const,
      expectedVersion: 2,
    };
    writePendingPublicationOperation(a);
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    let staleCallbackActed = false;
    const lateA = response.then(() => {
      if (ownsPendingPublicationCallback(a.commandId, 1, 2)) {
        staleCallbackActed = true;
        clearPendingPublicationOperation(a.commandId);
      }
    });
    expect(clearPendingPublicationOperation(a.commandId)).toBe(true);
    writePendingPublicationOperation(b);
    release();
    await lateA;
    expect(staleCallbackActed).toBe(false);
    expect(ownsPendingPublicationCallback(a.commandId, 1, 1)).toBe(false);
    expect(readPendingPublicationOperation()).toEqual(b);
    expect(ownsPendingPublicationCallback(b.commandId, 2, 2)).toBe(true);
    expect(clearPendingPublicationOperation(b.commandId)).toBe(true);
  });
});
