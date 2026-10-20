"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/context/I18nContext";
import FitmentCoverageEditor from "@/components/staff/FitmentCoverageEditor";
import { useOfferFitmentCommand } from "@/components/staff/useOfferFitmentCommand";
import {
  validateCoverageRows,
  validateEvidenceReference,
  type CoverageRow,
} from "@/lib/fitment/client-validation";
import {
  labelledOfferCoverage,
  OFFER_FITMENT_MODES,
  type OfferFitmentMode,
  type OfferFitmentReview,
} from "@/lib/fitment/offer-client";

export type OfferFitmentEditorState = { dirty: boolean; pending: boolean; unknown: boolean };
export type OfferFitmentEditorProps = {
  actorId: string | undefined;
  offerId: string;
  revisionId: string;
  expectedVersion: number;
  saved: OfferFitmentReview | null;
  editable: boolean;
  /** External competing editor/action lock, not this editor's own recovery lock. */
  disabled: boolean;
  onRefresh: () => Promise<boolean>;
  onUnauthorized: () => void;
  onStateChange: (state: OfferFitmentEditorState) => void;
  onConflict?: () => void;
};
function initialForm(saved: OfferFitmentReview | null, version: number) {
  return {
    mode: saved?.mode ?? ("" as OfferFitmentMode | ""),
    evidence: saved?.evidenceRef ?? "",
    coverage:
      saved?.coverage.map(({ makeId, modelId, yearFrom, yearTo }) => ({
        makeId,
        modelId,
        yearFrom,
        yearTo,
      })) ?? ([] as CoverageRow[]),
    version,
  };
}
const inputClass =
  "min-h-11 w-full rounded border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100";
const buttonClass = "min-h-11 rounded border border-slate-300 px-3 py-2 disabled:opacity-50";

