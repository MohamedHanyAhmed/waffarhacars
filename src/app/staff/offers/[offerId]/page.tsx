"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { OfferForm } from "@/components/staff/OfferForm";
import OfferFitmentEditor from "@/components/staff/OfferFitmentEditor";
import { readOfferFitmentJournal, type OfferFitmentReview } from "@/lib/fitment/offer-client";
import { protectCapabilityNavigation } from "@/components/staff/CapabilityNavigationBoundary";
import {
  clearPendingOfferOperation,
  clearPendingPublicationOperation,
  minorToEgp,
  offerStatusKey,
  ownsPendingOfferCallback,
  ownsPendingPublicationCallback,
  readPendingOfferOperation,
  readPendingPublicationOperation,
  utcToCairoInput,
  writePendingOfferOperation,
  writePendingPublicationOperation,
  type OfferDto,
  type OfferMutationKind,
  type OfferRevisionDto,
  type PendingOfferOperation,
  type PendingPublicationOperation,
  type PublicationAction,
  type PublicationCommandResult,
  type StaffPublicationDto,
} from "@/lib/offer/client";
import { offerApi, offerFailureMessage, mutationOutcomeUnknown } from "@/lib/offer/client-api";
import type { StaffAuthStatusResponse } from "@/lib/staff/status-contract";

const attestations = [
  "evidenceInspected",
  "priceVerified",
  "scopeVerified",
  "providerConsentVerified",
  "fitmentAllVariantsAttested",
  "fitmentScopePriceAttested",
] as const;
const attestationLabels = {
  evidenceInspected: "staffOffers.attestEvidence",
  priceVerified: "staffOffers.attestPrice",
  scopeVerified: "staffOffers.attestScope",
  providerConsentVerified: "staffOffers.attestConsent",
  fitmentAllVariantsAttested: "staffOffers.attestFitmentVariants",
  fitmentScopePriceAttested: "staffOffers.attestFitmentScopePrice",
} as const;
const reasons = [
  "PRICE_EVIDENCE_UNAVAILABLE",
  "PRICE_NOT_VERIFIED",
  "SCOPE_INCOMPLETE",
  "PROVIDER_CONSENT_UNVERIFIED",
  "COMMERCIAL_TERMS_INCOMPLETE",
  "OTHER",
];

const publicationReasonKeys: Record<string, string> = {
  GATE_DISABLED: "staffOffers.publicationReasonGateDisabled",
  PILOT_CLUSTER_UNSET: "staffOffers.publicationReasonPilotUnset",
  EVIDENCE_REPOSITORY_UNREADY: "staffOffers.publicationReasonEvidenceUnavailable",
  UNPUBLISHED: "staffOffers.publicationReasonUnpublished",
  REVISION_NOT_APPROVED: "staffOffers.publicationReasonRevisionUnapproved",
  PROVIDER_INACTIVE: "staffOffers.publicationReasonProviderInactive",
  BRANCH_INACTIVE: "staffOffers.publicationReasonBranchInactive",
  BRANCH_NOT_VETTED: "staffOffers.publicationReasonBranchUnvetted",
  OUTSIDE_PILOT_CLUSTER: "staffOffers.publicationReasonOutsidePilot",
  SERVICE_INACTIVE: "staffOffers.publicationReasonServiceInactive",
  CATEGORY_INACTIVE: "staffOffers.publicationReasonCategoryInactive",
  SERVICE_IDENTITY_CHANGED: "staffOffers.publicationReasonServiceChanged",
  QUOTE_REQUIRED: "staffOffers.publicationReasonQuoteRequired",
  NOT_YET_VALID: "staffOffers.publicationReasonNotYetValid",
  EXPIRED: "staffOffers.publicationReasonExpired",
  ATTESTATIONS_INCOMPLETE: "staffOffers.publicationReasonAttestationsIncomplete",
};

