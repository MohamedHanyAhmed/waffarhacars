"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/context/I18nContext";
import {
  appendCatalogPage,
  loadVehicleCatalogPage,
  maximumCoveredYear,
  validateCoverageRows,
  type CoverageRow,
  type LabelledCoverageRow,
  type VehicleCatalogChoice,
} from "@/lib/fitment/client-validation";

export type { CoverageRow, LabelledCoverageRow } from "@/lib/fitment/client-validation";

type CatalogState = {
  scope: string;
  items: VehicleCatalogChoice[];
  nextCursor: string | null;
  loading: boolean;
  error: boolean;
};

function useCatalog(scope: string) {
  const [state, setState] = useState<CatalogState | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const generation = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    if (!scope) return;
    const controller = new AbortController();
    const pendingControllers = controllers.current;
    pendingControllers.add(controller);
    busy.current = true;
    loadVehicleCatalogPage(scope === "makes" ? {} : { makeId: scope }, controller.signal)
      .then((page) => {
        if (generation.current !== requestGeneration || controller.signal.aborted) return;
        setState({ scope, ...page, loading: false, error: false });
      })
      .catch(() => {
        if (generation.current !== requestGeneration || controller.signal.aborted) return;
        setState({ scope, items: [], nextCursor: null, loading: false, error: true });
      })
      .finally(() => {
        pendingControllers.delete(controller);
        if (generation.current === requestGeneration) busy.current = false;
      });
    return () => {
      for (const pending of pendingControllers) pending.abort();
      pendingControllers.clear();
      busy.current = false;
    };
  }, [scope]);

  const current: CatalogState =
    state?.scope === scope
      ? state
      : { scope, items: [], nextCursor: null, loading: Boolean(scope), error: false };

  async function loadMore() {
    if (!scope || busy.current || (current.items.length > 0 && !current.nextCursor)) return;
    const requestGeneration = generation.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    busy.current = true;
    setState({ ...current, loading: true, error: false });
    try {
      const page = await loadVehicleCatalogPage(
        {
          ...(scope === "makes" ? {} : { makeId: scope }),
          ...(current.nextCursor ? { cursor: current.nextCursor } : {}),
        },
        controller.signal
      );
      if (generation.current !== requestGeneration || controller.signal.aborted) return;
      setState({
        scope,
        items: appendCatalogPage(current.items, page.items),
        nextCursor: page.nextCursor,
        loading: false,
        error: false,
      });
    } catch {
      if (generation.current !== requestGeneration || controller.signal.aborted) return;
      setState({ ...current, loading: false, error: true });
    } finally {
      controllers.current.delete(controller);
      if (generation.current === requestGeneration) busy.current = false;
    }
  }

  return { ...current, loadMore };
}

const inputClass =
  "min-h-11 w-full rounded border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100";
const buttonClass = "min-h-11 rounded border border-slate-300 px-3 py-2 disabled:opacity-50";

