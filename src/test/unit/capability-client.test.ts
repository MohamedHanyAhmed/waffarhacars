import { webcrypto } from "node:crypto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCapabilityCommand } from "@/components/staff/useCapabilityCommand";
import {
  CAPABILITY_JOURNAL_KEY,
  capabilityRequest,
  capabilityRequestFingerprint,
  clearCapabilityJournal,
  ownsCapabilityCallback,
  parseCapabilityJournal,
  readCapabilityJournal,
  writeCapabilityJournal,
  type CapabilityJournal,
} from "@/lib/fitment/client";

const actorId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const policyId = "30000000-0000-4000-8000-000000000001";
const categoryId = "40000000-0000-4000-8000-000000000001";
const commandId = "50000000-0000-4000-8000-000000000001";
const otherId = "60000000-0000-4000-8000-000000000001";
const coverage = [{ makeId: actorId, modelId: policyId, yearFrom: 2020, yearTo: 2024 }];
const content = { evidenceRef: "CI:PRIVATE:EVIDENCE", coverage };
const journal: CapabilityJournal = {
  schema: 1,
  actorId,
  branchId,
  policyId,
  commandId,
  action: "EDIT",
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
function success(id: string, action: string, version = 3) {
  return new Response(
    JSON.stringify({
      command: {
        commandId: id,
        action,
        policyId,
        outcome: "APPLIED",
        resultVersion: version,
        recordedAt: "2026-10-16T00:00:00.000Z",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}
function installTransport(
  domain: (url: string, init: RequestInit) => unknown,
  currentActor = actorId
) {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url === "/api/v1/staff/auth/status"
      ? Promise.resolve(
          new Response(JSON.stringify({ state: "ACTIVE", userId: currentActor }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
      : domain(url, init ?? {})
  );
}

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

describe("capability command identity and private journal", () => {
  it("rejects malformed, oversized-schema and action-inconsistent journals without hydrating content", () => {
    for (const raw of [
      "",
      "null",
      "[]",
      "{",
      JSON.stringify({ ...journal, schema: 2 }),
      JSON.stringify({ ...journal, evidenceRef: content.evidenceRef }),
      JSON.stringify({ ...journal, coverage }),
      JSON.stringify({ ...journal, expectedVersion: 0 }),
      JSON.stringify({ ...journal, action: "CREATE" }),
      JSON.stringify({ ...journal, policyId: "invalid" }),
      JSON.stringify({ ...journal, reason: "private reason" }),
    ])
      expect(parseCapabilityJournal(raw)).toBeNull();
    expect(parseCapabilityJournal(JSON.stringify(journal))).toEqual(journal);
    expect(
      parseCapabilityJournal(
        JSON.stringify({
          schema: 1,
          actorId,
          branchId,
          commandId,
          action: "CREATE",
          categoryId,
          fingerprint: "b".repeat(64),
        })
      )
    ).not.toBeNull();
  });
  it("refuses writes over unresolved different actors or commands and never persists request bodies", () => {
    writeCapabilityJournal(journal);
    expect(() => writeCapabilityJournal({ ...journal, actorId: otherId })).toThrow();
    expect(() => writeCapabilityJournal({ ...journal, commandId: otherId })).toThrow();
    const raw = sessionStorage.getItem(CAPABILITY_JOURNAL_KEY)!;
    expect(raw).not.toContain(content.evidenceRef);
    expect(raw).not.toContain("coverage");
    expect(raw).not.toContain("reason");
    expect(clearCapabilityJournal(otherId, commandId)).toBe(false);
    expect(clearCapabilityJournal(actorId, otherId)).toBe(false);
    expect(readCapabilityJournal()).toEqual({ kind: "valid", journal });
    expect(clearCapabilityJournal(actorId, commandId)).toBe(true);
  });
  it("distinguishes unavailable storage from empty storage and refuses unrecorded writes", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("private raw detail");
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    expect(readCapabilityJournal(unavailable)).toEqual({ kind: "unavailable" });
    expect(() => writeCapabilityJournal(journal, unavailable)).toThrow();
    expect(unavailable.setItem).not.toHaveBeenCalled();
    const silentlyLost = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() };
    expect(() => writeCapabilityJournal(journal, silentlyLost)).toThrow();
  });
  it("canonicalizes exact reconstructed content and binds fingerprints to actor, action, branch, policy, key and version", async () => {
    const body = capabilityRequest(journal, content);
    const hash = await capabilityRequestFingerprint(journal, body);
    expect(
      await capabilityRequestFingerprint(
        journal,
        capabilityRequest(journal, { ...content, evidenceRef: ` ${content.evidenceRef} ` })
      )
    ).toBe(hash);
    for (const identity of [
      { ...journal, actorId: otherId },
      { ...journal, branchId: otherId },
      { ...journal, policyId: otherId },
      { ...journal, action: "REJECT" as const },
    ])
      expect(await capabilityRequestFingerprint(identity, body)).not.toBe(hash);
    for (const changed of [
      { ...body, commandId: otherId },
      { ...body, expectedVersion: 3 },
      { ...body, evidenceRef: "CI:CHANGED" },
      { ...body, coverage: [{ ...coverage[0], yearTo: 2023 }] },
    ])
      expect(await capabilityRequestFingerprint(journal, changed)).not.toBe(hash);
    const second = { ...coverage[0], modelId: otherId };
    expect(capabilityRequest(journal, { ...content, coverage: [second, ...coverage] })).toEqual(
      capabilityRequest(journal, { ...content, coverage: [...coverage, second] })
    );
  });
  it("rejects callbacks for replaced journals, actors, resources and generations", () => {
    const stored = { kind: "valid" as const, journal };
    expect(ownsCapabilityCallback(journal, actorId, branchId, 1, 1, stored)).toBe(true);
    expect(ownsCapabilityCallback(journal, otherId, branchId, 1, 1, stored)).toBe(false);
    expect(ownsCapabilityCallback(journal, actorId, otherId, 1, 1, stored)).toBe(false);
    expect(ownsCapabilityCallback(journal, actorId, branchId, 1, 2, stored)).toBe(false);
    expect(
      ownsCapabilityCallback(journal, actorId, branchId, 1, 1, {
        kind: "valid",
        journal: { ...journal, commandId: otherId },
      })
    ).toBe(false);
    expect(
      ownsCapabilityCallback(journal, actorId, branchId, 1, 1, {
        kind: "valid",
        journal: { ...journal, fingerprint: "b".repeat(64) },
      })
    ).toBe(false);
  });
});

describe("capability controller client transport recovery (unit isolation, no authentication claim)", () => {
  it("keeps the journal and command handlers locked through deferred read and explicit form hydration", async () => {
    const refresh = deferred<boolean>();
    const refreshed = vi.fn().mockReturnValue(refresh.promise);
    const fetcher = vi.fn((_: string, init: RequestInit) =>
      Promise.resolve(success(JSON.parse(String(init.body)).commandId, "EDIT"))
    );
    installTransport(fetcher);
    const { result } = renderHook(() =>
      useCapabilityCommand({ actorId, branchId, onRefresh: refreshed, onUnauthorized: vi.fn() })
    );
    let dispatched: Promise<void>;
    act(() => {
      dispatched = result.current.dispatch("EDIT", { policyId, expectedVersion: 2 }, content);
    });
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
    const original = readCapabilityJournal();
    expect(original.kind).toBe("valid");
    expect(result.current.pending).toBe(true);
    expect(result.current.locked).toBe(true);
    expect(result.current.awaitingHydration).toBeNull();
    await act(async () => {
      await result.current.dispatch("SUBMIT", { policyId, expectedVersion: 3 });
      await result.current.recheck();
      expect(await result.current.retry()).toBe(false);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      refresh.resolve(true);
      await dispatched!;
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.locked).toBe(true);
    expect(readCapabilityJournal()).toEqual(original);
    const ticket = result.current.awaitingHydration!;
    expect(ticket).toMatchObject({ actorId, branchId, policyId, resultVersion: 3 });
    await act(async () => {
      await result.current.dispatch("SUBMIT", { policyId, expectedVersion: 3 });
      expect(await result.current.retry()).toBe(false);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => {
      expect(
        result.current.acknowledgeHydration(ticket, { actorId, branchId, policyId, version: 3 })
      ).toBe(true);
    });
    expect(result.current.locked).toBe(false);
    expect(result.current.awaitingHydration).toBeNull();
    expect(readCapabilityJournal()).toEqual({ kind: "empty" });
  });
  it("rejects mismatched hydration identity, old version and forged token without clearing intent", async () => {
    writeCapabilityJournal(journal);
    installTransport(() => Promise.resolve(success(commandId, "EDIT")));
    const { result } = renderHook(() =>
      useCapabilityCommand({
        actorId,
        branchId,
        onRefresh: async () => true,
        onUnauthorized: vi.fn(),
      })
    );
    await act(async () => {
      await result.current.recheck();
    });
    const ticket = result.current.awaitingHydration!;
    const view = { actorId, branchId, policyId, version: 3 };
    for (const changed of [
      { ...view, actorId: otherId },
      { ...view, branchId: otherId },
      { ...view, policyId: otherId },
      { ...view, version: 2 },
      { ...view, version: Number.NaN },
      { ...view, version: 3.5 },
    ]) {
      act(() => {
        expect(result.current.acknowledgeHydration(ticket, changed)).toBe(false);
      });
      expect(result.current.locked).toBe(true);
      expect(readCapabilityJournal()).toEqual({ kind: "valid", journal });
    }
    act(() => {
      expect(
        result.current.acknowledgeHydration({ ...ticket, token: ticket.token + 1 }, view)
      ).toBe(false);
    });
    expect(readCapabilityJournal()).toEqual({ kind: "valid", journal });
    act(() => {
      expect(result.current.acknowledgeHydration(ticket, view)).toBe(true);
    });
  });
  it("requires a fresh read ticket after failed refresh and invalidates an older ticket on recheck", async () => {
    writeCapabilityJournal(journal);
    const nextRead = deferred<boolean>();
    const refreshed = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(nextRead.promise);
    installTransport(() => Promise.resolve(success(commandId, "EDIT")));
    const { result } = renderHook(() =>
      useCapabilityCommand({ actorId, branchId, onRefresh: refreshed, onUnauthorized: vi.fn() })
    );
    await act(async () => {
      await result.current.recheck();
    });
    expect(result.current.awaitingHydration).toBeNull();
    expect(result.current.locked).toBe(true);
    expect(readCapabilityJournal()).toEqual({ kind: "valid", journal });
    await act(async () => {
      await result.current.recheck();
    });
    const previous = result.current.awaitingHydration!;
    let checked: Promise<void>;
    act(() => {
      checked = result.current.recheck();
    });
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(3));
    const view = { actorId, branchId, policyId, version: 3 };
    expect(result.current.pending).toBe(true);
    expect(result.current.awaitingHydration).toBeNull();
    act(() => {
      expect(result.current.acknowledgeHydration(previous, view)).toBe(false);
    });
    expect(readCapabilityJournal()).toEqual({ kind: "valid", journal });
    await act(async () => {
      nextRead.resolve(true);
      await checked!;
    });
    const current = result.current.awaitingHydration!;
    expect(current.token).not.toBe(previous.token);
    act(() => {
      expect(result.current.acknowledgeHydration(previous, view)).toBe(false);
    });
    expect(readCapabilityJournal()).toEqual({ kind: "valid", journal });
    act(() => {
      expect(result.current.acknowledgeHydration(current, view)).toBe(true);
    });
  });
  it.each(["throws", "silently ignores"])(
    "retains the hydration lock if storage %s journal removal",
    async (failure) => {
      writeCapabilityJournal(journal);
      installTransport(() => Promise.resolve(success(commandId, "EDIT")));
      const { result } = renderHook(() =>
        useCapabilityCommand({
          actorId,
          branchId,
          onRefresh: async () => true,
          onUnauthorized: vi.fn(),
        })
      );
      await act(async () => {
        await result.current.recheck();
      });
      const removal = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        if (failure === "throws") throw new Error("storage denied");
      });
      const ticket = result.current.awaitingHydration!;
      act(() => {
        expect(
          result.current.acknowledgeHydration(ticket, {
            actorId,
            branchId,
            policyId,
            version: 3,
          })
        ).toBe(false);
      });
      expect(result.current.locked).toBe(true);
      expect(result.current.error).toBe("capabilities.storageUnavailable");
      expect(readCapabilityJournal()).toEqual({ kind: "valid", journal });
      removal.mockRestore();
      act(() => {
        expect(
          result.current.acknowledgeHydration(ticket, { actorId, branchId, policyId, version: 3 })
        ).toBe(true);
      });
      expect(readCapabilityJournal()).toEqual({ kind: "empty" });
      expect(result.current.locked).toBe(false);
    }
  );
  it("acknowledges a later current version without inferring activation from the historical receipt", async () => {
    writeCapabilityJournal({ ...journal, action: "APPROVE" });
    installTransport(() => Promise.resolve(success(commandId, "APPROVE")));
    const { result } = renderHook(() =>
      useCapabilityCommand({
        actorId,
        branchId,
        onRefresh: async () => true,
        onUnauthorized: vi.fn(),
      })
    );
    await act(async () => {
      await result.current.recheck();
    });
    expect(result.current.receipt).toMatchObject({ action: "APPROVE", resultVersion: 3 });
    // A current WITHDRAWN v4 can hydrate an APPROVE v3 receipt. The controller
    // exposes no domain status; the page must render that authoritative record.
    act(() => {
      expect(
        result.current.acknowledgeHydration(result.current.awaitingHydration!, {
          actorId,
          branchId,
          policyId,
          version: 4,
        })
      ).toBe(true);
    });
    expect(result.current.locked).toBe(false);
    expect(result.current.receipt?.resultVersion).toBe(3);
  });
  it("refuses an old hydration ticket after a newer command owns the journal", async () => {
    writeCapabilityJournal(journal);
    installTransport(() => Promise.resolve(success(commandId, "EDIT")));
    const { result } = renderHook(() =>
      useCapabilityCommand({
        actorId,
        branchId,
        onRefresh: async () => true,
        onUnauthorized: vi.fn(),
      })
    );
    await act(async () => {
      await result.current.recheck();
    });
    const ticket = result.current.awaitingHydration!;
    sessionStorage.removeItem(CAPABILITY_JOURNAL_KEY);
    const newer = { ...journal, commandId: otherId };
    writeCapabilityJournal(newer);
    act(() => {
      expect(
        result.current.acknowledgeHydration(ticket, { actorId, branchId, policyId, version: 3 })
      ).toBe(false);
    });
    expect(readCapabilityJournal()).toEqual({ kind: "valid", journal: newer });
    expect(result.current.locked).toBe(true);
  });
  it.each(["actor", "branch"])(
    "invalidates hydration ticket after %s scope change",
    async (changed) => {
      writeCapabilityJournal(journal);
      installTransport(() => Promise.resolve(success(commandId, "EDIT")));
      const { result, rerender } = renderHook(
        ({ actor, branch }) =>
          useCapabilityCommand({
            actorId: actor,
            branchId: branch,
            onRefresh: async () => true,
            onUnauthorized: vi.fn(),
          }),
        { initialProps: { actor: actorId, branch: branchId } }
      );
      await act(async () => {
        await result.current.recheck();
      });
      const ticket = result.current.awaitingHydration!;
      rerender({
        actor: changed === "actor" ? otherId : actorId,
        branch: changed === "branch" ? otherId : branchId,
      });
      act(() => {
        expect(
          result.current.acknowledgeHydration(ticket, { actorId, branchId, policyId, version: 3 })
        ).toBe(false);
      });
      expect(readCapabilityJournal()).toEqual({ kind: "valid", journal });
      await waitFor(() => expect(result.current.awaitingHydration).toBeNull());
      expect(result.current.locked).toBe(true);
      expect(result.current.otherOwner).toBe(true);
    }
  );
  it("ignores a queued authoritative refresh completion after unmount", async () => {
    writeCapabilityJournal(journal);
    const refresh = deferred<boolean>();
    const refreshed = vi.fn().mockReturnValue(refresh.promise);
    installTransport(() => Promise.resolve(success(commandId, "EDIT")));
    const { result, unmount } = renderHook(() =>
      useCapabilityCommand({ actorId, branchId, onRefresh: refreshed, onUnauthorized: vi.fn() })
    );
    let checked: Promise<void>;
    act(() => {
      checked = result.current.recheck();
    });
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      refresh.resolve(true);
      await checked!;
    });
    expect(readCapabilityJournal()).toEqual({ kind: "valid", journal });
  });
  it.each(["expired", "different-account"])(
    "ignores deferred %s authentication preflight after actor rerender",
    async (scenario) => {
      const authentication = deferred<Response>();
      const fetcher = vi.fn().mockReturnValue(authentication.promise);
      vi.stubGlobal("fetch", fetcher);
      const refreshed = vi.fn().mockResolvedValue(true);
      const unauthorized = vi.fn();
      const { result, rerender } = renderHook(
        ({ actor }) =>
          useCapabilityCommand({
            actorId: actor,
            branchId,
            onRefresh: refreshed,
            onUnauthorized: unauthorized,
          }),
        { initialProps: { actor: actorId } }
      );
      let dispatched: Promise<void>;
      act(() => {
        dispatched = result.current.dispatch("EDIT", { policyId, expectedVersion: 2 }, content);
      });
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      expect(fetcher.mock.calls[0][0]).toBe("/api/v1/staff/auth/status");
      const original = readCapabilityJournal();
      rerender({ actor: otherId });
      await act(async () => {
        // Deliberately resolve a queued response despite cancellation. The
        // callback ownership check, not transport behaviour, must protect state.
        authentication.resolve(
          new Response(
            JSON.stringify(
              scenario === "expired"
                ? { error: "UNAUTHORIZED" }
                : { state: "ACTIVE", userId: otherId }
            ),
            { status: scenario === "expired" ? 401 : 200 }
          )
        );
        await dispatched!;
      });
      expect(refreshed).not.toHaveBeenCalled();
      expect(unauthorized).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(readCapabilityJournal()).toEqual(original);
      expect(result.current.receipt).toBeNull();
      expect(result.current.error).toBeNull();
    }
  );
  it("ignores a refusal authentication callback when account changes during authoritative refresh", async () => {
    const refresh = deferred<boolean>();
    const refreshed = vi.fn().mockReturnValue(refresh.promise);
    const unauthorized = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), { status: 401 })
      );
    installTransport(fetcher);
    const { result, rerender } = renderHook(
      ({ actor }) =>
        useCapabilityCommand({
          actorId: actor,
          branchId,
          onRefresh: refreshed,
          onUnauthorized: unauthorized,
        }),
      { initialProps: { actor: actorId } }
    );
    let dispatched: Promise<void>;
    act(() => {
      dispatched = result.current.dispatch("EDIT", { policyId, expectedVersion: 2 }, content);
    });
    await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
    rerender({ actor: otherId });
    const newer = { ...journal, actorId: otherId, commandId: otherId };
    writeCapabilityJournal(newer);
    await act(async () => {
      refresh.resolve(true);
      await dispatched!;
    });
    expect(unauthorized).not.toHaveBeenCalled();
    expect(readCapabilityJournal()).toEqual({ kind: "valid", journal: newer });
  });
  it("refuses domain delivery after transport preflight observes another account, preserving original ownership", async () => {
    const fetcher = vi.fn();
    installTransport(fetcher, otherId);
    const refreshed = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useCapabilityCommand({ actorId, branchId, onRefresh: refreshed, onUnauthorized: vi.fn() })
    );
    await act(async () => {
      await result.current.dispatch("EDIT", { policyId, expectedVersion: 2 }, content);
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(refreshed).toHaveBeenCalledTimes(1);
    const stored = readCapabilityJournal();
    expect(stored.kind).toBe("valid");
    if (stored.kind === "valid") expect(stored.journal.actorId).toBe(actorId);
    expect(result.current.locked).toBe(true);
  });
  it("bounds hung mutation transport, retains unknown identity and permits receipt reconciliation", async () => {
    vi.useFakeTimers();
    const started = deferred<void>();
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
          started.resolve();
        })
    );
    installTransport(fetcher);
    const { result } = renderHook(() =>
      useCapabilityCommand({
        actorId,
        branchId,
        onRefresh: async () => true,
        onUnauthorized: vi.fn(),
      })
    );
    let dispatched: Promise<void>;
    await act(async () => {
      dispatched = result.current.dispatch("EDIT", { policyId, expectedVersion: 2 }, content);
      await started.promise;
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
      await dispatched!;
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe("capabilities.unknown");
    expect(result.current.locked).toBe(true);
    const pending = readCapabilityJournal();
    expect(pending.kind).toBe("valid");
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "COMMAND_NOT_FOUND" }), { status: 404 })
    );
    await act(async () => {
      await result.current.recheck();
    });
    expect(result.current.retryAvailable).toBe(true);
    expect(readCapabilityJournal()).toEqual(pending);
  });
  it("blocks mutation delivery when pending identity cannot be recorded", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    const fetcher = vi.fn();
    installTransport(fetcher);
    const { result } = renderHook(() =>
      useCapabilityCommand({
        actorId,
        branchId,
        onRefresh: async () => true,
        onUnauthorized: vi.fn(),
      })
    );
    await act(async () => {
      await result.current.dispatch("EDIT", { policyId, expectedVersion: 2 }, content);
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.error).toBe("capabilities.storageUnavailable");
  });
  it("retains unknown command identity, reconciles missing receipt and retries the identical frozen request", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("connection lost"));
    installTransport(fetcher);
    const refreshed = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useCapabilityCommand({ actorId, branchId, onRefresh: refreshed, onUnauthorized: vi.fn() })
    );
    await act(async () => {
      await result.current.dispatch("EDIT", { policyId, expectedVersion: 2 }, content);
    });
    expect(result.current.locked).toBe(true);
    expect(result.current.error).toBe("capabilities.unknown");
    const original = JSON.parse(fetcher.mock.calls[0][1].body);
    const pending = readCapabilityJournal();
    expect(pending.kind).toBe("valid");
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "COMMAND_NOT_FOUND" }), { status: 404 })
    );
    await act(async () => {
      await result.current.recheck();
    });
    expect(result.current.retryAvailable).toBe(true);
    expect(readCapabilityJournal()).toEqual(pending);
    fetcher.mockResolvedValueOnce(success(original.commandId, "EDIT"));
    await act(async () => {
      await result.current.retry();
    });
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual(original);
    expect(result.current.locked).toBe(true);
    expect(readCapabilityJournal()).toEqual(pending);
    act(() => {
      expect(
        result.current.acknowledgeHydration(result.current.awaitingHydration!, {
          actorId,
          branchId,
          policyId,
          version: 3,
        })
      ).toBe(true);
    });
    expect(readCapabilityJournal()).toEqual({ kind: "empty" });
    expect(refreshed).toHaveBeenCalledTimes(1);
  });
  it("requires matching content after reload and keeps missing-receipt intent on a mismatched re-entry", async () => {
    const fingerprint = await capabilityRequestFingerprint(
      journal,
      capabilityRequest(journal, content)
    );
    writeCapabilityJournal({ ...journal, fingerprint });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "COMMAND_NOT_FOUND" }), { status: 404 })
      );
    installTransport(fetcher);
    const { result } = renderHook(() =>
      useCapabilityCommand({
        actorId,
        branchId,
        onRefresh: async () => true,
        onUnauthorized: vi.fn(),
      })
    );
    await act(async () => {
      await result.current.recheck();
    });
    expect(result.current.needsContent).toBe(true);
    await act(async () => {
      expect(await result.current.retry({ ...content, evidenceRef: "CI:OTHER" })).toBe(false);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("capabilities.reconstructionMismatch");
    expect(readCapabilityJournal()).toEqual({
      kind: "valid",
      journal: { ...journal, fingerprint },
    });
    fetcher.mockResolvedValueOnce(success(commandId, "EDIT"));
    await act(async () => {
      await result.current.retry(content);
    });
    expect(result.current.locked).toBe(true);
    act(() => {
      expect(
        result.current.acknowledgeHydration(result.current.awaitingHydration!, {
          actorId,
          branchId,
          policyId,
          version: 3,
        })
      ).toBe(true);
    });
    expect(readCapabilityJournal()).toEqual({ kind: "empty" });
  });
  it("does not clear a newer journal when an old response resolves after account change", async () => {
    const transport = deferred<Response>();
    const fetcher = vi.fn().mockReturnValue(transport.promise);
    installTransport(fetcher);
    const refreshed = vi.fn().mockResolvedValue(true);
    const { result, rerender } = renderHook(
      ({ actor }) =>
        useCapabilityCommand({
          actorId: actor,
          branchId,
          onRefresh: refreshed,
          onUnauthorized: vi.fn(),
        }),
      { initialProps: { actor: actorId } }
    );
    let dispatched: Promise<void>;
    act(() => {
      dispatched = result.current.dispatch("EDIT", { policyId, expectedVersion: 2 }, content);
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const original = JSON.parse(fetcher.mock.calls[0][1].body);
    rerender({ actor: otherId });
    sessionStorage.removeItem(CAPABILITY_JOURNAL_KEY);
    const newer = { ...journal, actorId: otherId, commandId: otherId };
    writeCapabilityJournal(newer);
    await act(async () => {
      transport.resolve(success(original.commandId, "EDIT"));
      await dispatched!;
    });
    expect(refreshed).not.toHaveBeenCalled();
    expect(readCapabilityJournal()).toEqual({ kind: "valid", journal: newer });
    expect(result.current.receipt).toBeNull();
  });
});