export default function StaffOfferDetailPage() {
  const { offerId } = useParams<{ offerId: string }>();
  const router = useRouter();
  const { t, locale, dir } = useI18n();
  const [offer, setOffer] = useState<OfferDto | null>(null);
  const [staff, setStaff] = useState<StaffAuthStatusResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(() => {
    const journal = readPendingOfferOperation();
    return Boolean(journal && journal.kind !== "edit");
  });
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [editor, setEditor] = useState<"commercial" | "fitment">(() =>
    readOfferFitmentJournal().kind === "empty" ? "commercial" : "fitment"
  );
  const [commercialEpoch, setCommercialEpoch] = useState(0);
  const [commercialState, setCommercialState] = useState({
    dirty: false,
    pending: false,
    unknown: false,
  });
  const [fitmentState, setFitmentState] = useState({
    dirty: false,
    pending: false,
    unknown: false,
  });
  const reportCommercialState = useCallback(
    (state: typeof commercialState) => setCommercialState(state),
    []
  );
  const reportFitmentState = useCallback(
    (state: typeof fitmentState) => setFitmentState(state),
    []
  );
  const selectedRef = useRef<string | null>(null);
  const actorRef = useRef<string | undefined>(undefined);
  const loadGeneration = useRef(0);
  const [checks, setChecks] = useState<Record<(typeof attestations)[number], boolean>>({
    evidenceInspected: false,
    priceVerified: false,
    scopeVerified: false,
    providerConsentVerified: false,
    fitmentAllVariantsAttested: false,
    fitmentScopePriceAttested: false,
  });
  const [fitmentReview, setFitmentReview] = useState<{
    snapshotIdentity: string;
    data: OfferFitmentReview;
  } | null>(null);
  const [fitmentLoadError, setFitmentLoadError] = useState(false);
  const [reason, setReason] = useState("");
  const [reload, setReload] = useState(0);
  const [publication, setPublication] = useState<StaffPublicationDto | null>(null);
  const [publicationLoading, setPublicationLoading] = useState(false);
  const [publicationLoadError, setPublicationLoadError] = useState(false);
  const [publicationPending, setPublicationPending] = useState(false);
  const [publicationUnknown, setPublicationUnknown] = useState(
    () => readPendingPublicationOperation()?.offerId === offerId
  );
  const [publicationRetryAvailable, setPublicationRetryAvailable] = useState(false);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const [publicationMessage, setPublicationMessage] = useState<string | null>(null);
  const [publicationConfirm, setPublicationConfirm] = useState<{
    action: PublicationAction;
    revisionId?: string;
    expectedVersion: number;
  } | null>(null);
  const [publicationReload, setPublicationReload] = useState(0);
  const inFlight = useRef(false);
  const publicationInFlight = useRef(false);
  const generation = useRef(0);
  const publicationGeneration = useRef(0);
  const attestedSnapshot = useRef<string | null>(null);
  const operationRef = useRef<PendingOfferOperation | null>(
    readPendingOfferOperation()?.offerId === offerId ? readPendingOfferOperation() : null
  );

  useEffect(() => {
    const counter = generation;
    const loaderCounter = loadGeneration;
    counter.current++;
    return () => {
      counter.current++;
      loaderCounter.current++;
    };
  }, [offerId]);

  useEffect(() => {
    const counter = publicationGeneration;
    const current = ++counter.current;
    queueMicrotask(() => {
      if (counter.current !== current) return;
      setPublication(null);
      setPublicationLoadError(false);
      setPublicationError(null);
      setPublicationMessage(null);
      setPublicationConfirm(null);
      setPublicationUnknown(Boolean(readPendingPublicationOperation()));
      setPublicationRetryAvailable(false);
    });
    return () => {
      if (counter.current === current) counter.current++;
    };
  }, [offerId]);

  useEffect(() => {
    const journal = readPendingPublicationOperation();
    if (!journal) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setPublicationUnknown(true);
      if (journal.offerId !== offerId)
        setPublicationError(t("staffOffers.publicationOtherPending"));
    });
    return () => {
      active = false;
    };
  }, [offerId, t]);

  useEffect(() => {
    const journal = readPendingOfferOperation();
    if (!journal) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (journal.kind !== "edit") setUnknown(true);
      if (journal.offerId !== offerId) {
        setManual(true);
        setError(t("staffOffers.manual"));
      } else operationRef.current = journal;
    });
    return () => {
      active = false;
    };
  }, [offerId, t]);

  const load = useCallback(
    async (signal?: AbortSignal): Promise<boolean> => {
      const current = ++loadGeneration.current;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const deadline = setTimeout(abort, 12_000);
      setLoading(true);
      setConfirmSubmit(false);
      setFitmentReview(null);
      setFitmentLoadError(false);
      try {
        const auth = await offerApi<StaffAuthStatusResponse>("/api/v1/staff/auth/status", {
          signal: controller.signal,
        });
        if (controller.signal.aborted || current !== loadGeneration.current) return false;
        if (
          !auth.ok ||
          auth.data.state !== "ACTIVE" ||
          !auth.data.canAccessStaffApp ||
          !auth.data.userId
        ) {
          setOffer(null);
          setStaff(null);
          if (!auth.ok && auth.status === 401) router.replace("/staff/login");
          setError(t("staffOffers.denied"));
          return false;
        }
        const changedActor = Boolean(actorRef.current && actorRef.current !== auth.data.userId);
        if (changedActor) {
          generation.current++;
          publicationGeneration.current++;
          setOffer(null);
          setStaff(null);
          setUnsaved(false);
          inFlight.current = false;
          setPending(false);
          publicationInFlight.current = false;
          setPublicationPending(false);
          setPublication(null);
          setPublicationConfirm(null);
          setCommercialState({ dirty: false, pending: false, unknown: false });
          setFitmentState({ dirty: false, pending: false, unknown: false });
        }
        actorRef.current = auth.data.userId;
        const response = await offerApi<OfferDto>(`/api/v1/staff/offers/${offerId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || current !== loadGeneration.current) return false;
        if (!response.ok || response.data.id !== offerId) {
          setOffer(null);
          setStaff(null);
          if (!response.ok && response.status === 401) router.replace("/staff/login");
          setError(!response.ok ? offerFailureMessage(response, t) : t("staffOffers.missing"));
          return false;
        }
        const pendingFitment = readOfferFitmentJournal();
        const pendingCommercial = readPendingOfferOperation();
        const recoveryRevisionId =
          pendingFitment.kind === "valid" &&
          pendingFitment.journal.offerId === offerId &&
          pendingFitment.journal.actorId === auth.data.userId
            ? pendingFitment.journal.revisionId
            : pendingCommercial?.offerId === offerId
              ? pendingCommercial.revisionId
              : undefined;
        const revision =
          response.data.revisions?.find(
            (item) => item.id === (selectedRef.current ?? recoveryRevisionId)
          ) ?? response.data.revisions?.[0];
        if (!revision) {
          setOffer(null);
          setError(t("staffOffers.missing"));
          return false;
        }
        const fitment = await offerApi<{ data: OfferFitmentReview }>(
          `/api/v1/staff/offers/${offerId}/revisions/${revision.id}/fitment`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted || current !== loadGeneration.current) return false;
        if (
          !fitment.ok ||
          fitment.data.data.offerId !== offerId ||
          fitment.data.data.revisionId !== revision.id ||
          fitment.data.data.version !== revision.version
        ) {
          if (!fitment.ok && fitment.status === 401) router.replace("/staff/login");
          setFitmentLoadError(true);
          setError(t("staffOffers.fitmentUnavailable"));
          return false;
        }
        const finalAuth = await offerApi<StaffAuthStatusResponse>("/api/v1/staff/auth/status", {
          signal: controller.signal,
        });
        if (controller.signal.aborted || current !== loadGeneration.current) return false;
        if (
          !finalAuth.ok ||
          finalAuth.data.state !== "ACTIVE" ||
          !finalAuth.data.canAccessStaffApp ||
          finalAuth.data.userId !== auth.data.userId
        ) {
          generation.current++;
          publicationGeneration.current++;
          setOffer(null);
          setStaff(null);
          if (!finalAuth.ok && finalAuth.status === 401) router.replace("/staff/login");
          setError(t("staffOffers.denied"));
          return false;
        }
        setStaff(auth.data);
        setOffer(response.data);
        selectedRef.current = revision.id;
        setSelectedId(revision.id);
        setFitmentReview({
          snapshotIdentity: `${auth.data.userId}:${offerId}:${revision.id}:${revision.version}`,
          data: fitment.data.data,
        });
        return !changedActor;
      } catch {
        if (current === loadGeneration.current && !signal?.aborted) {
          setFitmentLoadError(true);
          setError(t("staffOffers.genericError"));
        }
        return false;
      } finally {
        clearTimeout(deadline);
        signal?.removeEventListener("abort", abort);
        if (current === loadGeneration.current && !signal?.aborted) setLoading(false);
      }
    },
    [offerId, router, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    async function executeLoad() {
      try {
        await load(controller.signal);
      } catch {
        if (!controller.signal.aborted) {
          setError(t("staffOffers.genericError"));
          setLoading(false);
        }
      }
    }
    void executeLoad();
    return () => controller.abort();
  }, [offerId, reload, load, t]);

  useEffect(() => {
    if (staff?.state !== "ACTIVE" || staff.department !== "OPERATIONS") return;
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => {
      if (active) setPublicationLoading(true);
    });
    void offerApi<StaffPublicationDto>(`/api/v1/staff/ops/offers/${offerId}/publication`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!active || controller.signal.aborted) return;
        if (response.ok) {
          setPublicationLoadError(false);
          setPublication((previous) =>
            previous && previous.offerId === offerId && previous.version > response.data.version
              ? previous
              : response.data
          );
          setPublicationError(null);
        } else if (response.status === 401) router.replace("/staff/login");
        else {
          setPublicationLoadError(true);
          setPublicationError(offerFailureMessage(response, t));
        }
      })
      .catch(() => {
        if (active && !controller.signal.aborted) {
          setPublicationLoadError(true);
          setPublicationError(t("staffOffers.genericError"));
        }
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setPublicationLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [staff?.userId, staff?.state, staff?.department, offerId, publicationReload, router, t]);

  const revisions = offer?.revisions ?? [];
  const selected = revisions.find((item) => item.id === selectedId) ?? null;
  const latest = revisions[0] ?? null;
  const commercialJournal = readPendingOfferOperation();
  const recoveringCommercial =
    commercialJournal?.kind === "edit" &&
    commercialJournal.offerId === offerId &&
    commercialJournal.revisionId === selected?.id;
  const snapshotIdentity =
    selected && staff?.userId
      ? `${staff.userId}:${offerId}:${selected.id}:${selected.version}`
      : null;
  const reviewedFitment =
    fitmentReview?.snapshotIdentity === snapshotIdentity &&
    fitmentReview.data.revisionId === selected?.id &&
    fitmentReview.data.offerId === offerId &&
    fitmentReview.data.version === selected?.version
      ? fitmentReview.data
      : null;
  const fitmentReady = Boolean(
    reviewedFitment?.mode && reviewedFitment.evidenceRef && reviewedFitment.coverage.length > 0
  );
  const reviewIdentity = JSON.stringify([
    snapshotIdentity,
    selected?.status,
    offer?.providerOrganization?.status,
    offer?.branch?.status,
    reviewedFitment,
  ]);
  const currentReviewIdentity = useRef(reviewIdentity);
  useLayoutEffect(() => {
    currentReviewIdentity.current = reviewIdentity;
  }, [reviewIdentity]);
  useEffect(() => {
    if (attestedSnapshot.current === reviewIdentity) return;
    attestedSnapshot.current = reviewIdentity;
    setConfirmSubmit(false);
    setChecks({
      evidenceInspected: false,
      priceVerified: false,
      scopeVerified: false,
      providerConsentVerified: false,
      fitmentAllVariantsAttested: false,
      fitmentScopePriceAttested: false,
    });
  }, [reviewIdentity]);
  const isSalesOwner =
    staff?.state === "ACTIVE" &&
    staff.department === "SALES" &&
    selected?.createdByUserId === staff.userId;
  const canReview =
    staff?.state === "ACTIVE" &&
    staff.department === "OPERATIONS" &&
    selected?.createdByUserId !== staff.userId;
  const actionDisabled =
    pending ||
    unknown ||
    loading ||
    unsaved ||
    commercialState.dirty ||
    commercialState.pending ||
    commercialState.unknown ||
    fitmentState.dirty ||
    fitmentState.pending ||
    fitmentState.unknown ||
    fitmentLoadError ||
    !reviewedFitment ||
    offer?.id !== offerId ||
    readOfferFitmentJournal().kind !== "empty" ||
    Boolean(readPendingOfferOperation()) ||
    Boolean(readPendingPublicationOperation());
  const canManagePublication =
    staff?.state === "ACTIVE" && staff.department === "OPERATIONS" && offer?.id === offerId;
  const publicationJournal = readPendingPublicationOperation();
  const publicationActionDisabled =
    publicationPending ||
    publicationUnknown ||
    publicationLoading ||
    !publication ||
    publicationLoadError ||
    unsaved ||
    commercialState.dirty ||
    commercialState.pending ||
    commercialState.unknown ||
    fitmentState.dirty ||
    fitmentState.pending ||
    fitmentState.unknown ||
    loading ||
    fitmentLoadError ||
    !reviewedFitment ||
    readOfferFitmentJournal().kind !== "empty" ||
    Boolean(publicationJournal) ||
    Boolean(readPendingOfferOperation());

  const fitmentExternallyBlocked =
    loading ||
    fitmentLoadError ||
    !reviewedFitment ||
    pending ||
    unknown ||
    publicationPending ||
    publicationUnknown ||
    commercialState.dirty ||
    commercialState.pending ||
    commercialState.unknown ||
    Boolean(readPendingOfferOperation()) ||
    Boolean(readPendingPublicationOperation());
  const commercialExternallyBlocked =
    loading ||
    fitmentLoadError ||
    !reviewedFitment ||
    pending ||
    unknown ||
    publicationPending ||
    publicationUnknown ||
    fitmentState.dirty ||
    fitmentState.pending ||
    fitmentState.unknown ||
    readOfferFitmentJournal().kind !== "empty" ||
    Boolean(readPendingPublicationOperation());
  const protectedWork =
    unsaved ||
    commercialState.dirty ||
    fitmentState.dirty ||
    commercialState.pending ||
    commercialState.unknown ||
    fitmentState.pending ||
    fitmentState.unknown ||
    pending ||
    unknown ||
    publicationPending ||
    publicationUnknown ||
    Boolean(readPendingOfferOperation()) ||
    Boolean(readPendingPublicationOperation()) ||
    readOfferFitmentJournal().kind !== "empty";
  useLayoutEffect(() => {
    if (!protectedWork) return;
    const protectedUrl = window.location.href;
    const protectedState: unknown = window.history.state;
    const warn = () => setError(t("offerFitment.navigationBlocked"));
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || link.getAttribute("href")?.startsWith("#")) return;
      event.preventDefault();
      event.stopPropagation();
      warn();
    };
    const release = protectCapabilityNavigation((event) => {
      event.stopImmediatePropagation();
      try {
        window.history.pushState(protectedState, "", protectedUrl);
      } catch {
        window.history.replaceState(protectedState, "", protectedUrl);
      }
      warn();
    });
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      release();
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [protectedWork, t]);

  const switchEditor = (target: "commercial" | "fitment") => {
    if (
      protectedWork ||
      readPendingOfferOperation() ||
      readOfferFitmentJournal().kind !== "empty"
    ) {
      setError(t("offerFitment.navigationBlocked"));
      return;
    }
    setEditor(target);
  };

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setPublicationConfirm(null);
    });
    return () => {
      active = false;
    };
  }, [selectedId, publication?.version]);

  const reconcilePublication = async (operation?: PendingPublicationOperation) => {
    const target = operation ?? readPendingPublicationOperation();
    if (!target || target.offerId !== offerId) {
      setPublicationError(t("staffOffers.publicationOtherPending"));
      return;
    }
    if (target.actorUserId !== staff?.userId) {
      setPublicationError(t("staffOffers.publicationOriginalActor"));
      return;
    }
    const currentGeneration = publicationGeneration.current;
    const ownsCurrent = () =>
      ownsPendingPublicationCallback(
        target.commandId,
        currentGeneration,
        publicationGeneration.current
      );
    try {
      const response = await offerApi<PublicationCommandResult>(
        `/api/v1/staff/ops/offers/${offerId}/publication/commands/${target.commandId}`
      );
      if (!ownsCurrent()) return;
      if (!response.ok) {
        if (response.status === 401) return router.replace("/staff/login");
        // A missing command is not proof that an in-flight write failed or rolled back.
        setPublicationUnknown(true);
        setPublicationRetryAvailable(response.status === 404);
        setPublicationError(t("staffOffers.publicationStillUnknown"));
        return;
      }
      clearPendingPublicationOperation(target.commandId);
      setPublicationRetryAvailable(false);
      setPublication((previous) =>
        previous && previous.version > response.data.publication.version
          ? previous
          : response.data.publication
      );
      setPublicationUnknown(false);
      setPublicationConfirm(null);
      if (response.data.command.outcome === "APPLIED") {
        setPublicationError(null);
        setPublicationMessage(t("staffOffers.publicationCommandRecorded"));
        setPublicationReload((value) => value + 1);
      } else {
        setPublicationMessage(null);
        setPublicationError(t("staffOffers.publicationCommandRejected"));
      }
    } catch {
      if (ownsCurrent()) {
        setPublicationUnknown(true);
        setPublicationRetryAvailable(false);
        setPublicationError(t("staffOffers.publicationStillUnknown"));
      }
    }
  };

  const mutatePublication = async (decision: {
    action: PublicationAction;
    revisionId?: string;
    expectedVersion: number;
  }) => {
    if (publicationInFlight.current || publicationActionDisabled || !publication || !staff?.userId)
      return;
    if (
      decision.expectedVersion !== publication.version ||
      (decision.action !== "UNPUBLISH" &&
        (!selected || selected.id !== decision.revisionId || selected.status !== "APPROVED"))
    ) {
      setPublicationConfirm(null);
      setPublicationError(t("staffOffers.conflict"));
      return;
    }
    const operation: PendingPublicationOperation = {
      commandId: crypto.randomUUID(),
      offerId,
      actorUserId: staff.userId,
      action: decision.action,
      expectedVersion: decision.expectedVersion,
      ...(decision.revisionId ? { revisionId: decision.revisionId } : {}),
    };
    setPublicationRetryAvailable(false);
    try {
      writePendingPublicationOperation(operation);
    } catch {
      setPublicationError(t("staffOffers.storageUnavailable"));
      return;
    }
    await postPublication(operation, false);
  };

  const postPublication = async (
    operation: PendingPublicationOperation,
    isRecoveryRetry: boolean
  ) => {
    const currentGeneration = publicationGeneration.current;
    const ownsCurrent = () =>
      ownsPendingPublicationCallback(
        operation.commandId,
        currentGeneration,
        publicationGeneration.current
      );
    publicationInFlight.current = true;
    setPublicationPending(true);
    setPublicationError(null);
    setPublicationMessage(null);
    try {
      const response = await offerApi<PublicationCommandResult>(
        `/api/v1/staff/ops/offers/${offerId}/publication`,
        {
          method: "POST",
          body: JSON.stringify({
            commandId: operation.commandId,
            action: operation.action,
            expectedVersion: operation.expectedVersion,
            ...(operation.revisionId ? { revisionId: operation.revisionId } : {}),
          }),
        }
      );
      if (!ownsCurrent()) return;
      if (!response.ok) {
        if (mutationOutcomeUnknown(response.status)) {
          setPublicationUnknown(true);
          setPublicationRetryAvailable(false);
          setPublicationError(t("staffOffers.publicationStillUnknown"));
          return;
        }
        if (response.status === 409 || response.status === 422) {
          await reconcilePublication(operation);
          return;
        }
        // A definitive first-delivery validation/auth/maker-checker refusal has no
        // prior request that could still commit. A retry after an unknown outcome
        // must never clear the original journal on the same refusal.
        if (!isRecoveryRetry && [400, 401, 403, 404].includes(response.status)) {
          clearPendingPublicationOperation(operation.commandId);
          setPublicationUnknown(false);
          setPublicationRetryAvailable(false);
          setPublicationConfirm(null);
          if (response.status === 401) return router.replace("/staff/login");
          setPublicationError(offerFailureMessage(response, t));
          return;
        }
        if (response.status === 401) return router.replace("/staff/login");
        setPublicationUnknown(true);
        setPublicationRetryAvailable(false);
        setPublicationError(offerFailureMessage(response, t));
        return;
      }
      clearPendingPublicationOperation(operation.commandId);
      setPublicationRetryAvailable(false);
      setPublication((previous) =>
        previous && previous.version > response.data.publication.version
          ? previous
          : response.data.publication
      );
      setPublicationReload((value) => value + 1);
      setPublicationUnknown(false);
      setPublicationConfirm(null);
      setPublicationMessage(t("staffOffers.publicationCommandRecorded"));
    } catch {
      if (ownsCurrent()) {
        setPublicationUnknown(true);
        setPublicationRetryAvailable(false);
        setPublicationError(t("staffOffers.publicationStillUnknown"));
      }
    } finally {
      publicationInFlight.current = false;
      if (publicationGeneration.current === currentGeneration) setPublicationPending(false);
    }
  };

  const retryPublication = async () => {
    const operation = readPendingPublicationOperation();
    if (
      !publicationRetryAvailable ||
      publicationInFlight.current ||
      !canManagePublication ||
      !operation ||
      operation.offerId !== offerId ||
      operation.actorUserId !== staff?.userId
    )
      return;
    // Keep the original command ID, actor-bound resource, target and expected version.
    // A still-running original request is serialized and replayed by the server.
    setPublicationRetryAvailable(false);
    await postPublication(operation, true);
  };

  const markUnknown = (operation: PendingOfferOperation) => {
    operationRef.current = operation;
    setUnknown(true);
    setError(t("staffOffers.unknown"));
  };

  const mutate = async (
    kind: OfferMutationKind,
    url: string,
    body: unknown,
    revision: OfferRevisionDto,
    successorRequestId?: string
  ) => {
    if (
      !staff?.userId ||
      inFlight.current ||
      actionDisabled ||
      readOfferFitmentJournal().kind !== "empty"
    )
      return;
    if ((kind === "approve" || kind === "reject") && attestedSnapshot.current !== reviewIdentity) {
      setError(t("staffOffers.conflict"));
      return;
    }
    if (kind === "approve" && (!fitmentReady || !attestations.every((key) => checks[key]))) {
      setError(t("staffOffers.fitmentBlocked"));
      return;
    }
    if (kind === "submit" && (!fitmentReady || !confirmSubmit || unsaved || fitmentState.dirty)) {
      setError(t("staffOffers.fitmentBlocked"));
      return;
    }
    if (readPendingOfferOperation()) {
      setUnknown(true);
      setManual(true);
      setError(t("staffOffers.manual"));
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    setMessage(null);
    const operation: PendingOfferOperation = {
      operationId: crypto.randomUUID(),
      kind,
      offerId,
      revisionId: revision.id,
      expectedVersion: revision.version,
      ...(successorRequestId ? { revisionRequestId: successorRequestId } : {}),
      unresolved: true,
    };
    const currentGeneration = generation.current;
    const ownsCurrentOperation = () =>
      ownsPendingOfferCallback(operation.operationId, currentGeneration, generation.current);
    try {
      writePendingOfferOperation(operation);
    } catch {
      inFlight.current = false;
      setPending(false);
      setError(t("staffOffers.storageUnavailable"));
      return;
    }
    operationRef.current = operation;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 12_000);
    const reviewedActor = staff.userId;
    const dispatchedReview = reviewIdentity;
    let dispatched = false;
    try {
      // A shared browser session can change in another tab after the six checks
      // were entered. Cached display identity is not proof of the acting session.
      const actualActor = await offerApi<StaffAuthStatusResponse>("/api/v1/staff/auth/status", {
        signal: controller.signal,
      });
      if (!ownsCurrentOperation()) return;
      if (
        !actualActor.ok ||
        actualActor.data.state !== "ACTIVE" ||
        !actualActor.data.canAccessStaffApp ||
        actualActor.data.userId !== reviewedActor ||
        currentReviewIdentity.current !== dispatchedReview
      ) {
        clearPendingOfferOperation(operation.operationId);
        operationRef.current = null;
        setConfirmSubmit(false);
        setPending(false);
        setError(t("staffOffers.denied"));
        await load();
        return;
      }
      dispatched = true;
      const response = await offerApi<OfferRevisionDto>(url, {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!ownsCurrentOperation()) return;
      if (!response.ok) {
        if (response.status === 401) {
          clearPendingOfferOperation(operation.operationId);
          return router.replace("/staff/login");
        }
        if (response.code === "OFFER_APPROVAL_BLOCKED") {
          clearPendingOfferOperation(operation.operationId);
          operationRef.current = null;
          setError(t("staffOffers.repositoryUnavailable"));
          return;
        }
        if (mutationOutcomeUnknown(response.status)) {
          markUnknown(operation);
          return;
        }
        clearPendingOfferOperation(operation.operationId);
        operationRef.current = null;
        if (response.status === 409) {
          setError(t("staffOffers.conflict"));
          setChecks({
            evidenceInspected: false,
            priceVerified: false,
            scopeVerified: false,
            providerConsentVerified: false,
            fitmentAllVariantsAttested: false,
            fitmentScopePriceAttested: false,
          });
          setReload((value) => value + 1);
        } else setError(offerFailureMessage(response, t));
        return;
      }
      clearPendingOfferOperation(operation.operationId);
      operationRef.current = null;
      setUnknown(false);
      setConfirmSubmit(false);
      setChecks({
        evidenceInspected: false,
        priceVerified: false,
        scopeVerified: false,
        providerConsentVerified: false,
        fitmentAllVariantsAttested: false,
        fitmentScopePriceAttested: false,
      });
      setMessage(
        t(
          kind === "submit"
            ? "staffOffers.submitted"
            : kind === "approve"
              ? "staffOffers.approved"
              : kind === "reject"
                ? "staffOffers.rejected"
                : "staffOffers.saved"
        )
      );
      selectedRef.current = response.data.id;
      setSelectedId(response.data.id);
      setReload((value) => value + 1);
    } catch {
      if (ownsCurrentOperation()) {
        if (dispatched) markUnknown(operation);
        else {
          clearPendingOfferOperation(operation.operationId);
          operationRef.current = null;
          setError(t("staffOffers.genericError"));
        }
      }
    } finally {
      clearTimeout(deadline);
      inFlight.current = false;
      if (generation.current === currentGeneration) setPending(false);
    }
  };

  const reconcile = async () => {
    const operation = readPendingOfferOperation();
    if (!operation || operation.offerId !== offerId) {
      setManual(true);
      setError(t("staffOffers.manual"));
      return;
    }
    const currentGeneration = generation.current;
    const stillOwned = () =>
      ownsPendingOfferCallback(operation.operationId, currentGeneration, generation.current);
    try {
      const response = await offerApi<OfferDto>(`/api/v1/staff/offers/${offerId}`);
      if (!stillOwned()) return;
      if (!response.ok) {
        setManual(true);
        setError(t("staffOffers.manual"));
        return;
      }
      const current = response.data.revisions?.find((item) => item.id === operation.revisionId);
      const successor = response.data.revisions?.find(
        (item) => item.requestId === operation.revisionRequestId
      );
      const settled =
        operation.kind === "successor"
          ? Boolean(successor)
          : Boolean(
              current &&
              operation.expectedVersion !== undefined &&
              current.version > operation.expectedVersion
            );
      if (settled) {
        clearPendingOfferOperation(operation.operationId);
        operationRef.current = null;
        setUnknown(false);
        setManual(false);
        setOffer(response.data);
        selectedRef.current = successor?.id ?? current?.id ?? null;
        setSelectedId(successor?.id ?? current?.id ?? null);
        setMessage(null);
        setError(t("staffOffers.conflict"));
      } else {
        setManual(true);
        setError(t("staffOffers.manual"));
      }
    } catch {
      setManual(true);
      setError(t("staffOffers.manual"));
    }
  };

  const detail = (label: string, value: string | null | undefined, latin = false) => (
    <div>
      <dt className="text-xs font-semibold text-slate-600">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm">
        {latin ? <bdi dir="ltr">{value || "—"}</bdi> : value || "—"}
      </dd>
    </div>
  );

  const cairoDate = (value: string | null) =>
    value ? utcToCairoInput(value).replace("T", " ") : null;
  const percentage = (basisPoints: string | number) => {
    const value = BigInt(basisPoints);
    return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}%`;
  };
  const bookingRuleLabels: Record<OfferRevisionDto["bookingRule"], string> = {
    APPOINTMENT_REQUIRED: "staffOffers.appointment",
    WALK_IN_ALLOWED: "staffOffers.walkIn",
    CONTACT_TO_BOOK: "staffOffers.contact",
  };
  const evidenceTypeLabels: Record<string, string> = {
    PROVIDER_PRICE_LIST: "staffOffers.evidenceProviderPriceList",
    WRITTEN_QUOTE: "staffOffers.evidenceWrittenQuote",
    PROVIDER_WRITTEN_CONFIRMATION: "staffOffers.evidenceProviderWrittenConfirmation",
    OTHER: "staffOffers.evidenceOther",
  };
  const rejectionReasonLabels: Record<string, string> = {
    PRICE_EVIDENCE_UNAVAILABLE: "staffOffers.reasonPriceEvidenceUnavailable",
    PRICE_NOT_VERIFIED: "staffOffers.reasonPriceNotVerified",
    SCOPE_INCOMPLETE: "staffOffers.reasonScopeIncomplete",
    PROVIDER_CONSENT_UNVERIFIED: "staffOffers.reasonProviderConsentUnverified",
    COMMERCIAL_TERMS_INCOMPLETE: "staffOffers.reasonCommercialTermsIncomplete",
    OTHER: "staffOffers.reasonOther",
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6" dir={dir}>
      <header>
        <Link href="/staff/offers" className="text-sm font-semibold text-brand-700 hover:underline">
          {t("staffOffers.back")}
        </Link>
        <h1 className="mt-3 text-2xl font-bold">{t("staffOffers.offerDetails")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("staffOffers.internalOnly")}</p>
        <button
          type="button"
          data-testid="offer-detail-refresh"
          disabled={
            loading ||
            pending ||
            publicationPending ||
            commercialState.pending ||
            fitmentState.pending
          }
          onClick={() => void load()}
          className="mt-3 min-h-11 rounded-lg border px-4 py-2 disabled:opacity-50"
        >
          {t("offerFitment.refresh")}
        </button>
      </header>
      {loading && <p role="status">{t("staffOffers.loading")}</p>}
      {error && (
        <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
          {error}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900"
        >
          {message}
        </p>
      )}
      {unknown && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p>{t("staffOffers.unknown")}</p>
          <button
            type="button"
            onClick={reconcile}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-white"
          >
            {t("staffOffers.reconcile")}
          </button>
          {manual && <p className="mt-2 text-sm">{t("staffOffers.manual")}</p>}
        </div>
      )}
      {offer && selected && (
        <>
          <section className="rounded-2xl border bg-white p-5">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">
                  {locale === "ar" ? selected.titleAr : selected.titleEn}
                </h2>
                <p className="text-sm text-slate-600">
                  {locale === "ar"
                    ? offer.providerOrganization?.nameAr
                    : offer.providerOrganization?.nameEn}{" "}
                  — {locale === "ar" ? offer.branch?.nameAr : offer.branch?.nameEn}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">
                {t(offerStatusKey(selected.status))} · v{selected.version}
              </span>
            </div>
            <div className="mt-4">
              <label htmlFor="offer-revision" className="text-sm font-semibold">
                {t("staffOffers.offerDetails")}
              </label>
              <select
                id="offer-revision"
                value={selected.id}
                disabled={actionDisabled}
                onChange={(event) => {
                  if (
                    actionDisabled ||
                    protectedWork ||
                    readPendingOfferOperation() ||
                    readOfferFitmentJournal().kind !== "empty"
                  )
                    return;
                  selectedRef.current = event.target.value;
                  setSelectedId(event.target.value);
                  setFitmentReview(null);
                  setConfirmSubmit(false);
                  setReload((value) => value + 1);
                  setUnsaved(false);
                  setChecks({
                    evidenceInspected: false,
                    priceVerified: false,
                    scopeVerified: false,
                    providerConsentVerified: false,
                    fitmentAllVariantsAttested: false,
                    fitmentScopePriceAttested: false,
                  });
                }}
                className="ms-2 rounded-lg border p-2"
              >
                {revisions.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.revisionNumber} · {t(offerStatusKey(item.status))}
                  </option>
                ))}
              </select>
            </div>
          </section>
          <section className="rounded-2xl border bg-white p-5">
            <h2 className="text-lg font-bold">{t("staffOffers.decisionSnapshot")}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {t("staffOffers.snapshotVersion", {
                revision: selected.revisionNumber,
                version: selected.version,
              })}{" "}
              {t(offerStatusKey(selected.status))}
            </p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              {detail(t("staffOffers.provider"), offer.providerOrganization?.nameEn)}
              {detail(t("staffOffers.providerAr"), offer.providerOrganization?.nameAr)}
              {detail(t("staffOffers.branch"), offer.branch?.nameEn)}
              {detail(t("staffOffers.branchAr"), offer.branch?.nameAr)}
              {detail(t("staffOffers.category"), selected.categoryNameEn)}
              {detail(t("staffOffers.categoryAr"), selected.categoryNameAr)}
              {detail(t("staffOffers.code"), selected.serviceCode, true)}
              {detail(t("staffOffers.scopeEn"), selected.serviceScopeEn)}
              {detail(t("staffOffers.scopeAr"), selected.serviceScopeAr)}
              {detail(t("staffOffers.serviceEn"), selected.serviceNameEn)}
              {detail(t("staffOffers.serviceAr"), selected.serviceNameAr)}
              {detail(t("staffOffers.titleEn"), selected.titleEn)}
              {detail(t("staffOffers.titleAr"), selected.titleAr)}
              {detail(t("staffOffers.includedLaborEn"), selected.includedLaborEn)}
              {detail(t("staffOffers.includedLaborAr"), selected.includedLaborAr)}
              {detail(t("staffOffers.includedPartsEn"), selected.includedPartsEn)}
              {detail(t("staffOffers.includedPartsAr"), selected.includedPartsAr)}
              {detail(t("staffOffers.excludedLaborEn"), selected.excludedLaborEn)}
              {detail(t("staffOffers.excludedLaborAr"), selected.excludedLaborAr)}
              {detail(t("staffOffers.excludedPartsEn"), selected.excludedPartsEn)}
              {detail(t("staffOffers.excludedPartsAr"), selected.excludedPartsAr)}
              {detail(t("staffOffers.bookingRule"), t(bookingRuleLabels[selected.bookingRule]))}
              {detail(t("staffOffers.durationMinutes"), String(selected.durationMinutes), true)}
              {detail(t("staffOffers.validFrom"), cairoDate(selected.validFrom), true)}
              {detail(t("staffOffers.validUntil"), cairoDate(selected.validUntil), true)}
              {detail(
                t("staffOffers.normalPrice"),
                `EGP ${minorToEgp(selected.normalPriceMinor)}`,
                true
              )}
              {detail(
                t("staffOffers.customerPrice"),
                `EGP ${minorToEgp(selected.customerPriceMinor)}`,
                true
              )}
              {detail(t("staffOffers.savings"), `EGP ${minorToEgp(selected.savingsMinor)}`, true)}
              {detail(t("staffOffers.discount"), percentage(selected.discountRateBps), true)}
              {detail(t("staffOffers.evidencePacket"), selected.evidencePacketId, true)}
              {detail(
                t("staffOffers.evidenceType"),
                t(evidenceTypeLabels[selected.evidenceType] ?? "staffOffers.unrecognizedValue")
              )}
              {detail(t("staffOffers.evidenceDate"), cairoDate(selected.evidenceDate), true)}
              {detail(t("staffOffers.termsPacket"), selected.commercialTermsPacketId, true)}
              {detail(
                t("staffOffers.termsAgreedAt"),
                cairoDate(selected.commercialTermsAgreedAt),
                true
              )}
              {detail(t("staffOffers.commissionBasis"), t("staffOffers.commissionCustomerPrice"))}
              {detail(
                t("staffOffers.commissionBps"),
                `${selected.commissionRateBps} bps (${percentage(selected.commissionRateBps)})`,
                true
              )}
              {detail(t("staffOffers.priceNotes"), selected.priceBasisNotes)}
              {detail(t("staffOffers.submittedAt"), cairoDate(selected.submittedAt), true)}
              {detail(t("staffOffers.submittedBy"), selected.submittedByUserId, true)}
              {detail(t("staffOffers.decidedAt"), cairoDate(selected.decidedAt), true)}
              {detail(t("staffOffers.decidedBy"), selected.decidedByUserId, true)}
              {selected.rejectionReason &&
                detail(
                  t("staffOffers.reason"),
                  t(
                    rejectionReasonLabels[selected.rejectionReason] ??
                      "staffOffers.unrecognizedValue"
                  )
                )}
            </dl>
          </section>
          {isSalesOwner && (selected.status === "DRAFT" || commercialState.dirty) && (
            <section className="space-y-3 rounded-2xl border bg-white p-5">
              <p className="text-sm text-slate-600">{t("offerFitment.coordinating")}</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  data-testid="offer-editor-commercial"
                  aria-pressed={editor === "commercial"}
                  disabled={protectedWork || loading}
                  onClick={() => switchEditor("commercial")}
                  className="min-h-11 rounded-lg border px-4 py-2 disabled:opacity-50"
                >
                  {t("offerFitment.commercialEditor")}
                </button>
                <button
                  type="button"
                  data-testid="offer-editor-fitment"
                  aria-pressed={editor === "fitment"}
                  disabled={protectedWork || loading}
                  onClick={() => switchEditor("fitment")}
                  className="min-h-11 rounded-lg border px-4 py-2 disabled:opacity-50"
                >
                  {t("offerFitment.fitmentEditor")}
                </button>
                {commercialState.dirty &&
                  !commercialState.pending &&
                  !commercialState.unknown &&
                  !readPendingOfferOperation() && (
                    <button
                      type="button"
                      data-testid="offer-commercial-discard"
                      disabled={loading}
                      onClick={() => {
                        if (
                          commercialState.pending ||
                          commercialState.unknown ||
                          readPendingOfferOperation()
                        )
                          return;
                        setCommercialEpoch((value) => value + 1);
                        setUnsaved(false);
                        setCommercialState({ dirty: false, pending: false, unknown: false });
                        setConfirmSubmit(false);
                      }}
                      className="min-h-11 rounded-lg border px-4 py-2"
                    >
                      {t("offerFitment.discardCommercial")}
                    </button>
                  )}
              </div>
            </section>
          )}
          <OfferFitmentEditor
            key={`${staff?.userId}:${offerId}:${selected.id}`}
            actorId={staff?.userId}
            offerId={offerId}
            revisionId={selected.id}
            expectedVersion={selected.version}
            saved={reviewedFitment}
            editable={selected.status === "DRAFT" && Boolean(isSalesOwner) && editor === "fitment"}
            disabled={fitmentExternallyBlocked}
            onRefresh={() => load()}
            onUnauthorized={() => router.replace("/staff/login")}
            onStateChange={reportFitmentState}
            onConflict={() => setError(t("staffOffers.conflict"))}
          />
          {isSalesOwner &&
            (selected.status === "DRAFT" ||
              commercialState.dirty ||
              commercialState.pending ||
              commercialState.unknown ||
              recoveringCommercial) && (
              <>
                {editor === "commercial" && (
                  <OfferForm
                    key={`${staff?.userId}:${selected.id}:${commercialEpoch}`}
                    revision={selected}
                    offer={offer}
                    disabled={commercialExternallyBlocked}
                    readOnly={selected.status !== "DRAFT"}
                    onStateChange={reportCommercialState}
                    onSaved={(updated) => {
                      setError(null);
                      setOffer((previous) =>
                        previous
                          ? {
                              ...previous,
                              revisions: previous.revisions?.map((item) =>
                                item.id === updated.id ? updated : item
                              ),
                            }
                          : previous
                      );
                      setReload((value) => value + 1);
                      setMessage(t("staffOffers.saved"));
                    }}
                    onReconciled={(current) => {
                      operationRef.current = null;
                      setUnknown(false);
                      setOffer((previous) =>
                        previous
                          ? {
                              ...previous,
                              revisions: previous.revisions?.map((item) =>
                                item.id === current.id ? current : item
                              ),
                            }
                          : previous
                      );
                      setUnsaved(false);
                      setMessage(null);
                      setError(t("staffOffers.conflict"));
                      setReload((value) => value + 1);
                    }}
                    onDirtyChange={(dirty) => {
                      setUnsaved(dirty);
                      if (dirty) {
                        setError(null);
                        setMessage(null);
                      }
                    }}
                    onConflict={() => {
                      setError(t("staffOffers.conflict"));
                      setReload((value) => value + 1);
                    }}
                  />
                )}
                {selected.status === "DRAFT" && (
                  <section className="rounded-2xl border bg-white p-5">
                    <h2 className="font-bold">{t("staffOffers.submitReview")}</h2>
                    <p className="mt-2 text-sm text-slate-600">{t("staffOffers.internalOnly")}</p>
                    {!fitmentReady && (
                      <p role="alert" className="mt-2 text-sm text-rose-700">
                        {t("staffOffers.fitmentBlocked")}
                      </p>
                    )}
                    {confirmSubmit ? (
                      <div className="mt-4 flex gap-3">
                        <button
                          type="button"
                          disabled={actionDisabled || unsaved || !fitmentReady}
                          onClick={() =>
                            void mutate(
                              "submit",
                              `/api/v1/staff/offers/${offerId}/revisions/${selected.id}/submit`,
                              { expectedVersion: selected.version },
                              selected
                            )
                          }
                          className="rounded-xl bg-brand-600 px-5 py-3 font-bold text-white disabled:opacity-50"
                        >
                          {t("staffOffers.submitReview")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmSubmit(false)}
                          className="rounded-xl border px-5 py-3"
                        >
                          {t("staffOffers.editAnswers")}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={actionDisabled || unsaved || !fitmentReady}
                        onClick={() => {
                          if (!actionDisabled && fitmentReady && !unsaved) setConfirmSubmit(true);
                        }}
                        className="mt-4 rounded-xl border px-5 py-3 font-semibold"
                      >
                        {t("staffOffers.checkAnswers")}
                      </button>
                    )}
                  </section>
                )}
              </>
            )}
          {selected.id === latest?.id &&
            (selected.status === "APPROVED" || selected.status === "REJECTED") &&
            isSalesOwner && (
              <button
                type="button"
                disabled={actionDisabled}
                onClick={() => {
                  const requestId = crypto.randomUUID();
                  void mutate(
                    "successor",
                    `/api/v1/staff/offers/${offerId}/revisions`,
                    { requestId },
                    selected,
                    requestId
                  );
                }}
                className="rounded-xl bg-brand-600 px-5 py-3 font-bold text-white disabled:opacity-50"
              >
                {t("staffOffers.createSuccessor")}
              </button>
            )}
          {selected.status === "PENDING_REVIEW" && canReview && (
            <section className="space-y-4 rounded-2xl border bg-white p-5">
              <h2 className="text-lg font-bold">{t("staffOffers.pendingOffers")}</h2>
              <p className="text-sm text-slate-600">{t("staffOffers.packetHelp")}</p>
              <section
                aria-label={t("staffOffers.fitmentSnapshot")}
                className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
              >
                <h3 className="font-semibold">{t("staffOffers.fitmentSnapshot")}</h3>
                <p className="text-sm">
                  {t("staffOffers.revision")} #{selected.revisionNumber} · v{selected.version}
                </p>
                {reviewedFitment ? (
                  <>
                    {detail(
                      t("staffOffers.fitmentMode"),
                      reviewedFitment.mode
                        ? t(
                            reviewedFitment.mode === "BASE_VEHICLE_ALL_VARIANTS_VERIFIED"
                              ? "staffOffers.fitmentModeAllVariants"
                              : "staffOffers.fitmentModeIndependent"
                          )
                        : null
                    )}
                    {detail(t("staffOffers.fitmentEvidence"), reviewedFitment.evidenceRef, true)}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-600">
                        {t("staffOffers.fitmentCoverage")}
                      </h4>
                      {reviewedFitment.coverage.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-2 ps-5 text-sm">
                          {reviewedFitment.coverage.map((row) => (
                            <li key={`${row.modelId}:${row.yearFrom}:${row.yearTo}`}>
                              <span>
                                {locale === "ar" ? row.make.nameAr : row.make.nameEn} ·{" "}
                                {locale === "ar" ? row.model.nameAr : row.model.nameEn}
                              </span>{" "}
                              <bdi dir="ltr">
                                {row.yearFrom}–{row.yearTo}
                              </bdi>
                              <p className="break-all text-xs text-slate-500">
                                <bdi dir="ltr">
                                  {row.makeId} / {row.modelId}
                                </bdi>
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-sm">{t("staffOffers.fitmentNoCoverage")}</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p role="status" className="text-sm">
                    {fitmentLoadError
                      ? t("staffOffers.fitmentUnavailable")
                      : t("staffOffers.loading")}
                  </p>
                )}
                {!fitmentReady && (
                  <p role="alert" className="text-sm font-semibold text-rose-700">
                    {t("staffOffers.fitmentBlocked")}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setReload((value) => value + 1)}
                  className="rounded-xl border px-4 py-2 text-sm font-semibold"
                >
                  {t("staffOffers.refresh")}
                </button>
              </section>
              <fieldset>
                <legend className="font-semibold">{t("staffOffers.checkAnswers")}</legend>
                <div className="mt-3 space-y-3">
                  {attestations.map((key) => (
                    <label key={key} className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={checks[key]}
                        disabled={!fitmentReady || actionDisabled}
                        onChange={(event) =>
                          setChecks((previous) => ({ ...previous, [key]: event.target.checked }))
                        }
                        className="mt-1"
                      />
                      {t(attestationLabels[key])}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                type="button"
                disabled={
                  actionDisabled || !fitmentReady || !attestations.every((key) => checks[key])
                }
                onClick={() =>
                  void mutate(
                    "approve",
                    `/api/v1/staff/ops/offers/${offerId}/revisions/${selected.id}/approve`,
                    {
                      expectedVersion: selected.version,
                      evidenceInspected: checks.evidenceInspected,
                      priceVerified: checks.priceVerified,
                      scopeVerified: checks.scopeVerified,
                      providerConsentVerified: checks.providerConsentVerified,
                      fitmentAllVariantsAttested: checks.fitmentAllVariantsAttested,
                      fitmentScopePriceAttested: checks.fitmentScopePriceAttested,
                    },
                    selected
                  )
                }
                className="rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50"
              >
                {t("staffOffers.approve")}
              </button>
              <div className="border-t pt-4">
                <label htmlFor="offer-reason" className="block text-sm font-semibold">
                  {t("staffOffers.reason")}
                </label>
                <select
                  id="offer-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="mt-2 rounded-xl border p-3"
                >
                  <option value="">{t("staffOffers.choose")}</option>
                  {reasons.map((item) => (
                    <option key={item} value={item}>
                      {t(rejectionReasonLabels[item])}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={actionDisabled || !reason}
                  onClick={() =>
                    void mutate(
                      "reject",
                      `/api/v1/staff/ops/offers/${offerId}/revisions/${selected.id}/reject`,
                      { expectedVersion: selected.version, reasonCode: reason },
                      selected
                    )
                  }
                  className="ms-3 rounded-xl border border-rose-400 px-5 py-3 font-semibold text-rose-700 disabled:opacity-50"
                >
                  {t("staffOffers.reject")}
                </button>
              </div>
            </section>
          )}
          {canManagePublication && (
            <section
              className="space-y-4 rounded-2xl border bg-white p-5"
              aria-label={t("staffOffers.publicationControl")}
            >
              <h2 className="text-lg font-bold">{t("staffOffers.publicationControl")}</h2>
              <p className="text-sm text-slate-600">{t("staffOffers.publicationExplanation")}</p>
              {publicationLoading && <p role="status">{t("staffOffers.loading")}</p>}
              {publication && (
                <div className="space-y-2 text-sm">
                  <p>
                    {t("staffOffers.publicationRecordedState")}:{" "}
                    <strong>
                      {t(
                        publication.status === "PUBLISHED"
                          ? "staffOffers.publicationPublished"
                          : "staffOffers.publicationUnpublished"
                      )}
                    </strong>{" "}
                    · v{publication.version}
                  </p>
                  {publication.pinnedRevisionId && (
                    <p>
                      {t("staffOffers.publicationPinnedRevision")}:{" "}
                      <bdi dir="ltr">
                        #
                        {revisions.find((item) => item.id === publication.pinnedRevisionId)
                          ?.revisionNumber ?? publication.pinnedRevisionId}
                      </bdi>
                    </p>
                  )}
                  <p>
                    {t("staffOffers.publicationEffectiveVisibility")}:{" "}
                    <strong>
                      {t(
                        publication.effectiveVisible
                          ? "staffOffers.publicationVisible"
                          : "staffOffers.publicationHidden"
                      )}
                    </strong>
                  </p>
                  {!publication.effectiveVisible && publication.hiddenReasons.length > 0 && (
                    <ul className="list-disc space-y-1 ps-5">
                      {publication.hiddenReasons
                        .filter(
                          (item) =>
                            publication.status === "PUBLISHED" ||
                            [
                              "UNPUBLISHED",
                              "GATE_DISABLED",
                              "PILOT_CLUSTER_UNSET",
                              "EVIDENCE_REPOSITORY_UNREADY",
                            ].includes(item)
                        )
                        .map((item) => (
                          <li key={item}>
                            {t(
                              publicationReasonKeys[item] ??
                                "staffOffers.publicationReasonUnavailable"
                            )}
                          </li>
                        ))}
                    </ul>
                  )}
                  <p className="text-slate-600">{t("staffOffers.publicationMayHideAgain")}</p>
                </div>
              )}
              {publicationError && <p role="alert">{publicationError}</p>}
              {publicationMessage && <p role="status">{publicationMessage}</p>}
              {publicationUnknown && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                  <p>{t("staffOffers.publicationStillUnknown")}</p>
                  {publicationRetryAvailable && publicationJournal?.offerId === offerId && (
                    <p role="status">{t("staffOffers.publicationNoReceipt")}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void reconcilePublication()}
                      disabled={publicationPending || publicationJournal?.offerId !== offerId}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
                    >
                      {t("staffOffers.publicationRecheckCommand")}
                    </button>
                    {publicationRetryAvailable && publicationJournal?.offerId === offerId && (
                      <button
                        type="button"
                        onClick={() => void retryPublication()}
                        disabled={publicationPending || !canManagePublication}
                        className="rounded-lg border border-slate-900 px-4 py-2 font-semibold disabled:opacity-50"
                      >
                        {t("staffOffers.publicationRetrySameCommand")}
                      </button>
                    )}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setPublicationReload((value) => value + 1)}
                className="rounded-xl border px-4 py-2 font-semibold"
              >
                {t("staffOffers.refresh")}
              </button>
              {publication && !publicationConfirm && (
                <div className="flex flex-wrap gap-3">
                  {selected.status === "APPROVED" &&
                    (publication.status === "UNPUBLISHED" ||
                      publication.pinnedRevisionId !== selected.id) && (
                      <button
                        type="button"
                        disabled={
                          publicationActionDisabled ||
                          publication.hiddenReasons.some((item) =>
                            [
                              "GATE_DISABLED",
                              "PILOT_CLUSTER_UNSET",
                              "EVIDENCE_REPOSITORY_UNREADY",
                            ].includes(item)
                          )
                        }
                        onClick={() =>
                          setPublicationConfirm({
                            action: publication.status === "UNPUBLISHED" ? "PUBLISH" : "REPLACE",
                            revisionId: selected.id,
                            expectedVersion: publication.version,
                          })
                        }
                        className="rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                      >
                        {t(
                          publication.status === "UNPUBLISHED"
                            ? "staffOffers.publicationPublish"
                            : "staffOffers.publicationReplace"
                        )}
                      </button>
                    )}
                  {publication.status === "PUBLISHED" && (
                    <button
                      type="button"
                      disabled={publicationActionDisabled}
                      onClick={() =>
                        setPublicationConfirm({
                          action: "UNPUBLISH",
                          expectedVersion: publication.version,
                        })
                      }
                      className="rounded-xl border border-rose-400 px-5 py-3 font-semibold text-rose-700 disabled:opacity-50"
                    >
                      {t("staffOffers.publicationWithdraw")}
                    </button>
                  )}
                </div>
              )}
              {publicationConfirm && (
                <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
                  <p className="font-semibold">{t("staffOffers.publicationConfirmTitle")}</p>
                  <p>
                    {t(
                      publicationConfirm.action === "PUBLISH"
                        ? "staffOffers.publicationConfirmPublish"
                        : publicationConfirm.action === "REPLACE"
                          ? "staffOffers.publicationConfirmReplace"
                          : "staffOffers.publicationConfirmWithdraw"
                    )}
                  </p>
                  {publicationConfirm.revisionId && (
                    <p>
                      {t("staffOffers.publicationPinnedRevision")}:{" "}
                      <bdi dir="ltr">
                        #
                        {revisions.find((item) => item.id === publicationConfirm.revisionId)
                          ?.revisionNumber ?? publicationConfirm.revisionId}
                      </bdi>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={publicationActionDisabled}
                      onClick={() => void mutatePublication(publicationConfirm)}
                      className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white disabled:opacity-50"
                    >
                      {t("staffOffers.publicationConfirmAction")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPublicationConfirm(null)}
                      className="rounded-xl border px-5 py-3 font-semibold"
                    >
                      {t("staffOffers.publicationCancel")}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