function CoverageCard({
  row,
  index,
  disabled,
  saved,
  makes,
  onChange,
  onRemove,
}: {
  row: CoverageRow;
  index: number;
  disabled: boolean;
  saved?: LabelledCoverageRow;
  makes: ReturnType<typeof useCatalog>;
  onChange: (next: CoverageRow) => void;
  onRemove: () => void;
}) {
  const { t, locale } = useI18n();
  const models = useCatalog(row.makeId);
  const maxYear = maximumCoveredYear();
  const makeInChoices = makes.items.some((item) => item.id === row.makeId);
  const modelInChoices = models.items.some((item) => item.id === row.modelId);
  const savedMake = saved?.makeId === row.makeId ? saved : undefined;
  const savedModel = saved?.modelId === row.modelId ? saved : undefined;
  const inactive = saved && (!saved.makeIsActive || !saved.modelIsActive);
  const choiceLabel = (item: VehicleCatalogChoice) => (locale === "ar" ? item.nameAr : item.nameEn);
  return (
    <fieldset
      className="space-y-3 rounded-lg border border-slate-200 p-4"
      data-testid="fitment-coverage-row"
    >
      <legend className="px-1 font-medium">
        {t("capabilities.coverage.row", { number: index + 1 })}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block" htmlFor={`fitment-make-${index}`}>
            {t("capabilities.coverage.make")}
          </label>
          <select
            id={`fitment-make-${index}`}
            className={inputClass}
            value={row.makeId}
            disabled={disabled}
            onChange={(event) => onChange({ ...row, makeId: event.target.value, modelId: "" })}
          >
            <option value="">{t("capabilities.coverage.selectMake")}</option>
            {row.makeId && !makeInChoices && (
              <option value={row.makeId} disabled={savedMake?.makeIsActive === false}>
                {savedMake
                  ? locale === "ar"
                    ? savedMake.makeNameAr
                    : savedMake.makeNameEn
                  : row.makeId}
                {savedMake?.makeIsActive === false
                  ? ` (${t("capabilities.coverage.inactive")})`
                  : ""}
              </option>
            )}
            {makes.items.map((item) => (
              <option
                key={item.id}
                value={item.id}
                disabled={item.id === savedMake?.makeId && !savedMake.makeIsActive}
              >
                {choiceLabel(item)}
                {item.id === savedMake?.makeId && !savedMake.makeIsActive
                  ? ` (${t("capabilities.coverage.inactive")})`
                  : ""}
              </option>
            ))}
          </select>
          {makes.loading && (
            <p role="status" className="text-sm">
              {t("capabilities.coverage.loading")}
            </p>
          )}
          {!makes.loading && !makes.error && makes.items.length === 0 && (
            <p className="text-sm">{t("capabilities.coverage.empty")}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block" htmlFor={`fitment-model-${index}`}>
            {t("capabilities.coverage.model")}
          </label>
          <select
            id={`fitment-model-${index}`}
            className={inputClass}
            value={row.modelId}
            disabled={disabled || !row.makeId}
            onChange={(event) => onChange({ ...row, modelId: event.target.value })}
          >
            <option value="">{t("capabilities.coverage.selectModel")}</option>
            {row.modelId && !modelInChoices && (
              <option value={row.modelId} disabled={savedModel?.modelIsActive === false}>
                {savedModel
                  ? locale === "ar"
                    ? savedModel.modelNameAr
                    : savedModel.modelNameEn
                  : row.modelId}
                {savedModel?.modelIsActive === false
                  ? ` (${t("capabilities.coverage.inactive")})`
                  : ""}
              </option>
            )}
            {models.items.map((item) => (
              <option
                key={item.id}
                value={item.id}
                disabled={item.id === savedModel?.modelId && !savedModel.modelIsActive}
              >
                {choiceLabel(item)}
                {item.id === savedModel?.modelId && !savedModel.modelIsActive
                  ? ` (${t("capabilities.coverage.inactive")})`
                  : ""}
              </option>
            ))}
          </select>
          {models.loading && (
            <p role="status" className="text-sm">
              {t("capabilities.coverage.loading")}
            </p>
          )}
          {row.makeId && !models.loading && !models.error && models.items.length === 0 && (
            <p className="text-sm">{t("capabilities.coverage.empty")}</p>
          )}
          {models.error && (
            <p role="alert" className="text-sm text-red-700">
              {t("capabilities.coverage.error")}
            </p>
          )}
          {(models.nextCursor || models.error) && (
            <button
              type="button"
              className={`${buttonClass} mt-2`}
              data-testid={`fitment-more-models-${index}`}
              disabled={disabled || models.loading}
              onClick={() => void models.loadMore()}
            >
              {t(
                models.error
                  ? "capabilities.coverage.retry"
                  : "capabilities.coverage.loadMoreModels"
              )}
            </button>
          )}
        </div>
        {(["yearFrom", "yearTo"] as const).map((field) => (
          <div key={field}>
            <label className="mb-1 block" htmlFor={`fitment-${field}-${index}`}>
              {t(`capabilities.coverage.${field}`)}
            </label>
            <input
              id={`fitment-${field}-${index}`}
              type="number"
              inputMode="numeric"
              min={1900}
              max={maxYear}
              step={1}
              dir="ltr"
              className={inputClass}
              disabled={disabled}
              value={Number.isFinite(row[field]) ? row[field] : ""}
              onChange={(event) =>
                onChange({
                  ...row,
                  [field]: event.target.value === "" ? Number.NaN : Number(event.target.value),
                })
              }
            />
          </div>
        ))}
      </div>
      {inactive && (
        <p className="text-sm text-amber-800">{t("capabilities.coverage.unavailable")}</p>
      )}
      {(row.makeId || row.modelId) && (
        <p className="break-all text-xs text-slate-500">
          {t("capabilities.coverage.identity")}:{" "}
          <bdi dir="ltr">
            {row.makeId} / {row.modelId}
          </bdi>
        </p>
      )}
      <button
        type="button"
        className={buttonClass}
        data-testid={`fitment-remove-range-${index}`}
        disabled={disabled}
        onClick={onRemove}
      >
        {t("capabilities.coverage.remove", { number: index + 1 })}
      </button>
    </fieldset>
  );
}

export type FitmentCoverageEditorProps = {
  value: CoverageRow[];
  onChange: (rows: CoverageRow[]) => void;
  disabled?: boolean;
  savedCoverage?: LabelledCoverageRow[];
};

export default function FitmentCoverageEditor({
  value,
  onChange,
  disabled = false,
  savedCoverage = [],
}: FitmentCoverageEditorProps) {
  const { t } = useI18n();
  const makes = useCatalog("makes");
  const error = validateCoverageRows(value);
  return (
    <section className="space-y-3" aria-label={t("capabilities.coverage.title")}>
      <h3 className="font-semibold">{t("capabilities.coverage.title")}</h3>
      <p className="text-sm">{t("capabilities.coverage.rangeCount", { count: value.length })}</p>
      {makes.error && (
        <p role="alert" className="text-sm text-red-700">
          {t("capabilities.coverage.error")}
        </p>
      )}
      {(makes.nextCursor || makes.error) && (
        <button
          type="button"
          className={buttonClass}
          data-testid="fitment-more-makes"
          disabled={disabled || makes.loading}
          onClick={() => void makes.loadMore()}
        >
          {t(makes.error ? "capabilities.coverage.retry" : "capabilities.coverage.loadMoreMakes")}
        </button>
      )}
      {value.map((row, index) => (
        <CoverageCard
          key={index}
          row={row}
          index={index}
          disabled={disabled}
          makes={makes}
          saved={savedCoverage.find(
            (saved) => saved.makeId === row.makeId && saved.modelId === row.modelId
          )}
          onChange={(next) =>
            onChange(value.map((entry, position) => (position === index ? next : entry)))
          }
          onRemove={() => onChange(value.filter((_, position) => position !== index))}
        />
      ))}
      <button
        type="button"
        className={buttonClass}
        data-testid="fitment-add-range"
        disabled={disabled || value.length >= 50}
        onClick={() =>
          onChange([
            ...value,
            {
              makeId: "",
              modelId: "",
              yearFrom: maximumCoveredYear() - 1,
              yearTo: maximumCoveredYear() - 1,
            },
          ])
        }
      >
        {t("capabilities.coverage.add")}
      </button>
      <p aria-live="polite" className="text-sm text-red-700">
        {error ? t(error) : ""}
      </p>
    </section>
  );
}
