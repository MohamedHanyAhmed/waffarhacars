"use client";

import { use, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import FitmentCoverageEditor from "@/components/staff/FitmentCoverageEditor";
import { useCapabilityCommand } from "@/components/staff/useCapabilityCommand";
import { protectCapabilityNavigation } from "@/components/staff/CapabilityNavigationBoundary";
import { offerApi } from "@/lib/offer/client-api";
import type { ServiceCategoryDto } from "@/lib/offer/client";
import type { StaffAuthStatusResponse } from "@/lib/staff/status-contract";
import type { ProviderOrganizationDto } from "@/lib/provider/dto";
import type { CapabilityAction, CapabilityPolicy, CapabilityWorkspace } from "@/lib/fitment/client";
import {
  maximumCoveredYear,
  validateCoverageRows,
  validateEvidenceReference,
  validateRejectionReason,
  type CoverageRow,
} from "@/lib/fitment/client-validation";

type Loaded = {
  actorId: string;
  workspace: CapabilityWorkspace;
  categories: ServiceCategoryDto[];
  provider: { nameEn: string; nameAr: string };
  branch: { nameEn: string; nameAr: string };
};
type Form = {
  categoryId: string;
  evidenceRef: string;
  coverage: CoverageRow[];
  version: number | null;
};
const newForm = (): Form => ({
  categoryId: "",
  evidenceRef: "",
  version: null,
  coverage: [
    {
      makeId: "",
      modelId: "",
      yearFrom: maximumCoveredYear() - 1,
      yearTo: maximumCoveredYear() - 1,
    },
  ],
});
const fromPolicy = (policy: CapabilityPolicy): Form => ({
  categoryId: policy.categoryId,
  evidenceRef: policy.evidenceRef ?? "",
  version: policy.version,
  coverage: policy.coverage.map(({ makeId, modelId, yearFrom, yearTo }) => ({
    makeId,
    modelId,
    yearFrom,
    yearTo,
  })),
});
const button =
  "min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium disabled:opacity-50";
const primary = `${button} border-blue-700 bg-blue-700 text-white`;
const input =
  "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100";

export default function BranchCapabilitiesPage({
  params,
}: {
  params: Promise<{ id: string; branchId: string }>;
}) {
  const { id, branchId } = use(params);
  return <Workspace key={`${id}:${branchId}`} providerId={id} branchId={branchId} />;
}

function Workspace({ providerId, branchId }: { providerId: string; branchId: string }) {
  const { t, locale, dir } = useI18n();
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [readBusy, setReadBusy] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(newForm);
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const [restore, setRestore] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    action: "APPROVE" | "REJECT" | "WITHDRAW";
    snapshot: string;
  } | null>(null);
  const loadGeneration = useRef(0);
  const readControllers = useRef(new Set<AbortController>());
  const pageMounted = useRef(true);
  const actor = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const selectionRef = useRef<string | null>(null);
  const handledReceipt = useRef<string | null>(null);
  const validationElement = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    dirtyRef.current = dirty || reason.length > 0;
    selectionRef.current = selection;
  }, [dirty, selection, reason]);

  const onUnauthorized = useCallback(() => router.replace("/staff/login"), [router]);
  const refresh = useCallback(async (): Promise<boolean> => {
    const generation = ++loadGeneration.current;
    for (const pending of readControllers.current) pending.abort();
    readControllers.current.clear();
    const controller = new AbortController();
    readControllers.current.add(controller);
    const deadline = setTimeout(() => controller.abort(), 12_000);
    setReadBusy(true);
    setReadError(null);
    setAttestation(null);
    setConfirmation(null);
    try {
      const auth = await offerApi<StaffAuthStatusResponse>("/api/v1/staff/auth/status", {
        signal: controller.signal,
      });
      if (generation !== loadGeneration.current) return false;
      if (controller.signal.aborted) throw new Error("READ_UNAVAILABLE");
      if (!auth.ok) {
        if (auth.status === 401) onUnauthorized();
        setData(null);
        setForm(newForm());
        setReason("");
        setDirty(false);
        setRestore(false);
        setReadError(auth.status === 401 ? "capabilities.authentication" : "capabilities.denied");
        return false;
      }
      if (auth.data.state !== "ACTIVE" || !auth.data.canAccessStaffApp || !auth.data.userId) {
        setData(null);
        setReadError("capabilities.denied");
        return false;
      }
      const actorChanged = Boolean(actor.current && actor.current !== auth.data.userId);
      if (actorChanged) {
        setData(null);
        setSelection(null);
        setForm(newForm());
        setDirty(false);
        setReason("");
        setRestore(false);
        selectionRef.current = null;
        dirtyRef.current = false;
      }
      actor.current = auth.data.userId;
      // Resolve nested ownership through the authorized parent BEFORE reading branch review content.
      const providerResult = await offerApi<
        ProviderOrganizationDto | { provider: ProviderOrganizationDto }
      >(`/api/v1/staff/providers/${providerId}`, { signal: controller.signal });
      if (generation !== loadGeneration.current) return false;
      if (controller.signal.aborted) throw new Error("READ_UNAVAILABLE");
      if (!providerResult.ok) {
        setData(null);
        setReadError(
          providerResult.status === 403 ? "capabilities.denied" : "capabilities.missing"
        );
        if (providerResult.status === 401) onUnauthorized();
        return false;
      }
      const provider =
        "provider" in providerResult.data ? providerResult.data.provider : providerResult.data;
      const branch = provider.branches.find(
        (entry) => entry.id === branchId && entry.providerOrganizationId === providerId
      );
      if (provider.id !== providerId || !branch) {
        setData(null);
        setReadError("capabilities.missing");
        return false;
      }
      const [workspaceResult, catalogResult] = await Promise.all([
        offerApi<CapabilityWorkspace>(`/api/v1/staff/branches/${branchId}/fitment-policies`, {
          signal: controller.signal,
        }),
        offerApi<ServiceCategoryDto[]>("/api/v1/staff/catalog/services", {
          signal: controller.signal,
        }),
      ]);
      if (generation !== loadGeneration.current) return false;
      if (controller.signal.aborted) throw new Error("READ_UNAVAILABLE");
      if (!workspaceResult.ok || !catalogResult.ok) {
        const failure = !workspaceResult.ok
          ? workspaceResult
          : !catalogResult.ok
            ? catalogResult
            : null;
        if (failure?.status === 401) onUnauthorized();
        setReadError(failure?.status === 403 ? "capabilities.denied" : "capabilities.loadError");
        setData(null);
        return false;
      }
      if (
        workspaceResult.data.context.branchId !== branchId ||
        workspaceResult.data.context.providerOrganizationId !== providerId
      ) {
        setData(null);
        setForm(newForm());
        setReason("");
        setDirty(false);
        setRestore(false);
        setReadError("capabilities.missing");
        return false;
      }
      // Cookie identity may change in another tab while these reads are in flight.
      // Never hydrate the previous actor's review material into the changed session.
      const finalAuth = await offerApi<StaffAuthStatusResponse>("/api/v1/staff/auth/status", {
        signal: controller.signal,
      });
      if (generation !== loadGeneration.current) return false;
      if (controller.signal.aborted) throw new Error("READ_UNAVAILABLE");
      if (
        !finalAuth.ok ||
        finalAuth.data.state !== "ACTIVE" ||
        !finalAuth.data.canAccessStaffApp ||
        finalAuth.data.userId !== auth.data.userId
      ) {
        setData(null);
        setSelection(null);
        setForm(newForm());
        setDirty(false);
        setReason("");
        setRestore(false);
        selectionRef.current = null;
        dirtyRef.current = false;
        setReadError("capabilities.authentication");
        if (!finalAuth.ok && finalAuth.status === 401) onUnauthorized();
        return false;
      }
      setData({
        actorId: auth.data.userId,
        workspace: workspaceResult.data,
        categories: catalogResult.data,
        provider: { nameEn: provider.nameEn, nameAr: provider.nameAr },
        branch: { nameEn: branch.nameEn, nameAr: branch.nameAr },
      });
      // An older actor's command must not clear its journal through this refresh.
      return !actorChanged;
    } catch {
      if (generation === loadGeneration.current && pageMounted.current)
        setReadError("capabilities.loadError");
      return false;
    } finally {
      clearTimeout(deadline);
      readControllers.current.delete(controller);
      if (generation === loadGeneration.current && pageMounted.current) setReadBusy(false);
    }
  }, [providerId, branchId, onUnauthorized]);

  const command = useCapabilityCommand({
    actorId: data?.actorId,
    branchId,
    onRefresh: refresh,
    onUnauthorized,
  });
  useEffect(() => {
    let active = true;
    pageMounted.current = true;
    const pendingReads = readControllers.current;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
      pageMounted.current = false;
      for (const controller of pendingReads) controller.abort();
      pendingReads.clear();
    };
  }, [refresh]);

  const hydrate = useCallback((target: string, loaded: Loaded) => {
    const policy = loaded.workspace.policies.find((entry) => entry.id === target);
    setSelection(policy?.id ?? "new");
    setForm(policy ? fromPolicy(policy) : newForm());
    setDirty(false);
    setReason("");
    setValidation(null);
    setRestore(false);
    setAttestation(null);
    setConfirmation(null);
    setPendingSelection(null);
  }, []);

  useEffect(() => {
    if (!data) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (
        command.receipt &&
        !command.locked &&
        handledReceipt.current !== command.receipt.commandId
      ) {
        handledReceipt.current = command.receipt.commandId;
        hydrate(command.receipt.policyId, data);
      } else if (selectionRef.current === null) {
        hydrate(command.journal?.policyId ?? data.workspace.policies[0]?.id ?? "new", data);
      } else if (!dirtyRef.current && !command.locked) {
        hydrate(selectionRef.current, data);
      }
    });
    return () => {
      active = false;
    };
  }, [data, command.receipt, command.locked, command.journal?.policyId, hydrate]);

  // Full-page exits use the native prompt. Same-document Back/Forward cannot be
  // cancelled, so restore the protected entry before Next consumes the popstate.
  // Preserve its complete router state; do not manufacture a Next history entry
  // or install a sentinel that would also trap clean exits and auth redirects.
  useLayoutEffect(() => {
    if (!dirty && !reason && !command.locked) return;
    const protectedUrl = window.location.href;
    const protectedState: unknown = window.history.state;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const followLink = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || link.getAttribute("href")?.startsWith("#")) return;
      event.preventDefault();
      event.stopPropagation();
      setValidation(command.locked ? "capabilities.unresolved" : "capabilities.dirty");
    };
    const restoreWorkspace = (event: PopStateEvent) => {
      event.stopImmediatePropagation();
      // A blocked traversal replaces the attempted forward path, not the form
      // or command journal. Once work is discarded/resolved the guard is removed.
      try {
        window.history.pushState(protectedState, "", protectedUrl);
      } catch {
        // Browsers may rate-limit pushState during repeated rapid traversals.
        // Restoring the current entry still keeps URL/router state consistent.
        window.history.replaceState(protectedState, "", protectedUrl);
      }
      setValidation(command.locked ? "capabilities.unresolved" : "capabilities.dirty");
    };
    window.addEventListener("beforeunload", beforeUnload);
    const releaseNavigation = protectCapabilityNavigation(restoreWorkspace);
    document.addEventListener("click", followLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      releaseNavigation();
      document.removeEventListener("click", followLink, true);
    };
  }, [dirty, reason, command.locked]);

  const policy = data?.workspace.policies.find((entry) => entry.id === selection);
  const current = data?.workspace.currentByCategory.find(
    (entry) => entry.categoryId === policy?.categoryId
  );
  const stale = Boolean(policy && form.version !== null && policy.version !== form.version);
  const snapshot = JSON.stringify([
    policy?.id,
    policy?.version,
    policy?.status,
    current,
    data?.workspace.context,
    policy?.category.isActive,
    policy?.coverage.map((entry) => [
      entry.makeId,
      entry.make.isActive,
      entry.modelId,
      entry.model.isActive,
      entry.yearFrom,
      entry.yearTo,
    ]),
  ]);
  const attested = attestation === snapshot;
  const locked = command.locked || readBusy || Boolean(readError);
  const editing = !policy || policy.eligibility.edit;
  const canReconstruct = restore && command.needsContent && !command.pending && !command.otherOwner;
  const contentDisabled = readBusy || (locked && !canReconstruct) || (!editing && !canReconstruct);
  const labelled = policy?.coverage.map((entry) => ({
    ...entry,
    makeNameEn: entry.make.nameEn,
    makeNameAr: entry.make.nameAr,
    modelNameEn: entry.model.nameEn,
    modelNameAr: entry.model.nameAr,
    makeIsActive: entry.make.isActive,
    modelIsActive: entry.model.isActive,
  }));
  const categoryName = (category: { nameEn: string; nameAr: string }) =>
    locale === "ar" ? category.nameAr : category.nameEn;
  const reportValidation = (key: string) => {
    setValidation(key);
    queueMicrotask(() => validationElement.current?.focus());
  };
  const updateForm = (patch: Partial<Form>) => {
    setForm((previous) => ({ ...previous, ...patch }));
    setDirty(true);
    setValidation(null);
  };
  const choose = (target: string) => {
    if (locked || !data) {
      setValidation("capabilities.unresolved");
      return;
    }
    if (dirty || reason) {
      setPendingSelection(target);
      setValidation("capabilities.dirty");
      return;
    }
    hydrate(target, data);
  };
  const validateContent = () => {
    const error =
      validateEvidenceReference(form.evidenceRef) ?? validateCoverageRows(form.coverage);
    if (error) {
      reportValidation(error);
      return false;
    }
    if (!form.categoryId) {
      reportValidation("capabilities.validation.category");
      return false;
    }
    return true;
  };
  const dispatch = async (action: CapabilityAction) => {
    if (locked || !data || stale) return;
    if (action === "CREATE" || action === "EDIT") {
      if (!validateContent()) return;
      await command.dispatch(
        action,
        action === "CREATE"
          ? { categoryId: form.categoryId }
          : { policyId: policy?.id, expectedVersion: form.version ?? undefined },
        { evidenceRef: form.evidenceRef, coverage: form.coverage }
      );
    } else if (action === "SUBMIT" && policy && !dirty) {
      await command.dispatch(action, { policyId: policy.id, expectedVersion: policy.version });
    }
  };
  const openDecision = (action: "APPROVE" | "REJECT" | "WITHDRAW") => {
    if (!policy || locked || stale || dirty || (action === "APPROVE" && !attested)) return;
    if (action === "REJECT") {
      const error = validateRejectionReason(reason);
      if (error) {
        reportValidation(error);
        return;
      }
    }
    setConfirmation({ action, snapshot });
  };
  const confirmDecision = async () => {
    if (
      !confirmation ||
      !policy ||
      locked ||
      confirmation.snapshot !== snapshot ||
      (confirmation.action === "APPROVE" && !attested)
    ) {
      setConfirmation(null);
      reportValidation("capabilities.stale");
      return;
    }
    const action = confirmation.action;
    if (action === "REJECT") {
      const error = validateRejectionReason(reason);
      if (error) {
        setConfirmation(null);
        reportValidation(error);
        return;
      }
    }
    setConfirmation(null);
    await command.dispatch(
      action,
      { policyId: policy.id, expectedVersion: policy.version },
      action === "REJECT" ? { reason } : undefined
    );
  };
  const restoreContent = () => {
    if (!command.journal || !command.needsContent || command.pending || !data) return;
    const target = data.workspace.policies.find((entry) => entry.id === command.journal?.policyId);
    setSelection(target?.id ?? "new");
    setForm({
      ...newForm(),
      categoryId: command.journal.categoryId ?? target?.categoryId ?? "",
      version: command.journal.expectedVersion ?? null,
    });
    setReason("");
    setDirty(false);
    setRestore(true);
    setValidation(null);
  };
  const retry = async () => {
    if (command.needsContent) {
      if (!restore) return;
      if (command.journal?.action === "REJECT") {
        const error = validateRejectionReason(reason);
        if (error) {
          reportValidation(error);
          return;
        }
      } else if (!validateContent()) return;
    }
    await command.retry({ evidenceRef: form.evidenceRef, coverage: form.coverage, reason });
  };
  const message = validation ?? command.error ?? readError;

  return (
    <main dir={dir} className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <Link
        className="inline-block min-h-11 py-2 text-blue-700 underline"
        href={`/staff/providers/${providerId}`}
      >
        {t("capabilities.back")}
      </Link>
      <h1 className="text-2xl font-bold">{t("capabilities.title")}</h1>
      <p className="text-sm text-slate-600">{t("capabilities.intro")}</p>
      {message && (
        <p
          ref={validationElement}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"
        >
          {t(message)}
        </p>
      )}
      {command.otherOwner && (
        <p role="alert" className="rounded-lg border border-amber-300 p-3">
          {t("capabilities.otherOwner")}
        </p>
      )}
      {command.unavailable && (
        <p role="alert" className="rounded-lg border border-amber-300 p-3">
          {t("capabilities.storageUnavailable")}
        </p>
      )}
      {readBusy && <p role="status">{t("capabilities.loading")}</p>}
      <button
        type="button"
        className={button}
        data-testid="capability-refresh"
        disabled={readBusy || command.pending}
        onClick={() => void refresh()}
      >
        {t("capabilities.refresh")}
      </button>
      {data && (
        <>
          <h2 className="text-xl font-semibold">
            {categoryName(data.provider)} · {categoryName(data.branch)}
          </h2>
          {(data.workspace.context.providerStatus !== "ACTIVE" ||
            data.workspace.context.branchStatus !== "ACTIVE") && (
            <p className="rounded-lg bg-amber-50 p-3">{t("capabilities.dependencyUnavailable")}</p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block" htmlFor="capability-policy">
                {t("capabilities.policy")}
              </label>
              <select
                id="capability-policy"
                data-testid="capability-policy"
                className={input}
                value={selection ?? "new"}
                disabled={locked}
                onChange={(event) => choose(event.target.value)}
              >
                <option value="new">{t("capabilities.newDraft")}</option>
                {data.workspace.policies.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {categoryName(entry.category)} · {entry.sequenceNumber} ·{" "}
                    {t(`capabilities.statuses.${entry.status}`)}
                  </option>
                ))}
              </select>
            </div>
            {data.workspace.context.canCreate && (
              <button
                type="button"
                className={button}
                data-testid="capability-new"
                disabled={locked}
                onClick={() => choose("new")}
              >
                {t("capabilities.newDraft")}
              </button>
            )}
          </div>
          {data.workspace.policies.length === 0 && <p>{t("capabilities.empty")}</p>}
          <section
            className="space-y-2 rounded-lg border border-slate-200 p-4"
            aria-label={t("capabilities.current")}
          >
            <h2 className="font-semibold">{t("capabilities.current")}</h2>
            {data.workspace.currentByCategory.length === 0 && <p>{t("capabilities.noCurrent")}</p>}
            {data.workspace.currentByCategory.map((pointer) => (
              <p key={pointer.categoryId} className="break-all">
                {categoryName(pointer.category)} ·{" "}
                {pointer.activeVersionId ? (
                  <>
                    {t("capabilities.version")}: {pointer.activePolicySequenceNumber} ·{" "}
                    <bdi dir="ltr">{pointer.activeVersionId}</bdi>
                  </>
                ) : (
                  t("capabilities.noCurrent")
                )}
                {!pointer.category.isActive && <> · {t("capabilities.dependencyUnavailable")}</>}
              </p>
            ))}
          </section>
          {stale && (
            <p role="alert" className="rounded-lg bg-amber-50 p-3">
              {t("capabilities.stale")}
            </p>
          )}
          {(dirty || reason || pendingSelection) && !command.locked && (
            <button
              type="button"
              className={button}
              data-testid="capability-discard"
              onClick={() => hydrate(pendingSelection ?? selection ?? "new", data)}
            >
              {t("capabilities.discard")}
            </button>
          )}
          {command.journal && (
            <section
              data-testid="capability-unknown"
              className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
              aria-label={t("capabilities.unknown")}
            >
              <h2 className="font-semibold">{t("capabilities.unknown")}</h2>
              <p>{t("capabilities.unresolved")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={button}
                  data-testid="capability-recheck"
                  disabled={command.pending || readBusy}
                  onClick={() => void command.recheck()}
                >
                  {t("capabilities.recheck")}
                </button>
                {command.retryAvailable && command.needsContent && !restore && (
                  <button
                    type="button"
                    className={button}
                    data-testid="capability-restore"
                    disabled={command.pending || readBusy}
                    onClick={restoreContent}
                  >
                    {t("capabilities.restore")}
                  </button>
                )}
                {command.retryAvailable && (!command.needsContent || restore) && (
                  <button
                    type="button"
                    className={button}
                    data-testid="capability-retry"
                    disabled={command.pending || readBusy}
                    onClick={() => void retry()}
                  >
                    {t("capabilities.retry")}
                  </button>
                )}
              </div>
              {restore && <p>{t("capabilities.reconstruction")}</p>}
            </section>
          )}
          {command.receipt && (
            <p className="rounded-lg bg-slate-100 p-3">
              {t("capabilities.historicalReceipt")} <bdi dir="ltr">{command.receipt.commandId}</bdi>
            </p>
          )}
          {policy && (
            <section className="space-y-2 rounded-lg border border-slate-200 p-4">
              {(!policy.category.isActive ||
                policy.coverage.some((entry) => !entry.make.isActive || !entry.model.isActive)) && (
                <p className="rounded-lg bg-amber-50 p-3">
                  {t("capabilities.dependencyUnavailable")}
                </p>
              )}
              <p>
                {t("capabilities.recordedStatus")}:{" "}
                <strong data-testid="capability-status">
                  {t(`capabilities.statuses.${policy.status}`)}
                </strong>{" "}
                · {t("capabilities.version")}: <bdi>{policy.version}</bdi>
              </p>
              <p data-testid="capability-current">
                {t(policy.isCurrent ? "capabilities.current" : "capabilities.notCurrent")}
              </p>
              <p className="break-all text-xs text-slate-500">
                <bdi dir="ltr">{policy.id}</bdi>
              </p>
              {policy.rejectionReason && <p>{policy.rejectionReason}</p>}
              {(policy.status === "REJECTED" || policy.status === "WITHDRAWN") && (
                <p>{t("capabilities.terminal")}</p>
              )}
            </section>
          )}
          {(policy || data.workspace.context.canCreate || canReconstruct) && (
            <section className="space-y-4 rounded-lg border border-slate-200 p-4">
              <div>
                <label className="mb-1 block" htmlFor="capability-category">
                  {t("capabilities.category")}
                </label>
                <select
                  id="capability-category"
                  className={input}
                  value={form.categoryId}
                  disabled={Boolean(policy) || contentDisabled || canReconstruct}
                  onChange={(event) => updateForm({ categoryId: event.target.value })}
                >
                  <option value="">{t("capabilities.validation.category")}</option>
                  {policy && !data.categories.some((entry) => entry.id === policy.categoryId) && (
                    <option value={policy.categoryId}>{categoryName(policy.category)}</option>
                  )}
                  {data.categories.map((entry) => (
                    <option key={entry.id} value={entry.id} disabled={!entry.isActive}>
                      {categoryName(entry)}
                    </option>
                  ))}
                </select>
              </div>
              {editing || canReconstruct ? (
                <div>
                  <label className="mb-1 block" htmlFor="capability-evidence">
                    {t("capabilities.evidence")}
                  </label>
                  <input
                    id="capability-evidence"
                    className={input}
                    dir="ltr"
                    value={form.evidenceRef}
                    disabled={contentDisabled}
                    maxLength={128}
                    autoComplete="off"
                    aria-describedby="capability-evidence-help"
                    onChange={(event) => updateForm({ evidenceRef: event.target.value })}
                  />
                  <p id="capability-evidence-help" className="text-sm text-slate-600">
                    {t("capabilities.evidenceHelp")}
                  </p>
                </div>
              ) : (
                <div>
                  <p>{t("capabilities.evidence")}</p>
                  <p className="break-all">
                    <bdi dir="ltr">{policy?.evidenceRef}</bdi>
                  </p>
                  <p className="text-sm text-slate-600">{t("capabilities.evidenceHelp")}</p>
                </div>
              )}
              <FitmentCoverageEditor
                value={form.coverage}
                disabled={contentDisabled}
                savedCoverage={labelled}
                onChange={(coverage) => updateForm({ coverage })}
              />
              {!command.locked && !restore && (
                <div className="flex flex-wrap gap-3">
                  {!policy && data.workspace.context.canCreate && (
                    <button
                      type="button"
                      className={primary}
                      data-testid="capability-create"
                      disabled={locked}
                      onClick={() => void dispatch("CREATE")}
                    >
                      {t("capabilities.create")}
                    </button>
                  )}
                  {policy?.eligibility.edit && (
                    <button
                      type="button"
                      className={primary}
                      data-testid="capability-save"
                      disabled={locked || stale}
                      onClick={() => void dispatch("EDIT")}
                    >
                      {t("capabilities.save")}
                    </button>
                  )}
                  {policy?.eligibility.submit && (
                    <button
                      type="button"
                      className={button}
                      data-testid="capability-submit"
                      disabled={locked || dirty || stale}
                      onClick={() => void dispatch("SUBMIT")}
                    >
                      {t("capabilities.submit")}
                    </button>
                  )}
                </div>
              )}
            </section>
          )}
          {policy &&
            (policy.eligibility.approve ||
              policy.eligibility.reject ||
              policy.eligibility.withdraw) && (
              <section className="space-y-4 rounded-lg border border-slate-200 p-4">
                {policy.eligibility.approve && (
                  <>
                    <p>{t("capabilities.replacementWarning")}</p>
                    <p>
                      {current?.activeVersionId ? (
                        <>
                          {t("capabilities.current")}: {current.activePolicySequenceNumber} ·{" "}
                          <bdi dir="ltr">{current.activeVersionId}</bdi>
                        </>
                      ) : (
                        t("capabilities.noCurrent")
                      )}
                    </p>
                    <label className="flex min-h-11 items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-5 w-5"
                        checked={attested}
                        disabled={locked || stale}
                        onChange={(event) => setAttestation(event.target.checked ? snapshot : null)}
                      />
                      <span>{t("capabilities.attestation")}</span>
                    </label>
                    <button
                      type="button"
                      className={primary}
                      data-testid="capability-approve"
                      disabled={locked || stale || !attested}
                      onClick={() => openDecision("APPROVE")}
                    >
                      {t("capabilities.approve")}
                    </button>
                  </>
                )}
                {(policy.eligibility.reject ||
                  (canReconstruct && command.journal?.action === "REJECT")) && (
                  <div>
                    <label className="mb-1 block" htmlFor="capability-reason">
                      {t("capabilities.reason")}
                    </label>
                    <textarea
                      id="capability-reason"
                      className={input}
                      value={reason}
                      maxLength={1000}
                      disabled={locked && !canReconstruct}
                      onChange={(event) => {
                        setReason(event.target.value);
                        setValidation(null);
                        setConfirmation(null);
                      }}
                    />
                    {policy.eligibility.reject && (
                      <button
                        type="button"
                        className={`${button} mt-2`}
                        data-testid="capability-reject"
                        disabled={locked || stale}
                        onClick={() => openDecision("REJECT")}
                      >
                        {t("capabilities.reject")}
                      </button>
                    )}
                  </div>
                )}
                {policy.eligibility.withdraw && (
                  <>
                    <p>{t("capabilities.withdrawalWarning")}</p>
                    <button
                      type="button"
                      className={button}
                      data-testid="capability-withdraw"
                      disabled={locked || stale}
                      onClick={() => openDecision("WITHDRAW")}
                    >
                      {t("capabilities.withdraw")}
                    </button>
                  </>
                )}
              </section>
            )}
          {canReconstruct &&
            command.journal?.action === "REJECT" &&
            !policy?.eligibility.reject && (
              <div>
                <label className="mb-1 block" htmlFor="capability-reason">
                  {t("capabilities.reason")}
                </label>
                <textarea
                  id="capability-reason"
                  className={input}
                  value={reason}
                  maxLength={1000}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
            )}
          {confirmation?.snapshot === snapshot && (
            <section
              role="region"
              aria-labelledby="capability-confirm-title"
              className="space-y-3 rounded-lg border-2 border-blue-700 bg-slate-50 p-5"
            >
              <h2 id="capability-confirm-title" className="text-lg font-semibold">
                {t("capabilities.confirmTitle")}
              </h2>
              <p>
                {t(
                  confirmation.action === "APPROVE"
                    ? "capabilities.confirmApprove"
                    : confirmation.action === "REJECT"
                      ? "capabilities.confirmReject"
                      : "capabilities.confirmWithdraw"
                )}
              </p>
              {confirmation.action === "APPROVE" && <p>{t("capabilities.replacementWarning")}</p>}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className={primary}
                  data-testid="capability-confirm"
                  disabled={locked}
                  onClick={() => void confirmDecision()}
                >
                  {t("capabilities.confirm")}
                </button>
                <button type="button" className={button} onClick={() => setConfirmation(null)}>
                  {t("capabilities.cancel")}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
