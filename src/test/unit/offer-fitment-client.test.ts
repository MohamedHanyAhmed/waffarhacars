import { webcrypto } from "node:crypto";
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import OfferFitmentEditor from "@/components/staff/OfferFitmentEditor";
import { I18nProvider } from "@/context/I18nContext";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOfferFitmentCommand } from "@/components/staff/useOfferFitmentCommand";
import {
  OFFER_FITMENT_JOURNAL_KEY,
  clearOfferFitmentJournal,
  offerFitmentFingerprint,
  offerFitmentRequest,
  ownsOfferFitmentCallback,
  parseOfferFitmentJournal,
  readOfferFitmentJournal,
  validOfferFitmentReceipt,
  writeOfferFitmentJournal,
  type OfferFitmentJournal,
  type OfferFitmentReview,
} from "@/lib/fitment/offer-client";

const actorId = "10000000-0000-4000-8000-000000000001";
const offerId = "20000000-0000-4000-8000-000000000001";
const revisionId = "30000000-0000-4000-8000-000000000001";
const commandId = "40000000-0000-4000-8000-000000000001";
const otherId = "50000000-0000-4000-8000-000000000001";
const content = {
  mode: "BASE_VEHICLE_ALL_VARIANTS_VERIFIED" as const,
  evidenceRef: "CI:PRIVATE:FITMENT",
  coverage: [{ makeId: actorId, modelId: otherId, yearFrom: 2020, yearTo: 2024 }],
};
const journal: OfferFitmentJournal = {
  schema: 1,
  actorId,
  offerId,
  revisionId,
  commandId,
  expectedVersion: 2,
  fingerprint: "a".repeat(64),
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function receipt(id: string) {
  return { commandId: id, outcome: "APPLIED", resultVersion: 3 };
}
function transport(domain: (url: string, init: RequestInit) => unknown, currentActor = actorId) {
  const mocked = vi.fn((url: string, init?: RequestInit) =>
    url === "/api/v1/staff/auth/status"
      ? Promise.resolve(json({ state: "ACTIVE", userId: currentActor }))
      : domain(url, init ?? {})
  );
  vi.stubGlobal("fetch", mocked);
  return mocked;
}
const hookProps = () => ({
  actorId,
  offerId,
  revisionId,
  onRefresh: vi.fn(async () => true),
  onUnauthorized: vi.fn(),
});
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("offer fitment editor state and saved-scope review", () => {
  const saved: OfferFitmentReview = {
    offerId,
    revisionId,
    version: 2,
    mode: content.mode,
    evidenceRef: content.evidenceRef,
    coverage: content.coverage.map((row) => ({
      ...row,
      make: { id: row.makeId, nameEn: "Synthetic make", nameAr: "صانع اختباري", isActive: true },
      model: { id: row.modelId, nameEn: "Historical model", nameAr: "طراز سابق", isActive: false },
    })),
  };
  function props() {
    return {
      ...hookProps(),
      expectedVersion: 2,
      saved,
      editable: true,
      disabled: false,
      onStateChange: vi.fn(),
      onConflict: vi.fn(),
    };
  }
  function view(input: ReturnType<typeof props>) {
    return createElement(I18nProvider, null, createElement(OfferFitmentEditor, input));
  }
  function catalogAndMutation() {
    return transport((url, init) =>
      url.startsWith("/api/v1/vehicles/catalog")
        ? Promise.resolve(json({ items: [], nextCursor: null }))
        : Promise.resolve(json({ data: receipt(JSON.parse(String(init.body)).commandId) }))
    );
  }
  it("shows unavailable separately from unassessed and never defaults a mode", async () => {
    catalogAndMutation();
    const input = { ...props(), saved: { ...saved, mode: null, evidenceRef: null, coverage: [] } };
    const { rerender } = render(view(input));
    await waitFor(() => expect(screen.getByTestId("offer-fitment-mode")).toHaveValue(""));
    expect(screen.getByTestId("offer-fitment-saved")).toHaveTextContent("Not assessed");
    rerender(view({ ...input, saved: null } as unknown as ReturnType<typeof props>));
    expect(screen.getByTestId("offer-fitment-saved")).toHaveTextContent("has not loaded");
  });
  it("retains dirty input on a shared-version change until explicit discard", async () => {
    catalogAndMutation();
    const input = props();
    const { rerender } = render(view(input));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.change(screen.getByTestId("offer-fitment-evidence"), {
      target: { value: "CI:UNSAVED" },
    });
    rerender(
      view({
        ...input,
        expectedVersion: 3,
        saved: { ...saved, version: 3, evidenceRef: "CI:SERVER" },
      })
    );
    expect(screen.getByTestId("offer-fitment-evidence")).toHaveValue("CI:UNSAVED");
    expect(screen.getByTestId("offer-fitment-save")).toBeDisabled();
    await waitFor(() => expect(input.onConflict).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("offer-fitment-discard"));
    expect(screen.getByTestId("offer-fitment-evidence")).toHaveValue("CI:SERVER");
    expect(screen.queryByTestId("offer-fitment-conflict")).not.toBeInTheDocument();
  });
  it("does not report its own authoritative saved version as a dirty-edit conflict", async () => {
    catalogAndMutation();
    const refreshed = deferred<boolean>();
    const input = { ...props(), onRefresh: vi.fn(() => refreshed.promise) };
    const { rerender } = render(view(input));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.change(screen.getByTestId("offer-fitment-evidence"), {
      target: { value: "CI:SAVED" },
    });
    fireEvent.click(screen.getByTestId("offer-fitment-save"));
    await waitFor(() => expect(input.onRefresh).toHaveBeenCalledOnce());
    rerender(
      view({
        ...input,
        expectedVersion: 3,
        saved: { ...saved, version: 3, evidenceRef: "CI:SAVED" },
      })
    );
    expect(input.onConflict).not.toHaveBeenCalled();
    await act(async () => {
      refreshed.resolve(true);
    });
    await waitFor(() => expect(screen.getByTestId("offer-fitment-discard")).toBeDisabled());
    expect(input.onConflict).not.toHaveBeenCalled();
    expect(screen.getByTestId("offer-fitment-evidence")).toHaveValue("CI:SAVED");
  });
  it("keeps dirty input visible but frozen after external submission, with explicit discard available", async () => {
    catalogAndMutation();
    const input = props();
    const { rerender } = render(view(input));
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.change(screen.getByTestId("offer-fitment-evidence"), {
      target: { value: "CI:UNSAVED" },
    });
    rerender(
      view({
        ...input,
        editable: false,
        expectedVersion: 3,
        saved: { ...saved, version: 3, evidenceRef: "CI:FROZEN" },
      })
    );
    expect(screen.getByTestId("offer-fitment-evidence")).toHaveValue("CI:UNSAVED");
    expect(screen.getByTestId("offer-fitment-evidence")).toBeDisabled();
    expect(screen.getByTestId("offer-fitment-save")).toBeDisabled();
    expect(screen.getByTestId("offer-fitment-discard")).toBeEnabled();
    fireEvent.click(screen.getByTestId("offer-fitment-discard"));
    expect(screen.queryByTestId("offer-fitment-evidence")).not.toBeInTheDocument();
    expect(screen.getByTestId("offer-fitment-saved")).toHaveTextContent("CI:FROZEN");
  });
  it("renders historical inactive labels and current unavailability without broadening saved coverage", async () => {
    catalogAndMutation();
    render(
      view({
        ...props(),
        editable: false,
        saved: {
          ...saved,
          context: {
            providerStatus: "PAUSED",
            branchStatus: "ACTIVE",
            serviceIsActive: true,
            categoryIsActive: true,
          },
        },
      })
    );
    expect(screen.getByTestId("offer-fitment-saved-range")).toHaveTextContent("Historical model");
    expect(screen.getByTestId("offer-fitment-saved-range")).toHaveTextContent("Currently inactive");
    expect(
      screen.getByText(/provider, branch, service or category is currently unavailable/)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("offer-fitment-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("offer-fitment-mode")).not.toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
    });
  });
});

describe("offer fitment metadata and immutable intent", () => {
  it("rejects unknown fields, missing fields and malformed identities without hydrating private bodies", () => {
    for (const raw of [
      "",
      "null",
      "[]",
      "{",
      JSON.stringify({ ...journal, mode: content.mode }),
      JSON.stringify({ ...journal, evidenceRef: content.evidenceRef }),
      JSON.stringify({ ...journal, coverage: content.coverage }),
      JSON.stringify({ ...journal, expectedVersion: 0 }),
      JSON.stringify({ ...journal, offerId: "invalid" }),
      JSON.stringify({ ...journal, schema: 2 }),
      JSON.stringify({ ...journal, fingerprint: undefined }),
    ])
      expect(parseOfferFitmentJournal(raw)).toBeNull();
    expect(parseOfferFitmentJournal(JSON.stringify(journal))).toEqual(journal);
  });
  it("never stores evidence or ranges, and refuses overwriting or clearing another identity", () => {
    writeOfferFitmentJournal(journal);
    for (const patch of [
      { actorId: otherId },
      { offerId: otherId },
      { revisionId: otherId },
      { expectedVersion: 3 },
      { fingerprint: "b".repeat(64) },
      { commandId: otherId },
    ]) {
      expect(() => writeOfferFitmentJournal({ ...journal, ...patch })).toThrow();
      expect(clearOfferFitmentJournal({ ...journal, ...patch })).toBe(false);
    }
    const raw = sessionStorage.getItem(OFFER_FITMENT_JOURNAL_KEY)!;
    expect(raw).not.toContain(content.evidenceRef);
    expect(raw).not.toContain("coverage");
    expect(raw).not.toContain("mode");
    expect(clearOfferFitmentJournal(journal)).toBe(true);
  });
  it("refuses unavailable and silently lost storage writes", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("private detail");
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    expect(readOfferFitmentJournal(unavailable)).toEqual({ kind: "unavailable" });
    expect(() => writeOfferFitmentJournal(journal, unavailable)).toThrow();
    expect(unavailable.setItem).not.toHaveBeenCalled();
    expect(() =>
      writeOfferFitmentJournal(journal, {
        getItem: () => null,
        setItem: vi.fn(),
        removeItem: vi.fn(),
      })
    ).toThrow();
  });
  it("canonicalizes trimmed evidence and reordered ranges, but binds mode, actor, resource, key and CAS", async () => {
    const full = {
      ...content,
      coverage: [
        ...content.coverage,
        { makeId: actorId, modelId: otherId, yearFrom: 2010, yearTo: 2012 },
      ],
    };
    const body = offerFitmentRequest(journal, full);
    const hash = await offerFitmentFingerprint(journal, body);
    expect(
      await offerFitmentFingerprint(
        journal,
        offerFitmentRequest(journal, {
          ...full,
          evidenceRef: ` ${full.evidenceRef} `,
          coverage: [...full.coverage].reverse(),
        })
      )
    ).toBe(hash);
    for (const identity of [
      { ...journal, actorId: otherId },
      { ...journal, offerId: otherId },
      { ...journal, revisionId: otherId },
    ])
      expect(await offerFitmentFingerprint(identity, body)).not.toBe(hash);
    for (const changed of [
      { ...body, commandId: otherId },
      { ...body, expectedVersion: 3 },
      { ...body, mode: "SERVICE_VEHICLE_INDEPENDENT_WITHIN_LISTED_COVERAGE" as const },
      { ...body, evidenceRef: "CI:OTHER" },
    ])
      expect(await offerFitmentFingerprint(journal, changed)).not.toBe(hash);
    full.coverage[0].yearFrom = 1990;
    expect(body.coverage.some((row) => row.yearFrom === 1990)).toBe(false);
  });
  it("requires exact current actor/resource/generation/stored metadata for callbacks", () => {
    expect(
      ownsOfferFitmentCallback(journal, actorId, offerId, revisionId, 1, 1, {
        kind: "valid",
        journal,
      })
    ).toBe(true);
    expect(
      ownsOfferFitmentCallback(journal, otherId, offerId, revisionId, 1, 1, {
        kind: "valid",
        journal,
      })
    ).toBe(false);
    expect(
      ownsOfferFitmentCallback(journal, actorId, otherId, revisionId, 1, 1, {
        kind: "valid",
        journal,
      })
    ).toBe(false);
    expect(
      ownsOfferFitmentCallback(journal, actorId, offerId, otherId, 1, 1, { kind: "valid", journal })
    ).toBe(false);
    expect(
      ownsOfferFitmentCallback(journal, actorId, offerId, revisionId, 1, 2, {
        kind: "valid",
        journal,
      })
    ).toBe(false);
    expect(
      ownsOfferFitmentCallback(journal, actorId, offerId, revisionId, 1, 1, {
        kind: "valid",
        journal: { ...journal, expectedVersion: 3 },
      })
    ).toBe(false);
  });
  it("only accepts the exact historical command and one-step result version", () => {
    expect(validOfferFitmentReceipt(receipt(commandId), journal)).toBe(true);
    for (const value of [
      null,
      { ...receipt(commandId), commandId: otherId },
      { ...receipt(commandId), outcome: "REJECTED" },
      { ...receipt(commandId), resultVersion: 4 },
    ])
      expect(validOfferFitmentReceipt(value, journal)).toBe(false);
  });
});

