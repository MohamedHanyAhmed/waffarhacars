import { z } from "zod";

export type CoverageRow = {
  makeId: string;
  modelId: string;
  yearFrom: number;
  yearTo: number;
};

export type LabelledCoverageRow = CoverageRow & {
  makeNameEn: string;
  makeNameAr: string;
  modelNameEn: string;
  modelNameAr: string;
  makeIsActive: boolean;
  modelIsActive: boolean;
};

const uuid = z.string().uuid();
const opaqueReference = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const unsafeReason = /(?:https?:\/\/|www\.)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\+?\d[\d\s().-]{8,}\d/i;

export function maximumCoveredYear(now = new Date()): number {
  return (
    Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric" }).format(now)
    ) + 1
  );
}

export function validateEvidenceReference(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 128 && opaqueReference.test(trimmed)
    ? null
    : "capabilities.validation.evidence";
}

export function validateRejectionReason(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 1000 && !unsafeReason.test(trimmed)
    ? null
    : "capabilities.validation.reason";
}

/** Mirrors structural checks; only the server can verify current canonical ownership/activity. */
export function validateCoverageRows(rows: CoverageRow[], now = new Date()): string | null {
  const maxYear = maximumCoveredYear(now);
  if (
    rows.length < 1 ||
    rows.length > 50 ||
    rows.some(
      (row) =>
        !uuid.safeParse(row.makeId).success ||
        !uuid.safeParse(row.modelId).success ||
        !Number.isInteger(row.yearFrom) ||
        !Number.isInteger(row.yearTo) ||
        row.yearFrom < 1900 ||
        row.yearTo > maxYear ||
        row.yearTo < row.yearFrom
    )
  ) {
    return "capabilities.coverage.invalid";
  }
  const sorted = [...rows].sort(
    (a, b) =>
      a.makeId.localeCompare(b.makeId) ||
      a.modelId.localeCompare(b.modelId) ||
      a.yearFrom - b.yearFrom
  );
  const modelMakes = new Map<string, string>();
  for (let index = 0; index < sorted.length; index++) {
    const row = sorted[index];
    if (modelMakes.has(row.modelId) && modelMakes.get(row.modelId) !== row.makeId)
      return "capabilities.coverage.invalid";
    modelMakes.set(row.modelId, row.makeId);
    const previous = sorted[index - 1];
    if (previous?.modelId === row.modelId && previous.yearTo >= row.yearFrom)
      return "capabilities.coverage.overlap";
  }
  return null;
}

export type VehicleCatalogChoice = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  makeId?: string;
};

export type VehicleCatalogPage = {
  items: VehicleCatalogChoice[];
  nextCursor: string | null;
};

const catalogPageSchema = z.object({
  items: z.array(
    z.object({
      id: uuid,
      code: z.string(),
      nameEn: z.string(),
      nameAr: z.string(),
      makeId: uuid.optional(),
    })
  ),
  nextCursor: uuid.nullable(),
});

/** Catalogue transport only: no mutation, evidence or private record content. */
export async function loadVehicleCatalogPage(
  options: { makeId?: string; cursor?: string },
  signal: AbortSignal,
  transport: typeof fetch = fetch
): Promise<VehicleCatalogPage> {
  const params = new URLSearchParams({ limit: "30" });
  if (options.makeId) params.set("makeId", options.makeId);
  if (options.cursor) params.set("cursor", options.cursor);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const deadline = setTimeout(abort, 12_000);
  try {
    const response = await transport(`/api/v1/vehicles/catalog?${params}`, {
      signal: controller.signal,
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("CATALOG_UNAVAILABLE");
    const parsed = catalogPageSchema.safeParse(await response.json());
    if (
      !parsed.success ||
      (options.makeId && parsed.data.items.some((item) => item.makeId !== options.makeId)) ||
      (options.cursor && parsed.data.nextCursor === options.cursor)
    ) {
      throw new Error("CATALOG_UNAVAILABLE");
    }
    return parsed.data;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
  }
}

export function appendCatalogPage(
  current: VehicleCatalogChoice[],
  next: VehicleCatalogChoice[]
): VehicleCatalogChoice[] {
  const choices = new Map(current.map((item) => [item.id, item]));
  for (const item of next) choices.set(item.id, item);
  return [...choices.values()];
}
