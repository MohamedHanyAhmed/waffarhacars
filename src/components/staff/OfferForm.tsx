"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import type { ProviderOrganizationDto } from "@/lib/provider/dto";
import {
  cairoInputToUtc,
  clearPendingOfferOperation,
  editReconciliationAdvanced,
  egpToMinor,
  minorToEgp,
  offerDiscountBps,
  ownsPendingOfferCallback,
  readPendingOfferOperation,
  utcToCairoInput,
  writePendingOfferOperation,
  type OfferDraftPayload,
  type OfferDto,
  type OfferRevisionDto,
  type ServiceCategoryDto,
} from "@/lib/offer/client";
import { offerApi, offerFailureMessage, mutationOutcomeUnknown } from "@/lib/offer/client-api";

type FieldName =
  | "titleEn"
  | "titleAr"
  | "includedLaborEn"
  | "includedLaborAr"
  | "includedPartsEn"
  | "includedPartsAr"
  | "excludedLaborEn"
  | "excludedLaborAr"
  | "excludedPartsEn"
  | "excludedPartsAr"
  | "bookingRule"
  | "durationMinutes"
  | "validFrom"
  | "validUntil"
  | "normalPriceMinor"
  | "customerPriceMinor"
  | "evidencePacketId"
  | "evidenceType"
  | "evidenceDate"
  | "priceBasisNotes"
  | "commercialTermsPacketId"
  | "commercialTermsAgreedAt"
  | "commissionRateBps";

type FormValues = Record<FieldName, string>;

const emptyForm: FormValues = {
  titleEn: "",
  titleAr: "",
  includedLaborEn: "",
  includedLaborAr: "",
  includedPartsEn: "",
  includedPartsAr: "",
  excludedLaborEn: "",
  excludedLaborAr: "",
  excludedPartsEn: "",
  excludedPartsAr: "",
  bookingRule: "APPOINTMENT_REQUIRED",
  durationMinutes: "",
  validFrom: "",
  validUntil: "",
  normalPriceMinor: "",
  customerPriceMinor: "",
  evidencePacketId: "",
  evidenceType: "PROVIDER_PRICE_LIST",
  evidenceDate: "",
  priceBasisNotes: "",
  commercialTermsPacketId: "",
  commercialTermsAgreedAt: "",
  commissionRateBps: "",
};

function initialValues(revision?: OfferRevisionDto): FormValues {
  if (!revision) return emptyForm;
  return {
    titleEn: revision.titleEn,
    titleAr: revision.titleAr,
    includedLaborEn: revision.includedLaborEn,
    includedLaborAr: revision.includedLaborAr,
    includedPartsEn: revision.includedPartsEn,
    includedPartsAr: revision.includedPartsAr,
    excludedLaborEn: revision.excludedLaborEn,
    excludedLaborAr: revision.excludedLaborAr,
    excludedPartsEn: revision.excludedPartsEn,
    excludedPartsAr: revision.excludedPartsAr,
    bookingRule: revision.bookingRule,
    durationMinutes: String(revision.durationMinutes),
    validFrom: utcToCairoInput(revision.validFrom),
    validUntil: utcToCairoInput(revision.validUntil),
    normalPriceMinor: minorToEgp(revision.normalPriceMinor),
    customerPriceMinor: minorToEgp(revision.customerPriceMinor),
    evidencePacketId: revision.evidencePacketId,
    evidenceType: revision.evidenceType,
    evidenceDate: utcToCairoInput(revision.evidenceDate),
    priceBasisNotes: revision.priceBasisNotes,
    commercialTermsPacketId: revision.commercialTermsPacketId,
    commercialTermsAgreedAt: utcToCairoInput(revision.commercialTermsAgreedAt),
    commissionRateBps: String(revision.commissionRateBps),
  };
}

const textFields: Array<{ key: FieldName; multiline?: boolean; latin?: boolean }> = [
  { key: "titleEn", latin: true },
  { key: "titleAr" },
  { key: "includedLaborEn", multiline: true, latin: true },
  { key: "includedLaborAr", multiline: true },
  { key: "includedPartsEn", multiline: true, latin: true },
  { key: "includedPartsAr", multiline: true },
  { key: "excludedLaborEn", multiline: true, latin: true },
  { key: "excludedLaborAr", multiline: true },
  { key: "excludedPartsEn", multiline: true, latin: true },
  { key: "excludedPartsAr", multiline: true },
];

