"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { offerApi } from "@/lib/offer/client-api";
import {
  capabilityCommandPath,
  capabilityRequest,
  capabilityRequestFingerprint,
  clearCapabilityJournal,
  ownsCapabilityCallback,
  readCapabilityJournal,
  writeCapabilityJournal,
  type CapabilityAction,
  type CapabilityCoverage,
  type CapabilityJournal,
  type CapabilityReceipt,
  type CapabilityRequest,
} from "@/lib/fitment/client";

type Content = { evidenceRef?: string; coverage?: CapabilityCoverage[]; reason?: string };
const contentActions: CapabilityAction[] = ["CREATE", "EDIT", "REJECT"];
function errorKey(status: number) {
  if (status === 401) return "capabilities.authentication";
  if (status === 403) return "capabilities.denied";
  if (status === 404) return "capabilities.missing";
  if (status === 409) return "capabilities.conflict";
  if (status === 400 || status === 422) return "capabilities.invalid";
  return "capabilities.unknown";
}
function validReceipt(value: unknown, j: CapabilityJournal): value is CapabilityReceipt {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<CapabilityReceipt>;
  return (
    r.commandId === j.commandId &&
    r.action === j.action &&
    r.outcome === "APPLIED" &&
    typeof r.policyId === "string" &&
    /^[0-9a-f-]{36}$/i.test(r.policyId) &&
    (j.policyId === undefined || r.policyId === j.policyId) &&
    Number.isInteger(r.resultVersion) &&
    Number(r.resultVersion) > 0
  );
}

