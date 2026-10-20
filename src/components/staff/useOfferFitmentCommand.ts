"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { offerApi } from "@/lib/offer/client-api";
import {
  clearOfferFitmentJournal,
  offerFitmentFingerprint,
  offerFitmentPath,
  offerFitmentRequest,
  ownsOfferFitmentCallback,
  readOfferFitmentJournal,
  validOfferFitmentReceipt,
  writeOfferFitmentJournal,
  type OfferFitmentContent,
  type OfferFitmentJournal,
  type OfferFitmentReceipt,
  type OfferFitmentRequest,
} from "@/lib/fitment/offer-client";

function errorKey(status: number) {
  if (status === 401) return "offerFitment.authentication";
  if (status === 403) return "offerFitment.denied";
  if (status === 404) return "offerFitment.missing";
  if (status === 409) return "offerFitment.conflict";
  if (status === 400 || status === 422) return "offerFitment.invalid";
  return "offerFitment.unknown";
}

/** One immutable intent. Only the actor-bound receipt plus an authoritative read settles it. */
export function useOfferFitmentCommand({
  actorId,
  offerId,
  revisionId,
  onRefresh,
  onUnauthorized,
  canDispatch,
}: {
  actorId: string | undefined;
  offerId: string;
  revisionId: string;
  onRefresh: () => Promise<boolean>;
  onUnauthorized: () => void;
  canDispatch?: () => boolean;
}) {
  const [stored, setStored] = useState(readOfferFitmentJournal);
  const [pending, setPending] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [hasFrozenBody, setHasFrozenBody] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OfferFitmentReceipt | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const memory = useRef<{ commandId: string; body: OfferFitmentRequest } | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const scope = useRef({ actorId, offerId, revisionId });
  const callbacks = useRef({ onRefresh, onUnauthorized, canDispatch });
  useLayoutEffect(() => {
    callbacks.current = { onRefresh, onUnauthorized, canDispatch };
  });
  useLayoutEffect(() => {
    const requestGeneration = ++generation.current;
    scope.current = { actorId, offerId, revisionId };
    inFlight.current = false;
    memory.current = null;
    let active = true;
    queueMicrotask(() => {
      if (!active || inFlight.current) return;
      setStored(readOfferFitmentJournal());
      setPending(false);
      setHasFrozenBody(false);
      setRetryAvailable(false);
      setReceipt(null);
      setError(null);
    });
    const owned = controllers.current;
    return () => {
      active = false;
      generation.current = requestGeneration + 1;
      for (const controller of owned) controller.abort();
      owned.clear();
    };
  }, [actorId, offerId, revisionId]);
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
  const scopeMatches = (j: OfferFitmentJournal, dispatched: number) =>
    dispatched === generation.current &&
    scope.current.actorId === j.actorId &&
    scope.current.offerId === j.offerId &&
    scope.current.revisionId === j.revisionId;
  const owns = (j: OfferFitmentJournal, dispatched: number) =>
    ownsOfferFitmentCallback(
      j,
      scope.current.actorId,
      scope.current.offerId,
      scope.current.revisionId,
      dispatched,
      generation.current,
      readOfferFitmentJournal()
    );
  const verifyActor = async (j: OfferFitmentJournal, dispatched: number) => {
    const response = await boundedApi<{ state: string; userId?: string }>(
      "/api/v1/staff/auth/status"
    );
    if (!owns(j, dispatched)) throw new Error("STALE_SCOPE");
    if (!response.ok) {
      if (response.status === 401) callbacks.current.onUnauthorized();
      throw new Error("AUTH_UNAVAILABLE");
    }
    if (response.data.state !== "ACTIVE" || response.data.userId !== j.actorId) {
      await callbacks.current.onRefresh();
      throw new Error("ORIGINAL_ACTOR_REQUIRED");
    }
  };
  const settle = async (
    j: OfferFitmentJournal,
    result: OfferFitmentReceipt,
    dispatched: number
  ) => {
    if (!owns(j, dispatched)) return;
    setReceipt(result);
    // A historical receipt does not prove current content or lifecycle state.
    if (!(await callbacks.current.onRefresh()) || !owns(j, dispatched)) return;
    if (!clearOfferFitmentJournal(j)) {
      setError("offerFitment.storageUnavailable");
      setStored(readOfferFitmentJournal());
      return;
    }
    memory.current = null;
    setHasFrozenBody(false);
    setStored(readOfferFitmentJournal());
    setRetryAvailable(false);
    setError(null);
  };
  const post = async (
    j: OfferFitmentJournal,
    body: OfferFitmentRequest,
    recovery: boolean,
    dispatched: number
  ) => {
    try {
      await verifyActor(j, dispatched);
      if (!owns(j, dispatched)) return;
      if (!recovery && callbacks.current.canDispatch?.() === false) return;
      // Revalidate the exact recoverable metadata immediately before dispatch.
      writeOfferFitmentJournal(j);
      const response = await boundedApi<{ data: OfferFitmentReceipt }>(offerFitmentPath(j), {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!owns(j, dispatched)) return;
      if (response.ok) {
        if (validOfferFitmentReceipt(response.data.data, j))
          await settle(j, response.data.data, dispatched);
        else setError("offerFitment.unknown");
      } else if (!recovery && [400, 401, 403, 404, 409, 422].includes(response.status)) {
        // Only the initial definitive refusal can rule out an earlier ambiguous write.
        if (!clearOfferFitmentJournal(j)) {
          setError("offerFitment.storageUnavailable");
          return;
        }
        memory.current = null;
        setHasFrozenBody(false);
        setStored(readOfferFitmentJournal());
        setError(errorKey(response.status));
        await callbacks.current.onRefresh();
        if (response.status === 401 && scopeMatches(j, dispatched))
          callbacks.current.onUnauthorized();
      } else {
        setError(errorKey(response.status));
        if (response.status === 401) callbacks.current.onUnauthorized();
      }
    } catch {
      if (owns(j, dispatched)) setError("offerFitment.unknown");
    }
  };
  const finish = (dispatched: number) => {
    if (dispatched !== generation.current) return;
    inFlight.current = false;
    setPending(false);
    setStored(readOfferFitmentJournal());
  };
  const dispatch = async (expectedVersion: number, content: OfferFitmentContent) => {
    if (!actorId || inFlight.current || callbacks.current.canDispatch?.() === false) return;
    const existing = readOfferFitmentJournal();
    if (existing.kind !== "empty") {
      setStored(existing);
      setError("offerFitment.unresolved");
      return;
    }
    const dispatched = generation.current;
    inFlight.current = true;
    setPending(true);
    setRetryAvailable(false);
    setReceipt(null);
    setError(null);
    try {
      const identity = {
        schema: 1 as const,
        actorId,
        offerId,
        revisionId,
        commandId: crypto.randomUUID(),
        expectedVersion,
      };
      const body = offerFitmentRequest(identity, content);
      const fingerprint = await offerFitmentFingerprint(identity, body);
      if (
        !scopeMatches({ ...identity, fingerprint }, dispatched) ||
        callbacks.current.canDispatch?.() === false
      )
        return;
      const j = { ...identity, fingerprint };
      writeOfferFitmentJournal(j);
      memory.current = { commandId: j.commandId, body };
      setHasFrozenBody(true);
      setStored({ kind: "valid", journal: j });
      await post(j, body, false, dispatched);
    } catch {
      if (dispatched === generation.current) {
        setStored(readOfferFitmentJournal());
        setError("offerFitment.storageUnavailable");
      }
    } finally {
      finish(dispatched);
    }
  };
  const recheck = async () => {
    if (inFlight.current) return;
    const state = readOfferFitmentJournal();
    setStored(state);
    if (state.kind !== "valid" || !scopeMatches(state.journal, generation.current)) return;
    const j = state.journal;
    const dispatched = generation.current;
    inFlight.current = true;
    setPending(true);
    setRetryAvailable(false);
    setError(null);
    try {
      await verifyActor(j, dispatched);
      if (!owns(j, dispatched)) return;
      const response = await boundedApi<{ data: OfferFitmentReceipt }>(
        `${offerFitmentPath(j)}/commands/${j.commandId}`
      );
      if (!owns(j, dispatched)) return;
      if (response.ok && validOfferFitmentReceipt(response.data.data, j))
        await settle(j, response.data.data, dispatched);
      else {
        setRetryAvailable(!response.ok && response.status === 404);
        setError(
          !response.ok && response.status === 404
            ? "offerFitment.noReceipt"
            : "offerFitment.unknown"
        );
        if (!response.ok && response.status === 401) callbacks.current.onUnauthorized();
      }
    } catch {
      if (owns(j, dispatched)) setError("offerFitment.unknown");
    } finally {
      finish(dispatched);
    }
  };
  const retry = async (content: OfferFitmentContent) => {
    if (inFlight.current || !retryAvailable) return false;
    const state = readOfferFitmentJournal();
    if (state.kind !== "valid" || !scopeMatches(state.journal, generation.current)) return false;
    const j = state.journal;
    const dispatched = generation.current;
    inFlight.current = true;
    setPending(true);
    try {
      const body =
        memory.current?.commandId === j.commandId
          ? memory.current.body
          : offerFitmentRequest(j, content);
      if ((await offerFitmentFingerprint(j, body)) !== j.fingerprint) {
        setError("offerFitment.reconstructionMismatch");
        return false;
      }
      if (!owns(j, dispatched)) return false;
      writeOfferFitmentJournal(j);
      memory.current = { commandId: j.commandId, body };
      setHasFrozenBody(true);
      setRetryAvailable(false);
      await post(j, body, true, dispatched);
      return true;
    } catch {
      if (owns(j, dispatched)) setError("offerFitment.storageUnavailable");
      return false;
    } finally {
      finish(dispatched);
    }
  };
  const journal =
    stored.kind === "valid" &&
    stored.journal.actorId === actorId &&
    stored.journal.offerId === offerId &&
    stored.journal.revisionId === revisionId
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
    needsContent: Boolean(journal && !hasFrozenBody),
  };
}