export function OfferForm({
  revision,
  offer,
  onSaved,
  onReconciled,
  onDirtyChange,
  onConflict,
  disabled = false,
  readOnly = false,
  onStateChange,
}: {
  revision?: OfferRevisionDto;
  offer?: OfferDto;
  onSaved?: (updated: OfferRevisionDto) => void;
  onReconciled?: (updated: OfferRevisionDto) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onConflict?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
  onStateChange?: (state: { dirty: boolean; pending: boolean; unknown: boolean }) => void;
}) {
  const { t, locale, dir } = useI18n();
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => initialValues(revision));
  const [providerId, setProviderId] = useState(offer?.providerOrganizationId ?? "");
  const [branchId, setBranchId] = useState(offer?.branchId ?? "");
  const [serviceId, setServiceId] = useState(offer?.serviceDefinitionId ?? "");
  const [providers, setProviders] = useState<ProviderOrganizationDto[]>([]);
  const [categories, setCategories] = useState<ServiceCategoryDto[]>([]);
  const [loading, setLoading] = useState(!revision);
  const [stage, setStage] = useState<"edit" | "check">("edit");
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [baseVersion, setBaseVersion] = useState(revision?.version);
  const stale = Boolean(revision && revision.version !== baseVersion);
  const reportState = useRef(onStateChange);
  reportState.current = onStateChange;
  useEffect(() => {
    reportState.current?.({ dirty, pending, unknown });
  }, [dirty, pending, unknown]);

  useEffect(() => {
    if (!revision || dirty || pending || unknown || revision.version === baseVersion) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setValues(initialValues(revision));
      setBaseVersion(revision.version);
      setStage("edit");
    });
    return () => {
      active = false;
    };
  }, [revision, dirty, pending, unknown, baseVersion]);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [, setManual] = useState(false);
  const frozen = useRef<{
    payload: OfferDraftPayload;
    creationRequestId: string;
    revisionRequestId: string;
  } | null>(null);
  const intentIds = useRef({
    creationRequestId: crypto.randomUUID(),
    revisionRequestId: crypto.randomUUID(),
  });
  const inFlight = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  useEffect(() => {
    const counter = generation;
    const current = ++counter.current;
    return () => {
      if (counter.current === current) counter.current++;
    };
  }, [revision?.id, offer?.id]);

  useEffect(() => {
    const journal = readPendingOfferOperation();
    if (journal) {
      setUnknown(true);
      setError(t("staffOffers.unknown"));
      const belongsHere = revision
        ? journal.kind === "edit" &&
          journal.offerId === offer?.id &&
          journal.revisionId === revision.id
        : journal.kind === "create" && Boolean(journal.creationRequestId);
      if (!belongsHere) setManual(true);
      if (journal.creationRequestId && journal.revisionRequestId) {
        intentIds.current = {
          creationRequestId: journal.creationRequestId,
          revisionRequestId: journal.revisionRequestId,
        };
      }
    }
  }, [revision, offer?.id, t]);

  useEffect(() => {
    if (revision) return;
    const controller = new AbortController();
    async function loadChoices() {
      try {
        const [providerResult, catalogResult] = await Promise.all([
          offerApi<ProviderOrganizationDto[]>("/api/v1/staff/providers", {
            signal: controller.signal,
          }),
          offerApi<ServiceCategoryDto[]>("/api/v1/staff/catalog/services", {
            signal: controller.signal,
          }),
        ]);
        if (controller.signal.aborted) return;
        if (
          (!providerResult.ok && providerResult.status === 401) ||
          (!catalogResult.ok && catalogResult.status === 401)
        ) {
          router.replace("/staff/login");
          return;
        }
        if (!providerResult.ok || !catalogResult.ok) {
          setError(
            !providerResult.ok
              ? offerFailureMessage(providerResult, t)
              : !catalogResult.ok
                ? offerFailureMessage(catalogResult, t)
                : t("staffOffers.genericError")
          );
          return;
        }
        setProviders(providerResult.data);
        setCategories(catalogResult.data);
      } catch {
        if (!controller.signal.aborted) setError(t("staffOffers.genericError"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadChoices();
    return () => controller.abort();
  }, [revision, router, t]);

  const provider = providers.find((item) => item.id === providerId);
  const activeProviders = providers.filter((item) => item.status === "ACTIVE");
  const eligibleBranches =
    provider?.branches.filter(
      (branch) =>
        branch.status === "ACTIVE" &&
        branch.legalIdentityChecked &&
        branch.physicalLocationChecked &&
        branch.contactAndHoursChecked &&
        Boolean(branch.vettedByUserId && branch.vettedAt)
    ) ?? [];
  const eligibleServices = categories
    .filter((category) => category.isActive && category.code !== "GENERAL_REPAIRS")
    .flatMap((category) =>
      category.definitions.filter(
        (definition) => definition.isActive && definition.pricingMode === "FIXED_SCOPE"
      )
    );
  const selectedService = eligibleServices.find((service) => service.id === serviceId);

  const change = (key: FieldName, value: string) => {
    if (disabled || readOnly || pending || unknown || stale) return;
    setDirty(true);
    onDirtyChange?.(true);
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: "" }));
    setMessage(null);
  };

  const validate = (): OfferDraftPayload | null => {
    const issues: Record<string, string> = {};
    if (!revision && !activeProviders.some((item) => item.id === providerId))
      issues.provider = t("staffOffers.requiredField");
    if (!revision && !eligibleBranches.some((item) => item.id === branchId))
      issues.branch = t("staffOffers.requiredField");
    if (!revision && !selectedService) issues.service = t("staffOffers.requiredField");
    for (const field of textFields)
      if (!values[field.key].trim()) issues[field.key] = t("staffOffers.requiredField");
    if (!values.priceBasisNotes.trim()) issues.priceBasisNotes = t("staffOffers.requiredField");
    for (const key of ["evidencePacketId", "commercialTermsPacketId"] as const) {
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(values[key].trim()))
        issues[key] = t("staffOffers.evidenceMissing");
    }
    const normal = egpToMinor(values.normalPriceMinor);
    const customer = egpToMinor(values.customerPriceMinor);
    if (!normal) issues.normalPriceMinor = t("staffOffers.moneyInvalid");
    if (!customer) issues.customerPriceMinor = t("staffOffers.moneyInvalid");
    if (normal && customer && (BigInt(customer) <= 0n || BigInt(customer) >= BigInt(normal)))
      issues.customerPriceMinor = t("staffOffers.priceInvalid");
    const validFrom = cairoInputToUtc(values.validFrom);
    const validUntil = cairoInputToUtc(values.validUntil);
    const evidenceDate = cairoInputToUtc(values.evidenceDate);
    const agreedAt = cairoInputToUtc(values.commercialTermsAgreedAt);
    for (const [name, date] of [
      ["validFrom", validFrom],
      ["validUntil", validUntil],
      ["evidenceDate", evidenceDate],
      ["commercialTermsAgreedAt", agreedAt],
    ] as const) {
      if (!date) issues[name] = t("staffOffers.dateInvalid");
    }
    if (validFrom && validUntil && validUntil <= validFrom)
      issues.validUntil = t("staffOffers.dateInvalid");
    const duration = Number(values.durationMinutes);
    if (
      !/^\d+$/.test(values.durationMinutes) ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 1440
    )
      issues.durationMinutes = t("staffOffers.validation");
    const commission = Number(values.commissionRateBps);
    if (
      !/^\d+$/.test(values.commissionRateBps) ||
      !Number.isInteger(commission) ||
      commission < 0 ||
      commission > 10000
    )
      issues.commissionRateBps = t("staffOffers.validation");
    setErrors(issues);
    if (Object.keys(issues).length) {
      setError(t("staffOffers.validation"));
      queueMicrotask(() => summaryRef.current?.focus());
      return null;
    }
    return {
      titleEn: values.titleEn.trim(),
      titleAr: values.titleAr.trim(),
      includedLaborEn: values.includedLaborEn.trim(),
      includedLaborAr: values.includedLaborAr.trim(),
      includedPartsEn: values.includedPartsEn.trim(),
      includedPartsAr: values.includedPartsAr.trim(),
      excludedLaborEn: values.excludedLaborEn.trim(),
      excludedLaborAr: values.excludedLaborAr.trim(),
      excludedPartsEn: values.excludedPartsEn.trim(),
      excludedPartsAr: values.excludedPartsAr.trim(),
      bookingRule: values.bookingRule as OfferDraftPayload["bookingRule"],
      durationMinutes: duration,
      validFrom: validFrom!,
      validUntil: validUntil!,
      normalPriceMinor: normal!,
      customerPriceMinor: customer!,
      evidencePacketId: values.evidencePacketId.trim(),
      evidenceType: values.evidenceType,
      evidenceDate: evidenceDate!,
      priceBasisNotes: values.priceBasisNotes.trim(),
      commercialTermsPacketId: values.commercialTermsPacketId.trim(),
      commercialTermsAgreedAt: agreedAt!,
      commissionBasis: "DISCOUNTED_CUSTOMER_PRICE",
      commissionRateBps: commission,
    };
  };

  const check = (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || readOnly || pending || unknown || stale) return;
    if (validate()) {
      setError(null);
      setStage("check");
    }
  };

  const save = async () => {
    if (disabled || readOnly || stale || inFlight.current || unknown || stage !== "check") return;
    const existing = readPendingOfferOperation();
    if (existing) {
      setUnknown(true);
      setManual(true);
      setError(t("staffOffers.manual"));
      return;
    }
    const payload = frozen.current?.payload ?? validate();
    if (!payload) {
      setStage("edit");
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    if (!revision && !frozen.current) frozen.current = { payload, ...intentIds.current };
    const url = revision
      ? `/api/v1/staff/offers/${offer?.id}/revisions/${revision.id}`
      : "/api/v1/staff/offers";
    const operation = revision
      ? {
          operationId: crypto.randomUUID(),
          kind: "edit" as const,
          offerId: offer!.id,
          revisionId: revision.id,
          expectedVersion: revision.version,
          unresolved: true as const,
        }
      : {
          operationId: crypto.randomUUID(),
          kind: "create" as const,
          ...intentIds.current,
          unresolved: true as const,
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
    try {
      const result = await offerApi<
        OfferRevisionDto | { offer: OfferDto; revision: OfferRevisionDto }
      >(url, {
        method: revision ? "PATCH" : "POST",
        body: JSON.stringify(
          revision
            ? { expectedVersion: revision.version, fields: payload }
            : {
                creationRequestId: intentIds.current.creationRequestId,
                revisionRequestId: intentIds.current.revisionRequestId,
                providerOrganizationId: providerId,
                branchId,
                serviceDefinitionId: serviceId,
                fields: frozen.current!.payload,
              }
        ),
      });
      if (!ownsCurrentOperation()) return;
      if (!result.ok) {
        if (result.status === 401) {
          clearPendingOfferOperation(operation.operationId);
          return router.replace("/staff/login");
        }
        if (mutationOutcomeUnknown(result.status)) {
          setUnknown(true);
          setError(t("staffOffers.unknown"));
          return;
        }
        if (result.status === 409) {
          clearPendingOfferOperation(operation.operationId);
          frozen.current = null;
          intentIds.current = {
            creationRequestId: crypto.randomUUID(),
            revisionRequestId: crypto.randomUUID(),
          };
          setError(t("staffOffers.conflict"));
          setStage("edit");
          onConflict?.();
          return;
        }
        clearPendingOfferOperation(operation.operationId);
        frozen.current = null;
        intentIds.current = {
          creationRequestId: crypto.randomUUID(),
          revisionRequestId: crypto.randomUUID(),
        };
        setError(offerFailureMessage(result, t));
        setErrors(
          Object.fromEntries(
            result.details.map((item) => [
              item.path.replace(/^fields\./, ""),
              t("staffOffers.validation"),
            ])
          )
        );
        setStage("edit");
        return;
      }
      clearPendingOfferOperation(operation.operationId);
      if (revision) {
        setBaseVersion((result.data as OfferRevisionDto).version);
        setDirty(false);
        onSaved?.(result.data as OfferRevisionDto);
        onDirtyChange?.(false);
        setStage("edit");
      } else router.push(`/staff/offers/${(result.data as { offer: OfferDto }).offer.id}`);
    } catch {
      if (ownsCurrentOperation()) {
        setUnknown(true);
        setError(t("staffOffers.unknown"));
      }
    } finally {
      inFlight.current = false;
      if (generation.current === currentGeneration) setPending(false);
    }
  };

  const reconcile = async () => {
    if (disabled || pending) return;
    const journal = readPendingOfferOperation();
    const belongsHere = revision
      ? journal?.kind === "edit" &&
        journal.offerId === offer?.id &&
        journal.revisionId === revision.id
      : journal?.kind === "create" &&
        journal.creationRequestId === intentIds.current.creationRequestId;
    if (!journal || !belongsHere) {
      setManual(true);
      setError(t("staffOffers.manual"));
      return;
    }
    const currentGeneration = generation.current;
    const stillOwned = () =>
      ownsPendingOfferCallback(journal.operationId, currentGeneration, generation.current);
    try {
      if (revision && offer) {
        const result = await offerApi<OfferDto>(`/api/v1/staff/offers/${offer.id}`);
        if (!stillOwned()) return;
        if (result.ok) {
          const current = result.data.revisions?.find((item) => item.id === revision.id);
          if (
            current &&
            editReconciliationAdvanced(journal, offer.id, revision.id, current.version)
          ) {
            clearPendingOfferOperation(journal.operationId);
            setUnknown(false);
            setDirty(false);
            setValues(initialValues(current));
            setBaseVersion(current.version);
            onDirtyChange?.(false);
            setManual(false);
            setError(t("staffOffers.conflict"));
            onReconciled?.(current);
            return;
          }
        }
      } else {
        const result = await offerApi<OfferRevisionDto[]>("/api/v1/staff/offers");
        if (!stillOwned()) return;
        if (result.ok) {
          const match = result.data.find(
            (item) => item.offer?.creationRequestId === journal.creationRequestId
          );
          if (match) {
            clearPendingOfferOperation(journal.operationId);
            router.push(`/staff/offers/${match.offerId}`);
            return;
          }
        }
      }
      setManual(true);
      setError(t("staffOffers.manual"));
    } catch {
      if (stillOwned()) setError(t("staffOffers.manual"));
    }
  };

  const input = (key: FieldName, type = "text", multiline = false, latin = false) => (
    <div className="space-y-1" key={key}>
      <label htmlFor={`offer-${key}`} className="block text-sm font-semibold text-slate-700">
        {t(`staffOffers.${key}`)} <span className="text-rose-700">*</span>
      </label>
      {multiline ? (
        <textarea
          id={`offer-${key}`}
          rows={3}
          required
          value={values[key]}
          dir={latin ? "ltr" : key.endsWith("Ar") ? "rtl" : undefined}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `offer-${key}-error` : undefined}
          onChange={(event) => change(key, event.target.value)}
          className="w-full rounded-xl border border-slate-300 p-3 focus-visible:ring-2 focus-visible:ring-brand-500"
        />
      ) : (
        <input
          id={`offer-${key}`}
          type={type}
          required
          value={values[key]}
          dir={latin ? "ltr" : key.endsWith("Ar") ? "rtl" : undefined}
          inputMode={key.includes("Price") || key === "commissionRateBps" ? "decimal" : undefined}
          aria-invalid={Boolean(errors[key])}
          aria-describedby={errors[key] ? `offer-${key}-error` : undefined}
          onChange={(event) => change(key, event.target.value)}
          className="w-full rounded-xl border border-slate-300 p-3 focus-visible:ring-2 focus-visible:ring-brand-500"
        />
      )}
      {errors[key] && (
        <p id={`offer-${key}-error`} className="text-sm text-rose-700">
          {errors[key]}
        </p>
      )}
    </div>
  );

  const normal = egpToMinor(values.normalPriceMinor);
  const customer = egpToMinor(values.customerPriceMinor);
  const discount = normal && customer ? offerDiscountBps(normal, customer) : null;
  const checkAnswerValue = (key: FieldName): string => {
    if (key === "bookingRule") {
      return t(
        {
          APPOINTMENT_REQUIRED: "staffOffers.appointment",
          WALK_IN_ALLOWED: "staffOffers.walkIn",
          CONTACT_TO_BOOK: "staffOffers.contact",
        }[values.bookingRule] ?? "staffOffers.validation"
      );
    }
    if (key === "evidenceType") {
      return t(
        {
          PROVIDER_PRICE_LIST: "staffOffers.evidenceProviderPriceList",
          WRITTEN_QUOTE: "staffOffers.evidenceWrittenQuote",
          PROVIDER_WRITTEN_CONFIRMATION: "staffOffers.evidenceProviderWrittenConfirmation",
          OTHER: "staffOffers.evidenceOther",
        }[values.evidenceType] ?? "staffOffers.validation"
      );
    }
    return values[key];
  };

  return (
    <div className="space-y-6" dir={dir}>
      {loading && <p role="status">{t("staffOffers.loading")}</p>}
      {stale && <p role="alert">{t("staffOffers.conflict")}</p>}
      {error && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900"
        >
          <p className="font-bold">{error}</p>
          <ul className="mt-2 list-disc ps-5">
            {Object.keys(errors)
              .filter((key) => errors[key])
              .map((key) => (
                <li key={key}>
                  <a href={`#offer-${key}`} className="underline">
                    {t(`staffOffers.${key}`)}
                  </a>
                </li>
              ))}
          </ul>
        </div>
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
            data-testid="offer-commercial-recheck"
            disabled={disabled || pending}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-white"
          >
            {t("staffOffers.reconcile")}
          </button>
        </div>
      )}
      {stage === "check" ? (
        <section
          className="space-y-5 rounded-2xl border bg-white p-5"
          aria-label={t("staffOffers.checkAnswers")}
        >
          <h2 className="text-xl font-bold">{t("staffOffers.checkAnswers")}</h2>
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            {textFields.map(({ key }) => (
              <div key={key}>
                <dt className="font-semibold">{t(`staffOffers.${key}`)}</dt>
                <dd className="whitespace-pre-wrap">{values[key]}</dd>
              </div>
            ))}
            {(
              [
                "normalPriceMinor",
                "customerPriceMinor",
                "validFrom",
                "validUntil",
                "bookingRule",
                "durationMinutes",
                "evidencePacketId",
                "evidenceType",
                "evidenceDate",
                "priceBasisNotes",
                "commercialTermsPacketId",
                "commercialTermsAgreedAt",
                "commissionRateBps",
              ] as FieldName[]
            ).map((key) => (
              <div key={key}>
                <dt className="font-semibold">{t(`staffOffers.${key}`)}</dt>
                <dd>
                  <bdi dir={key === "bookingRule" || key === "evidenceType" ? dir : "ltr"}>
                    {checkAnswerValue(key)}
                  </bdi>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-slate-600">{t("staffOffers.internalOnly")}</p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={
                disabled || readOnly || stale || pending || unknown || Boolean(frozen.current)
              }
              onClick={() => {
                if (!disabled && !readOnly && !stale && !pending && !unknown) setStage("edit");
              }}
              className="rounded-xl border px-5 py-3"
            >
              {t("staffOffers.editAnswers")}
            </button>
            <button
              type="button"
              disabled={disabled || readOnly || stale || pending || unknown}
              onClick={save}
              className="rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              {pending ? t("staffOffers.saving") : t("staffOffers.saveDraft")}
            </button>
          </div>
        </section>
      ) : (
        <form onSubmit={check} className="space-y-6">
          <fieldset
            disabled={disabled || readOnly || pending || unknown || stale}
            className="rounded-2xl border bg-white p-5 space-y-4"
          >
            <legend className="px-2 text-lg font-bold">{t("staffOffers.locationSection")}</legend>
            {revision ? (
              <p className="text-sm text-slate-600">
                {locale === "ar"
                  ? offer?.providerOrganization?.nameAr
                  : offer?.providerOrganization?.nameEn}{" "}
                — {locale === "ar" ? offer?.branch?.nameAr : offer?.branch?.nameEn}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="offer-provider" className="block text-sm font-semibold">
                    {t("staffOffers.provider")}
                  </label>
                  <select
                    id="offer-provider"
                    required
                    value={providerId}
                    onChange={(event) => {
                      setProviderId(event.target.value);
                      setBranchId("");
                    }}
                    className="mt-1 w-full rounded-xl border p-3"
                  >
                    <option value="">{t("staffOffers.choose")}</option>
                    {activeProviders.map((item) => (
                      <option key={item.id} value={item.id}>
                        {locale === "ar" ? item.nameAr : item.nameEn}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="offer-branch" className="block text-sm font-semibold">
                    {t("staffOffers.branch")}
                  </label>
                  <select
                    id="offer-branch"
                    required
                    value={branchId}
                    onChange={(event) => setBranchId(event.target.value)}
                    className="mt-1 w-full rounded-xl border p-3"
                  >
                    <option value="">{t("staffOffers.choose")}</option>
                    {eligibleBranches.map((item) => (
                      <option key={item.id} value={item.id}>
                        {locale === "ar" ? item.nameAr : item.nameEn}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="offer-service" className="block text-sm font-semibold">
                    {t("staffOffers.service")}
                  </label>
                  <select
                    id="offer-service"
                    required
                    value={serviceId}
                    onChange={(event) => setServiceId(event.target.value)}
                    className="mt-1 w-full rounded-xl border p-3"
                  >
                    <option value="">{t("staffOffers.choose")}</option>
                    {eligibleServices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {locale === "ar" ? item.nameAr : item.nameEn}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </fieldset>
          <fieldset
            disabled={disabled || readOnly || pending || unknown || stale}
            className="rounded-2xl border bg-white p-5"
          >
            <legend className="px-2 text-lg font-bold">{t("staffOffers.scopeSection")}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {textFields.map(({ key, multiline, latin }) => input(key, "text", multiline, latin))}
            </div>
          </fieldset>
          <fieldset
            disabled={disabled || readOnly || pending || unknown || stale}
            className="rounded-2xl border bg-white p-5"
          >
            <legend className="px-2 text-lg font-bold">{t("staffOffers.priceSection")}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="offer-bookingRule" className="block text-sm font-semibold">
                  {t("staffOffers.bookingRule")}
                </label>
                <select
                  id="offer-bookingRule"
                  value={values.bookingRule}
                  onChange={(event) => change("bookingRule", event.target.value)}
                  className="mt-1 w-full rounded-xl border p-3"
                >
                  <option value="APPOINTMENT_REQUIRED">{t("staffOffers.appointment")}</option>
                  <option value="WALK_IN_ALLOWED">{t("staffOffers.walkIn")}</option>
                  <option value="CONTACT_TO_BOOK">{t("staffOffers.contact")}</option>
                </select>
              </div>
              {input("durationMinutes", "number", false, true)}
              {input("validFrom", "datetime-local", false, true)}
              {input("validUntil", "datetime-local", false, true)}
              {input("normalPriceMinor", "text", false, true)}
              {input("customerPriceMinor", "text", false, true)}
            </div>
            {normal && customer && discount && (
              <p className="mt-4 text-sm" role="status">
                {t("staffOffers.savings")}:{" "}
                <bdi dir="ltr">
                  EGP {minorToEgp((BigInt(normal) - BigInt(customer)).toString())}
                </bdi>{" "}
                · {t("staffOffers.discount")}:{" "}
                <bdi dir="ltr">
                  {(BigInt(discount) / 100n).toString()}.
                  {(BigInt(discount) % 100n).toString().padStart(2, "0")}%
                </bdi>
              </p>
            )}
          </fieldset>
          <fieldset
            disabled={disabled || readOnly || pending || unknown || stale}
            className="rounded-2xl border bg-white p-5"
          >
            <legend className="px-2 text-lg font-bold">{t("staffOffers.evidenceSection")}</legend>
            <p className="mb-4 text-sm text-slate-600">{t("staffOffers.packetHelp")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {input("evidencePacketId", "text", false, true)}
              <div>
                <label htmlFor="offer-evidenceType" className="block text-sm font-semibold">
                  {t("staffOffers.evidenceType")}
                </label>
                <select
                  id="offer-evidenceType"
                  value={values.evidenceType}
                  onChange={(event) => change("evidenceType", event.target.value)}
                  className="mt-1 w-full rounded-xl border p-3"
                >
                  <option value="PROVIDER_PRICE_LIST">
                    {t("staffOffers.evidenceProviderPriceList")}
                  </option>
                  <option value="WRITTEN_QUOTE">{t("staffOffers.evidenceWrittenQuote")}</option>
                  <option value="PROVIDER_WRITTEN_CONFIRMATION">
                    {t("staffOffers.evidenceProviderWrittenConfirmation")}
                  </option>
                  <option value="OTHER">{t("staffOffers.evidenceOther")}</option>
                </select>
              </div>
              {input("evidenceDate", "datetime-local", false, true)}
              {input("priceBasisNotes", "text")}
              {input("commercialTermsPacketId", "text", false, true)}
              {input("commercialTermsAgreedAt", "datetime-local", false, true)}
              {input("commissionRateBps", "number", false, true)}
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={disabled || readOnly || stale || pending || unknown || loading}
            className="rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            {t("staffOffers.checkAnswers")}
          </button>
        </form>
      )}
    </div>
  );
}