/** One capability command at a time; the journal contains no review content. */
export function useCapabilityCommand({
  actorId,
  branchId,
  onRefresh,
  onUnauthorized,
}: {
  actorId: string | undefined;
  branchId: string;
  onRefresh: () => Promise<boolean>;
  onUnauthorized: () => void;
}) {
  const [stored, setStored] = useState(readCapabilityJournal);
  const [pending, setPending] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [hasFrozenBody, setHasFrozenBody] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<CapabilityReceipt | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const memory = useRef<{ commandId: string; body: CapabilityRequest } | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const scope = useRef({ actorId, branchId });
  useLayoutEffect(() => {
    generation.current += 1;
    scope.current = { actorId, branchId };
    memory.current = null;
    inFlight.current = false;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setStored(readCapabilityJournal());
      setPending(false);
      setHasFrozenBody(false);
      setRetryAvailable(false);
      setReceipt(null);
      setError(null);
    });
    const pendingControllers = controllers.current;
    return () => {
      active = false;
      generation.current += 1;
      for (const controller of pendingControllers) controller.abort();
      pendingControllers.clear();
    };
  }, [actorId, branchId]);

  const boundedApi = async <T>(url: string, init?: RequestInit) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    const deadline = setTimeout(() => controller.abort(), 12_000);
    try {
      return await offerApi<T>(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(deadline);
      controllers.current.delete(controller);
    }
  };
  const scopeMatches = (j: CapabilityJournal, dispatched: number) =>
    scope.current.actorId === j.actorId &&
    scope.current.branchId === j.branchId &&
    dispatched === generation.current;
  const verifyActor = async (j: CapabilityJournal, dispatched: number) => {
    const response = await boundedApi<{ state: string; userId?: string }>(
      "/api/v1/staff/auth/status"
    );
    if (!scopeMatches(j, dispatched)) throw new Error("Staff scope changed");
    if (!response.ok) {
      if (response.status === 401) onUnauthorized();
      throw new Error("Staff identity unavailable");
    }
    if (response.data.state !== "ACTIVE" || response.data.userId !== j.actorId) {
      await onRefresh();
      throw new Error("Original staff identity required");
    }
  };

  const owns = (j: CapabilityJournal, dispatched: number) =>
    ownsCapabilityCallback(
      j,
      scope.current.actorId,
      scope.current.branchId,
      dispatched,
      generation.current,
      readCapabilityJournal()
    );
  const settle = async (j: CapabilityJournal, result: CapabilityReceipt, dispatched: number) => {
    if (!owns(j, dispatched)) return;
    setReceipt(result);
    // Receipt is historical evidence. Current activation comes only from the
    // subsequent authoritative workspace read, never from the receipt action.
    if (!(await onRefresh()) || !owns(j, dispatched)) return;
    if (!clearCapabilityJournal(j.actorId, j.commandId)) {
      setError("capabilities.storageUnavailable");
      setStored(readCapabilityJournal());
      return;
    }
    memory.current = null;
    setHasFrozenBody(false);
    setStored(readCapabilityJournal());
    setRetryAvailable(false);
    setError(null);
  };
  const post = async (j: CapabilityJournal, body: CapabilityRequest, recovery: boolean) => {
    if (inFlight.current) return;
    const dispatched = generation.current;
    inFlight.current = true;
    setPending(true);
    setRetryAvailable(false);
    setError(null);
    try {
      await verifyActor(j, dispatched);
      if (!owns(j, dispatched)) return;
      const response = await boundedApi<{ command: CapabilityReceipt; replayed: boolean }>(
        capabilityCommandPath(j),
        {
          method: j.action === "EDIT" ? "PUT" : "POST",
          body: JSON.stringify(body),
        }
      );
      if (!owns(j, dispatched)) return;
      if (response.ok) {
        if (!validReceipt(response.data.command, j)) {
          setError("capabilities.unknown");
          return;
        }
        await settle(j, response.data.command, dispatched);
      } else if (!recovery && [400, 401, 403, 404, 409, 422].includes(response.status)) {
        // A first definitive refusal has no earlier ambiguous attempt. On a
        // recovery retry, the same error does not settle the original command.
        if (!clearCapabilityJournal(j.actorId, j.commandId)) {
          setError("capabilities.storageUnavailable");
          setStored(readCapabilityJournal());
          return;
        }
        memory.current = null;
        setHasFrozenBody(false);
        setStored(readCapabilityJournal());
        setError(errorKey(response.status));
        await onRefresh();
        if (response.status === 401 && scopeMatches(j, dispatched)) onUnauthorized();
      } else {
        setError(errorKey(response.status));
        if (response.status === 401) onUnauthorized();
      }
    } catch {
      if (owns(j, dispatched)) setError("capabilities.unknown");
    } finally {
      if (dispatched === generation.current) {
        inFlight.current = false;
        setPending(false);
        setStored(readCapabilityJournal());
      }
    }
  };

  const dispatch = async (
    action: CapabilityAction,
    identity: { policyId?: string; categoryId?: string; expectedVersion?: number },
    content?: Content
  ) => {
    if (!actorId || inFlight.current) return;
    const existing = readCapabilityJournal();
    if (existing.kind !== "empty") {
      setStored(existing);
      setError("capabilities.unresolved");
      return;
    }
    const dispatched = generation.current;
    inFlight.current = true;
    setPending(true);
    setReceipt(null);
    try {
      const base = {
        schema: 1 as const,
        actorId,
        branchId,
        commandId: crypto.randomUUID(),
        action,
        ...identity,
      };
      const body = capabilityRequest(base, content);
      const fingerprint = await capabilityRequestFingerprint(base, body);
      if (
        dispatched !== generation.current ||
        scope.current.actorId !== actorId ||
        scope.current.branchId !== branchId
      )
        return;
      const j: CapabilityJournal = { ...base, fingerprint };
      writeCapabilityJournal(j);
      memory.current = { commandId: j.commandId, body };
      setHasFrozenBody(true);
      setStored({ kind: "valid", journal: j });
      inFlight.current = false;
      await post(j, body, false);
    } catch {
      if (dispatched === generation.current) {
        setStored(readCapabilityJournal());
        setError("capabilities.storageUnavailable");
      }
    } finally {
      if (dispatched === generation.current) {
        inFlight.current = false;
        setPending(false);
      }
    }
  };

  const recheck = async () => {
    if (inFlight.current) return;
    const state = readCapabilityJournal();
    setStored(state);
    if (
      state.kind !== "valid" ||
      state.journal.actorId !== actorId ||
      state.journal.branchId !== branchId
    )
      return;
    const j = state.journal;
    const dispatched = generation.current;
    inFlight.current = true;
    setPending(true);
    setRetryAvailable(false);
    setError(null);
    try {
      await verifyActor(j, dispatched);
      if (!owns(j, dispatched)) return;
      const response = await boundedApi<{ command: CapabilityReceipt }>(
        `/api/v1/staff/branches/${branchId}/fitment-policies/commands/${j.commandId}`
      );
      if (!owns(j, dispatched)) return;
      if (response.ok && validReceipt(response.data.command, j))
        await settle(j, response.data.command, dispatched);
      else {
        setRetryAvailable(!response.ok && response.status === 404);
        setError(
          !response.ok && response.status === 404
            ? "capabilities.noReceipt"
            : "capabilities.unknown"
        );
        if (!response.ok && response.status === 401) onUnauthorized();
      }
    } catch {
      if (owns(j, dispatched)) setError("capabilities.unknown");
    } finally {
      if (dispatched === generation.current) {
        inFlight.current = false;
        setPending(false);
        setStored(readCapabilityJournal());
      }
    }
  };
  const retry = async (content?: Content): Promise<boolean> => {
    if (inFlight.current || !retryAvailable) return false;
    const state = readCapabilityJournal();
    if (
      state.kind !== "valid" ||
      state.journal.actorId !== actorId ||
      state.journal.branchId !== branchId
    )
      return false;
    const j = state.journal;
    const dispatched = generation.current;
    const body =
      memory.current?.commandId === j.commandId
        ? memory.current.body
        : capabilityRequest(j, content);
    try {
      if ((await capabilityRequestFingerprint(j, body)) !== j.fingerprint) {
        setError("capabilities.reconstructionMismatch");
        return false;
      }
      if (!owns(j, dispatched)) return false;
      writeCapabilityJournal(j);
      memory.current = { commandId: j.commandId, body };
      setHasFrozenBody(true);
      await post(j, body, true);
      return true;
    } catch {
      if (owns(j, dispatched)) setError("capabilities.storageUnavailable");
      return false;
    }
  };
  const journal =
    stored.kind === "valid" &&
    stored.journal.actorId === actorId &&
    stored.journal.branchId === branchId
      ? stored.journal
      : null;
  return {
    dispatch,
    recheck,
    retry,
    pending,
    journal,
    retryAvailable,
    receipt,
    error,
    locked: pending || stored.kind !== "empty",
    unavailable: stored.kind === "invalid" || stored.kind === "unavailable",
    otherOwner: stored.kind === "valid" && !journal,
    needsContent: Boolean(journal && contentActions.includes(journal.action) && !hasFrozenBody),
  };
}
