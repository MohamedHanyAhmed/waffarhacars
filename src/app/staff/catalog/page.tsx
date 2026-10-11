"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { offerApi, offerFailureMessage, mutationOutcomeUnknown } from "@/lib/offer/client-api";
import {
  clearPendingCatalogOperation,
  readPendingCatalogOperation,
  writePendingCatalogOperation,
  type ServiceCategoryDto,
  type ServiceDefinitionDto,
} from "@/lib/offer/client";
import type { StaffAuthStatusResponse } from "@/lib/staff/status-contract";

type ServiceForm = {
  code: string;
  categoryId: string;
  nameEn: string;
  nameAr: string;
  scopeEn: string;
  scopeAr: string;
  pricingMode: "FIXED_SCOPE" | "QUOTE_REQUIRED";
  itemSku: string;
  isActive: boolean;
};

const emptyForm: ServiceForm = {
  code: "",
  categoryId: "",
  nameEn: "",
  nameAr: "",
  scopeEn: "",
  scopeAr: "",
  pricingMode: "FIXED_SCOPE",
  itemSku: "",
  isActive: true,
};

export default function StaffCatalogPage() {
  const { t, locale, dir } = useI18n();
  const router = useRouter();
  const [categories, setCategories] = useState<ServiceCategoryDto[]>([]);
  const [staff, setStaff] = useState<StaffAuthStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(() => Boolean(readPendingCatalogOperation()));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<ServiceForm>(emptyForm);
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      const [auth, catalog] = await Promise.all([
        offerApi<StaffAuthStatusResponse>("/api/v1/staff/auth/status", { signal }),
        offerApi<ServiceCategoryDto[]>("/api/v1/staff/catalog/services", { signal }),
      ]);
      if (signal?.aborted) return;
      if (!auth.ok && auth.status === 401) return router.replace("/staff/login");
      if (!catalog.ok && catalog.status === 401) return router.replace("/staff/login");
      if (!auth.ok || !catalog.ok) {
        setCategories([]);
        setStaff(null);
        setError(t("staffOffers.denied"));
      } else {
        setStaff(auth.data);
        setCategories(catalog.data);
        setError(null);
      }
      setLoading(false);
    },
    [router, t]
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
  }, [load, t]);

  const canManage = staff?.state === "ACTIVE" && staff.department === "OPERATIONS";
  const selectedCategory = categories.find((category) => category.id === form.categoryId);
  const edit = (definition: ServiceDefinitionDto) => {
    if (pending || unknown) return;
    setEditing({ id: definition.id, version: definition.version });
    setForm({
      code: definition.code,
      categoryId: definition.categoryId,
      nameEn: definition.nameEn,
      nameAr: definition.nameAr,
      scopeEn: definition.scopeEn,
      scopeAr: definition.scopeAr,
      pricingMode: definition.pricingMode,
      itemSku: definition.itemSku ?? "",
      isActive: definition.isActive,
    });
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || unknown || !canManage) return;
    setPending(true);
    setError(null);
    setMessage(null);
    const payload = {
      code: form.code.trim().toUpperCase(),
      categoryId: form.categoryId,
      nameEn: form.nameEn.trim(),
      nameAr: form.nameAr.trim(),
      scopeEn: form.scopeEn.trim(),
      scopeAr: form.scopeAr.trim(),
      pricingMode: form.pricingMode,
      itemSku: form.itemSku.trim() || null,
      ...(editing ? { expectedVersion: editing.version, isActive: form.isActive } : {}),
    };
    try {
      writePendingCatalogOperation({
        code: payload.code,
        ...(editing ? { definitionId: editing.id, expectedVersion: editing.version } : {}),
      });
    } catch {
      setPending(false);
      setError(t("staffOffers.storageUnavailable"));
      return;
    }
    try {
      const result = await offerApi<ServiceDefinitionDto>(
        editing
          ? `/api/v1/staff/ops/catalog/services/${editing.id}`
          : "/api/v1/staff/ops/catalog/services",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) }
      );
      if (!result.ok) {
        if (result.status === 401) return router.replace("/staff/login");
        if (mutationOutcomeUnknown(result.status)) {
          setUnknown(true);
          setError(t("staffOffers.unknown"));
        } else {
          clearPendingCatalogOperation();
          if (result.status === 409) await load();
          setError(offerFailureMessage(result, t));
        }
        return;
      }
      clearPendingCatalogOperation();
      setMessage(t("staffOffers.saved"));
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch {
      setUnknown(true);
      setError(t("staffOffers.unknown"));
    } finally {
      setPending(false);
    }
  };

  const recheck = async () => {
    try {
      await load();
      // Catalog POST has no idempotency key and a matching code/version is not
      // proof that this browser's lost request committed. Keep writes blocked.
      setError(t("staffOffers.manual"));
    } catch {
      setError(t("staffOffers.manual"));
    }
  };

  const field = (
    key: keyof ServiceForm,
    label: string,
    options?: { textarea?: boolean; dir?: string }
  ) => (
    <div className="space-y-1">
      <label htmlFor={`catalog-${key}`} className="block text-sm font-semibold text-slate-700">
        {label}
      </label>
      {options?.textarea ? (
        <textarea
          id={`catalog-${key}`}
          required
          maxLength={1000}
          rows={3}
          dir={options.dir}
          value={String(form[key])}
          onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))}
          className="w-full rounded-xl border border-slate-300 p-3 focus-visible:ring-2 focus-visible:ring-brand-500"
        />
      ) : (
        <input
          id={`catalog-${key}`}
          required
          maxLength={key === "code" ? 64 : 160}
          dir={options?.dir}
          value={String(form[key])}
          onChange={(event) => setForm((previous) => ({ ...previous, [key]: event.target.value }))}
          className="w-full rounded-xl border border-slate-300 p-3 focus-visible:ring-2 focus-visible:ring-brand-500"
        />
      )}
    </div>
  );

  return (
    <main className="mx-auto max-w-5xl space-y-6" dir={dir}>
      <header>
        <h1 className="text-2xl font-bold">{t("staffOffers.catalog")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("staffOffers.catalogIntro")}</p>
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
        <button
          type="button"
          onClick={recheck}
          className="rounded-xl bg-slate-900 px-4 py-2 text-white"
        >
          {t("staffOffers.reconcile")}
        </button>
      )}
      {canManage && (
        <form
          onSubmit={save}
          className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-lg font-bold">
            {t(editing ? "staffOffers.editService" : "staffOffers.createService")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("code", t("staffOffers.code"), { dir: "ltr" })}
            <div>
              <label
                htmlFor="catalog-categoryId"
                className="block text-sm font-semibold text-slate-700"
              >
                {t("staffOffers.category")}
              </label>
              <select
                id="catalog-categoryId"
                required
                value={form.categoryId}
                onChange={(event) => {
                  const category = categories.find((item) => item.id === event.target.value);
                  setForm((previous) => ({
                    ...previous,
                    categoryId: event.target.value,
                    pricingMode:
                      category?.code === "GENERAL_REPAIRS"
                        ? "QUOTE_REQUIRED"
                        : previous.pricingMode,
                    itemSku: category?.code === "ACCESSORIES" ? previous.itemSku : "",
                  }));
                }}
                className="mt-1 w-full rounded-xl border border-slate-300 p-3"
              >
                <option value="">{t("staffOffers.choose")}</option>
                {categories
                  .filter((category) => category.isActive)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {locale === "ar" ? category.nameAr : category.nameEn}
                    </option>
                  ))}
              </select>
            </div>
            {field("nameEn", t("staffOffers.serviceEn"), { dir: "ltr" })}
            {field("nameAr", t("staffOffers.serviceAr"), { dir: "rtl" })}
            {field("scopeEn", t("staffOffers.scopeEn"), { textarea: true, dir: "ltr" })}
            {field("scopeAr", t("staffOffers.scopeAr"), { textarea: true, dir: "rtl" })}
            <div>
              <label
                htmlFor="catalog-pricingMode"
                className="block text-sm font-semibold text-slate-700"
              >
                {t("staffOffers.pricingMode")}
              </label>
              <select
                id="catalog-pricingMode"
                value={form.pricingMode}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    pricingMode: event.target.value as ServiceForm["pricingMode"],
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-300 p-3"
              >
                <option value="FIXED_SCOPE" disabled={selectedCategory?.code === "GENERAL_REPAIRS"}>
                  {t("staffOffers.fixedScope")}
                </option>
                <option value="QUOTE_REQUIRED">{t("staffOffers.quoteRequired")}</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="catalog-itemSku"
                className="block text-sm font-semibold text-slate-700"
              >
                {t("staffOffers.sku")}
              </label>
              <input
                id="catalog-itemSku"
                dir="ltr"
                required={selectedCategory?.code === "ACCESSORIES"}
                value={form.itemSku}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, itemSku: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-300 p-3"
              />
            </div>
          </div>
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, isActive: event.target.checked }))
                }
              />
              {t("staffOffers.active")}
            </label>
          )}
          <div className="flex gap-3">
            <button
              disabled={pending || unknown}
              type="submit"
              className="rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              {pending ? t("staffOffers.saving") : t("staffOffers.saveService")}
            </button>
            {editing && (
              <button
                type="button"
                disabled={pending || unknown}
                onClick={() => {
                  setEditing(null);
                  setForm(emptyForm);
                }}
                className="rounded-xl border px-5 py-3"
              >
                {t("staffOffers.editAnswers")}
              </button>
            )}
          </div>
        </form>
      )}
      <div className="space-y-4">
        {categories.map((category) => (
          <section key={category.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-bold">{locale === "ar" ? category.nameAr : category.nameEn}</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {category.definitions.map((definition) => (
                <li
                  key={definition.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <div>
                    <strong>{locale === "ar" ? definition.nameAr : definition.nameEn}</strong>
                    <p className="text-slate-600">
                      {locale === "ar" ? definition.scopeAr : definition.scopeEn}
                    </p>
                    <bdi dir="ltr" className="font-mono text-xs text-slate-500">
                      {definition.code}
                    </bdi>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>
                      {t(
                        definition.pricingMode === "FIXED_SCOPE"
                          ? "staffOffers.fixedScope"
                          : "staffOffers.quoteRequired"
                      )}
                    </span>
                    {!definition.isActive && <span>{t("staffOffers.statusRejected")}</span>}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => edit(definition)}
                        className="rounded-lg border px-3 py-2"
                      >
                        {t("staffOffers.editService")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