describe("offer fitment hook with transport stubs (not real authentication proof)", () => {
  it("uses the data receipt envelope and refreshes authoritative state before clearing metadata", async () => {
    const refresh = deferred<boolean>();
    const props = { ...hookProps(), onRefresh: vi.fn(() => refresh.promise) };
    const fetchMock = transport((_url, init) => {
      const body = JSON.parse(String(init.body));
      return Promise.resolve(json({ data: receipt(body.commandId) }));
    });
    const { result } = renderHook(() => useOfferFitmentCommand(props));
    let done!: Promise<void>;
    act(() => {
      done = result.current.dispatch(2, content);
    });
    await waitFor(() => expect(props.onRefresh).toHaveBeenCalledOnce());
    expect(readOfferFitmentJournal().kind).toBe("valid");
    expect(result.current.pending).toBe(true);
    await act(async () => {
      refresh.resolve(true);
      await done;
    });
    expect(readOfferFitmentJournal().kind).toBe("empty");
    expect(result.current.receipt?.resultVersion).toBe(3);
    expect(
      fetchMock.mock.calls.filter(([url]) => url !== "/api/v1/staff/auth/status")
    ).toHaveLength(1);
  });
  it("storage refusal causes zero mutation dispatches", async () => {
    const fetchMock = transport(() => Promise.resolve(json(null)));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private raw detail");
    });
    const { result } = renderHook(() => useOfferFitmentCommand(hookProps()));
    await act(async () => {
      await result.current.dispatch(2, content);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe("offerFitment.storageUnavailable");
  });
  it("refuses hidden-editor dispatch when edit permission changes during hashing", async () => {
    const digest = deferred<ArrayBuffer>();
    let canDispatch = true;
    vi.stubGlobal("crypto", {
      randomUUID: () => commandId,
      subtle: { digest: () => digest.promise },
    });
    const fetchMock = transport(() => Promise.resolve(json(null)));
    const { result } = renderHook(() =>
      useOfferFitmentCommand({ ...hookProps(), canDispatch: () => canDispatch })
    );
    let done!: Promise<void>;
    act(() => {
      done = result.current.dispatch(2, content);
    });
    canDispatch = false;
    await act(async () => {
      digest.resolve(new ArrayBuffer(32));
      await done;
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readOfferFitmentJournal().kind).toBe("empty");
  });
  it("does not dispatch private content under a different active session", async () => {
    const domain = vi.fn();
    transport(domain, otherId);
    const props = hookProps();
    const { result } = renderHook(() => useOfferFitmentCommand(props));
    await act(async () => {
      await result.current.dispatch(2, content);
    });
    expect(domain).not.toHaveBeenCalled();
    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(readOfferFitmentJournal().kind).toBe("valid");
  });
  it("keeps ambiguous retry refusals unresolved while initial definitive refusals settle", async () => {
    let count = 0;
    transport((_url, init) => {
      if (init.method === "PUT") {
        count++;
        if (count === 1) throw new Error("lost response");
        return Promise.resolve(json({ error: "CONFLICT" }, 409));
      }
      return Promise.resolve(json({ error: "NOT_FOUND" }, 404));
    });
    const { result } = renderHook(() => useOfferFitmentCommand(hookProps()));
    await act(async () => {
      await result.current.dispatch(2, content);
    });
    const original = sessionStorage.getItem(OFFER_FITMENT_JOURNAL_KEY);
    await act(async () => {
      await result.current.recheck();
    });
    expect(result.current.retryAvailable).toBe(true);
    await act(async () => {
      await result.current.retry(content);
    });
    expect(sessionStorage.getItem(OFFER_FITMENT_JOURNAL_KEY)).toBe(original);
    cleanup();
    sessionStorage.clear();
    transport(() => Promise.resolve(json({ error: "CONFLICT" }, 409)));
    const second = renderHook(() => useOfferFitmentCommand(hookProps()));
    await act(async () => {
      await second.result.current.dispatch(2, content);
    });
    expect(readOfferFitmentJournal().kind).toBe("empty");
    expect(second.result.current.error).toBe("offerFitment.conflict");
  });
  it("missing receipt allows only exact re-entry with original key/CAS after reload", async () => {
    const originalBody = offerFitmentRequest(journal, content);
    const original = {
      ...journal,
      fingerprint: await offerFitmentFingerprint(journal, originalBody),
    };
    writeOfferFitmentJournal(original);
    const bodies: string[] = [];
    transport((_url, init) => {
      if (init.method === "PUT") {
        bodies.push(String(init.body));
        return Promise.resolve(json({ data: receipt(commandId) }));
      }
      return Promise.resolve(json({ error: "NOT_FOUND" }, 404));
    });
    const { result } = renderHook(() => useOfferFitmentCommand(hookProps()));
    await act(async () => {
      await Promise.resolve();
      await result.current.recheck();
    });
    await act(async () => {
      await result.current.retry({ ...content, evidenceRef: "CI:WRONG" });
    });
    expect(result.current.error).toBe("offerFitment.reconstructionMismatch");
    expect(bodies).toHaveLength(0);
    expect(result.current.needsContent).toBe(true);
    await act(async () => {
      await result.current.retry(content);
    });
    expect(bodies).toEqual([JSON.stringify(originalBody)]);
    expect(readOfferFitmentJournal().kind).toBe("empty");
  });
  it("retries a copied original body rather than later edits to caller-owned arrays", async () => {
    const bodies: string[] = [];
    let calls = 0;
    transport((_url, init) => {
      if (init.method === "PUT") {
        bodies.push(String(init.body));
        if (++calls === 1) throw new Error("lost");
        return Promise.resolve(json({ data: receipt(JSON.parse(String(init.body)).commandId) }));
      }
      return Promise.resolve(json({}, 404));
    });
    const mutable = { ...content, coverage: content.coverage.map((row) => ({ ...row })) };
    const { result } = renderHook(() => useOfferFitmentCommand(hookProps()));
    await act(async () => {
      await result.current.dispatch(2, mutable);
    });
    mutable.coverage[0].yearFrom = 1900;
    await act(async () => {
      await result.current.recheck();
    });
    await act(async () => {
      await result.current.retry(mutable);
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  });
  it("late mutation response cannot clear a newer command after actor/resource replacement", async () => {
    const response = deferred<Response>();
    const props = hookProps();
    const domain = vi.fn(() => response.promise);
    transport(domain);
    const { result, rerender } = renderHook((input) => useOfferFitmentCommand(input), {
      initialProps: props,
    });
    let done!: Promise<void>;
    act(() => {
      done = result.current.dispatch(2, content);
    });
    await waitFor(() => expect(domain).toHaveBeenCalledOnce());
    const original = readOfferFitmentJournal();
    expect(original.kind).toBe("valid");
    rerender({ ...props, actorId: otherId, revisionId: otherId });
    sessionStorage.removeItem(OFFER_FITMENT_JOURNAL_KEY);
    writeOfferFitmentJournal({
      ...journal,
      actorId: otherId,
      revisionId: otherId,
      commandId: otherId,
    });
    await act(async () => {
      response.resolve(
        json({ data: receipt(original.kind === "valid" ? original.journal.commandId : "") })
      );
      await done;
    });
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(readOfferFitmentJournal()).toEqual({
      kind: "valid",
      journal: { ...journal, actorId: otherId, revisionId: otherId, commandId: otherId },
    });
  });
  it("unverified refresh leaves historical receipt and journal unresolved", async () => {
    transport((_url, init) =>
      Promise.resolve(json({ data: receipt(JSON.parse(String(init.body)).commandId) }))
    );
    const { result } = renderHook(() =>
      useOfferFitmentCommand({ ...hookProps(), onRefresh: async () => false })
    );
    await act(async () => {
      await result.current.dispatch(2, content);
    });
    expect(result.current.receipt?.resultVersion).toBe(3);
    expect(result.current.locked).toBe(true);
    expect(readOfferFitmentJournal().kind).toBe("valid");
  });
});