export default function OfferFitmentEditor(props: OfferFitmentEditorProps) {
  const {
    actorId,
    offerId,
    revisionId,
    expectedVersion,
    saved,
    editable,
    disabled,
    onRefresh,
    onUnauthorized,
  } = props;
  const { t, locale } = useI18n();
  const command = useOfferFitmentCommand({
    actorId,
    offerId,
    revisionId,
    onRefresh,
    onUnauthorized,
    canDispatch: () => editable && !disabled,
  });
  const [form, setForm] = useState(() => initialForm(saved, expectedVersion));
  const [dirty, setDirty] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const callback = useRef(props.onStateChange);
  useLayoutEffect(() => {
    callback.current = props.onStateChange;
  }, [props.onStateChange]);
  const [lastSettled, setLastSettled] = useState<string | null>(null);
  const settlingOwnReceipt = Boolean(command.receipt && command.receipt.commandId !== lastSettled);
  const conflict = dirty && form.version !== expectedVersion && !settlingOwnReceipt;
  const snapshot = JSON.stringify(saved);
  useEffect(() => {
    callback.current({
      dirty,
      pending: command.pending,
      unknown: command.locked && !command.pending,
    });
  }, [dirty, command.pending, command.locked]);
  const onConflict = props.onConflict;
  useEffect(() => {
    if (conflict) onConflict?.();
  }, [conflict, onConflict]);
  useEffect(() => {
    // Never rebase unsaved or unresolved input onto a newer shared CAS version.
    const settled = command.receipt && !command.locked && command.receipt.commandId !== lastSettled;
    if (!settled && (dirty || command.locked)) return;
    const next = initialForm(saved, expectedVersion);
    queueMicrotask(() => {
      if (settled) setLastSettled(command.receipt!.commandId);
      setForm(next);
      setDirty(false);
      setRestoring(false);
      setValidation(null);
    });
    // JSON snapshot changes only for authoritative content, not a parent rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, expectedVersion, command.locked, command.receipt?.commandId]);
  function edit(patch: Partial<typeof form>) {
    if (disabled || command.pending || (command.locked && !restoring) || (!editable && !restoring))
      return;
    setForm((previous) => ({ ...previous, ...patch }));
    setDirty(true);
    setValidation(null);
  }
  function content() {
    if (!OFFER_FITMENT_MODES.includes(form.mode as OfferFitmentMode)) {
      setValidation("offerFitment.chooseMode");
      return null;
    }
    const invalid = validateEvidenceReference(form.evidence) ?? validateCoverageRows(form.coverage);
    if (invalid) {
      setValidation(invalid);
      return null;
    }
    return {
      mode: form.mode as OfferFitmentMode,
      evidenceRef: form.evidence,
      coverage: form.coverage,
    };
  }
  const fieldsDisabled =
    disabled || command.pending || (command.locked && !restoring) || (!editable && !restoring);
  // A remote submit may freeze this revision while local input is dirty. Keep
  // that input visible read-only and allow an explicit discard, not a dead end.
  const canEdit = editable || restoring || dirty;
  const dependenciesUnavailable =
    saved?.context &&
    (saved.context.providerStatus !== "ACTIVE" ||
      saved.context.branchStatus !== "ACTIVE" ||
      !saved.context.serviceIsActive ||
      !saved.context.categoryIsActive);
  return (
    <section
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
      aria-labelledby="offer-fitment-title"
    >
      <h2 id="offer-fitment-title" className="text-xl font-semibold">
        {t("offerFitment.title")}
      </h2>
      <p>{t("offerFitment.explanation")}</p>
      <p className="text-sm text-slate-600">{t("offerFitment.scopeLimit")}</p>
      {dependenciesUnavailable && (
        <p role="status" className="text-amber-800">
          {t("offerFitment.dependencyUnavailable")}
        </p>
      )}
      <section
        data-testid="offer-fitment-saved"
        className="space-y-2 rounded border border-slate-200 p-3"
        aria-label={t("offerFitment.saved")}
      >
        <h3 className="font-semibold">{t("offerFitment.saved")}</h3>
        <p>
          {t(
            !saved
              ? "offerFitment.unavailable"
              : saved.mode
                ? `offerFitment.modes.${saved.mode}`
                : "offerFitment.unassessed"
          )}
        </p>
        {saved?.evidenceRef && (
          <p>
            {t("offerFitment.evidence")}:{" "}
            <bdi dir="ltr" className="break-all">
              {saved.evidenceRef}
            </bdi>
          </p>
        )}
        <ul className="space-y-2">
          {saved?.coverage.map((row, index) => (
            <li
              key={`${row.modelId}-${row.yearFrom}-${row.yearTo}-${index}`}
              data-testid="offer-fitment-saved-range"
            >
              <span>
                {locale === "ar" ? row.make.nameAr : row.make.nameEn} /{" "}
                {locale === "ar" ? row.model.nameAr : row.model.nameEn}
              </span>{" "}
              <bdi dir="ltr">
                {row.yearFrom}–{row.yearTo}
              </bdi>
              {(!row.make.isActive || !row.model.isActive) && (
                <span> ({t("offerFitment.inactive")})</span>
              )}
              <p className="break-all text-xs text-slate-500">
                <bdi dir="ltr">
                  {row.makeId} / {row.modelId}
                </bdi>
              </p>
            </li>
          ))}
        </ul>
        {saved && (
          <p className="text-sm">{t("offerFitment.savedVersion", { version: saved.version })}</p>
        )}
      </section>
      {command.otherOwner && <p role="alert">{t("offerFitment.otherOwner")}</p>}
      {command.unavailable && <p role="alert">{t("offerFitment.storageUnavailable")}</p>}
      {command.receipt && (
        <p role="status" data-testid="offer-fitment-receipt">
          {t("offerFitment.receipt", { version: command.receipt.resultVersion })}
        </p>
      )}
      {command.error && <p role="alert">{t(command.error)}</p>}
      {conflict && (
        <p role="alert" data-testid="offer-fitment-conflict">
          {t("offerFitment.conflict")}
        </p>
      )}
      {command.pending && <p role="status">{t("offerFitment.pending")}</p>}
      {command.journal && (
        <section
          className="space-y-3 rounded border border-amber-400 p-3"
          data-testid="offer-fitment-unknown"
          aria-label={t("offerFitment.recovery")}
        >
          <p>{t("offerFitment.unknown")}</p>
          <p className="text-sm">{t("offerFitment.support")}</p>
          <p className="break-all text-xs">
            <bdi dir="ltr">{command.journal.commandId}</bdi>
          </p>
          <button
            type="button"
            className={buttonClass}
            data-testid="offer-fitment-recheck"
            disabled={disabled || command.pending}
            onClick={() => {
              if (!disabled && !command.pending) void command.recheck();
            }}
          >
            {t("offerFitment.recheck")}
          </button>
          {command.retryAvailable && command.needsContent && !restoring && (
            <button
              type="button"
              className={buttonClass}
              data-testid="offer-fitment-restore"
              disabled={disabled || command.pending}
              onClick={() => {
                if (disabled || command.pending) return;
                setForm({
                  mode: "",
                  evidence: "",
                  coverage: [],
                  version: command.journal!.expectedVersion,
                });
                setDirty(true);
                setRestoring(true);
                setValidation(null);
              }}
            >
              {t("offerFitment.restore")}
            </button>
          )}
          {command.retryAvailable && (!command.needsContent || restoring) && (
            <button
              type="button"
              className={buttonClass}
              data-testid="offer-fitment-retry"
              disabled={disabled || command.pending}
              onClick={() => {
                if (disabled || command.pending) return;
                // Frozen memory is used when available. Reconstruction must validate before fingerprint comparison.
                const body = command.needsContent
                  ? content()
                  : {
                      mode: form.mode as OfferFitmentMode,
                      evidenceRef: form.evidence,
                      coverage: form.coverage,
                    };
                if (body) void command.retry(body);
              }}
            >
              {t("offerFitment.retry")}
            </button>
          )}
        </section>
      )}
      {canEdit && (
        <div className="space-y-4">
          <div>
            <label htmlFor="offer-fitment-mode" className="mb-1 block">
              {t("offerFitment.mode")}
            </label>
            <select
              id="offer-fitment-mode"
              data-testid="offer-fitment-mode"
              className={inputClass}
              value={form.mode}
              disabled={fieldsDisabled}
              onChange={(event) => edit({ mode: event.target.value as OfferFitmentMode | "" })}
            >
              <option value="">{t("offerFitment.chooseMode")}</option>
              {OFFER_FITMENT_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`offerFitment.modes.${mode}`)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm">
              {form.mode
                ? t(`offerFitment.modeHelp.${form.mode}`)
                : t("offerFitment.unassessedHelp")}
            </p>
          </div>
          <div>
            <label htmlFor="offer-fitment-evidence" className="mb-1 block">
              {t("offerFitment.evidence")}
            </label>
            <input
              id="offer-fitment-evidence"
              data-testid="offer-fitment-evidence"
              dir="ltr"
              maxLength={128}
              className={inputClass}
              value={form.evidence}
              disabled={fieldsDisabled}
              onChange={(event) => edit({ evidence: event.target.value })}
            />
            <p className="mt-1 text-sm">{t("offerFitment.evidenceHelp")}</p>
          </div>
          <FitmentCoverageEditor
            value={form.coverage}
            savedCoverage={labelledOfferCoverage(saved)}
            disabled={fieldsDisabled}
            onChange={(coverage) => edit({ coverage })}
          />
          {validation && <p role="alert">{t(validation)}</p>}
          {!command.locked && (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={`${buttonClass} bg-slate-900 text-white`}
                data-testid="offer-fitment-save"
                disabled={disabled || !dirty || !editable || conflict}
                onClick={() => {
                  if (disabled || !dirty || !editable || command.locked || conflict) return;
                  const body = content();
                  if (body) {
                    callback.current({ dirty: true, pending: true, unknown: false });
                    void command.dispatch(form.version, body);
                  }
                }}
              >
                {t("offerFitment.save")}
              </button>
              <button
                type="button"
                className={buttonClass}
                data-testid="offer-fitment-discard"
                disabled={disabled || !dirty}
                onClick={() => {
                  if (disabled || command.locked) return;
                  setForm(initialForm(saved, expectedVersion));
                  setDirty(false);
                  setRestoring(false);
                  setValidation(null);
                }}
              >
                {t("offerFitment.discard")}
              </button>
            </div>
          )}
        </div>
      )}
      {!editable && !restoring && <p>{t("offerFitment.readOnly")}</p>}
    </section>
  );
}
