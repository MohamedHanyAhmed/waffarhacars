"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { OfferForm } from "@/components/staff/OfferForm";
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
] as const;
const attestationLabels = {
  evidenceInspected: "staffOffers.attestEvidence",
  priceVerified: "staffOffers.attestPrice",
  scopeVerified: "staffOffers.attestScope",
  providerConsentVerified: "staffOffers.attestConsent",
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
  const [checks, setChecks] = useState<Record<(typeof attestations)[number], boolean>>({
    evidenceInspected: false,
    priceVerified: false,
    scopeVerified: false,
    providerConsentVerified: false,
  });
  const [reason, setReason] = useState("");
  const [reload, setReload] = useState(0);
  const [publication, setPublication] = useState<StaffPublicationDto | null>(null);
  const [publicationLoading, setPublicationLoading] = useState(false);
  const [publicationPending, setPublicationPending] = useState(false);
  const [publicationUnknown, setPublicationUnknown] = useState(
    () => readPendingPublicationOperation()?.offerId === offerId
  );
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
    const current = ++counter.current;
    return () => {
      if (counter.current === current) counter.current++;
    };
  }, [offerId]);

  useEffect(() => {
    const counter = publicationGeneration;
    const current = ++counter.current;
    queueMicrotask(() => {
      if (counter.current !== current) return;
      setPublication(null);
      setPublicationError(null);
      setPublicationMessage(null);
      setPublicationConfirm(null);
      setPublicationUnknown(Boolean(readPendingPublicationOperation()));
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
    async (signal?: AbortSignal) => {
      const [auth, response] = await Promise.all([
        offerApi<StaffAuthStatusResponse>("/api/v1/staff/auth/status", { signal }),
        offerApi<OfferDto>(`/api/v1/staff/offers/${offerId}`, { signal }),
      ]);
      if (signal?.aborted) return;
      if ((!auth.ok && auth.status === 401) || (!response.ok && response.status === 401))
        return router.replace("/staff/login");
      if (!auth.ok || !response.ok) {
        setOffer(null);
        setStaff(null);
        setError(!response.ok ? offerFailureMessage(response, t) : t("staffOffers.denied"));
      } else {
        setStaff(auth.data);
        setOffer(response.data);
        setSelectedId((previous) =>
          previous && response.data.revisions?.some((item) => item.id === previous)
            ? previous
            : (response.data.revisions?.[0]?.id ?? null)
        );
      }
      setLoading(false);
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
          setPublication((previous) =>
            previous && previous.offerId === offerId && previous.version > response.data.version
              ? previous
              : response.data
          );
          setPublicationError(null);
        } else if (response.status === 401) router.replace("/staff/login");
        else setPublicationError(offerFailureMessage(response, t));
      })
      .catch(() => {
        if (active && !controller.signal.aborted)
          setPublicationError(t("staffOffers.genericError"));
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
  const snapshotIdentity = selected ? `${selected.id}:${selected.version}` : null;
  useEffect(() => {
    if (attestedSnapshot.current === snapshotIdentity) return;
    attestedSnapshot.current = snapshotIdentity;
    setChecks({
      evidenceInspected: false,
      priceVerified: false,
      scopeVerified: false,
      providerConsentVerified: false,
    });
  }, [snapshotIdentity]);
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
    Boolean(publicationError) ||
    Boolean(publicationJournal) ||
    Boolean(readPendingOfferOperation());

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
        setPublicationError(t("staffOffers.publicationStillUnknown"));
        return;
      }
      clearPendingPublicationOperation(target.commandId);
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
        setPublicationError(t("staffOffers.publicationStillUnknown"));
      }
    }
  };

  const mutatePublication = async (decision: {
    action: PublicationAction;
    revisionId?: string;
    expectedVersion: number;
  }) => {
    if (publicationInFlight.current || publicationActionDisabled || !publication) return;
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
      action: decision.action,
      expectedVersion: decision.expectedVersion,
      ...(decision.revisionId ? { revisionId: decision.revisionId } : {}),
    };
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
      writePendingPublicationOperation(operation);
    } catch {
      publicationInFlight.current = false;
      setPublicationPending(false);
      setPublicationError(t("staffOffers.storageUnavailable"));
      return;
    }
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
        if (response.status === 401) {
          clearPendingPublicationOperation(operation.commandId);
          return router.replace("/staff/login");
        }
        if (mutationOutcomeUnknown(response.status)) {
          setPublicationUnknown(true);
          setPublicationError(t("staffOffers.publicationStillUnknown"));
          return;
        }
        if (response.status === 409 || response.status === 422) {
          await reconcilePublication(operation);
          return;
        }
        clearPendingPublicationOperation(operation.commandId);
        setPublicationError(offerFailureMessage(response, t));
        return;
      }
      clearPendingPublicationOperation(operation.commandId);
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
        setPublicationError(t("staffOffers.publicationStillUnknown"));
      }
    } finally {
      publicationInFlight.current = false;
      if (publicationGeneration.current === currentGeneration) setPublicationPending(false);
    }
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
    if (inFlight.current || actionDisabled) return;
    if (
      (kind === "approve" || kind === "reject") &&
      attestedSnapshot.current !== `${revision.id}:${revision.version}`
    ) {
      setError(t("staffOffers.conflict"));
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
    try {
      const response = await offerApi<OfferRevisionDto>(url, {
        method: "POST",
        body: JSON.stringify(body),
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
      setSelectedId(response.data.id);
      setReload((value) => value + 1);
    } catch {
      if (ownsCurrentOperation()) markUnknown(operation);
    } finally {
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
                  setSelectedId(event.target.value);
                  setUnsaved(false);
                  setChecks({
                    evidenceInspected: false,
                    priceVerified: false,
                    scopeVerified: false,
                    providerConsentVerified: false,
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
          {selected.status === "DRAFT" && isSalesOwner && (
            <>
              <OfferForm
                key={`${selected.id}-${selected.version}`}
                revision={selected}
                offer={offer}
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
                  setUnsaved(false);
                  setReload((value) => value + 1);
                }}
              />
              <section className="rounded-2xl border bg-white p-5">
                <h2 className="font-bold">{t("staffOffers.submitReview")}</h2>
                <p className="mt-2 text-sm text-slate-600">{t("staffOffers.internalOnly")}</p>
                {confirmSubmit ? (
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      disabled={actionDisabled || unsaved}
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
                    disabled={actionDisabled || unsaved}
                    onClick={() => setConfirmSubmit(true)}
                    className="mt-4 rounded-xl border px-5 py-3 font-semibold"
                  >
                    {t("staffOffers.checkAnswers")}
                  </button>
                )}
              </section>
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
              <fieldset>
                <legend className="font-semibold">{t("staffOffers.checkAnswers")}</legend>
                <div className="mt-3 space-y-3">
                  {attestations.map((key) => (
                    <label key={key} className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={checks[key]}
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
                disabled={actionDisabled || !attestations.every((key) => checks[key])}
                onClick={() =>
                  void mutate(
                    "approve",
                    `/api/v1/staff/ops/offers/${offerId}/revisions/${selected.id}/approve`,
                    {
                      expectedVersion: selected.version,
                      evidenceInspected: true,
                      priceVerified: true,
                      scopeVerified: true,
                      providerConsentVerified: true,
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
                  <button
                    type="button"
                    onClick={() => void reconcilePublication()}
                    disabled={publicationJournal?.offerId !== offerId}
                    className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
                  >
                    {t("staffOffers.publicationRecheckCommand")}
                  </button>
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
