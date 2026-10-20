import type { CoverageRow, LabelledCoverageRow } from "./client-validation";

export const OFFER_FITMENT_MODES = [
  "BASE_VEHICLE_ALL_VARIANTS_VERIFIED",
  "SERVICE_VEHICLE_INDEPENDENT_WITHIN_LISTED_COVERAGE",
] as const;
export type OfferFitmentMode = (typeof OFFER_FITMENT_MODES)[number];
export type OfferFitmentReview = {
  offerId: string;
  revisionId: string;
  version: number;
  mode: OfferFitmentMode | null;
  evidenceRef: string | null;
  context?: {
    providerStatus: string;
    branchStatus: string;
    serviceIsActive: boolean;
    categoryIsActive: boolean;
  };
  coverage: Array<
    CoverageRow & {
      make: { id: string; nameEn: string; nameAr: string; isActive: boolean };
      model: { id: string; nameEn: string; nameAr: string; isActive: boolean };
    }
  >;
};
export type OfferFitmentContent = {
  mode: OfferFitmentMode;
  evidenceRef: string;
  coverage: CoverageRow[];
};
export type OfferFitmentRequest = OfferFitmentContent & {
  commandId: string;
  expectedVersion: number;
};
export type OfferFitmentReceipt = {
  commandId: string;
  outcome: "APPLIED";
  resultVersion: number;
};
/** Metadata only. Evidence, coverage and mode are intentionally never persisted. */
export type OfferFitmentJournal = {
  schema: 1;
  actorId: string;
  offerId: string;
  revisionId: string;
  commandId: string;
  expectedVersion: number;
  fingerprint: string;
};
export const OFFER_FITMENT_JOURNAL_KEY = "waffarhacars_offer_fitment_pending_v1";
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type OfferFitmentJournalRead =
  | { kind: "empty" }
  | { kind: "valid"; journal: OfferFitmentJournal }
  | { kind: "invalid" | "unavailable" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = [
  "schema",
  "actorId",
  "offerId",
  "revisionId",
  "commandId",
  "expectedVersion",
  "fingerprint",
];
export function parseOfferFitmentJournal(raw: string): OfferFitmentJournal | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const j = parsed as Record<string, unknown>;
    if (
      Object.keys(j).length !== fields.length ||
      Object.keys(j).some((key) => !fields.includes(key)) ||
      j.schema !== 1 ||
      ![j.actorId, j.offerId, j.revisionId, j.commandId].every(
        (value) => typeof value === "string" && uuid.test(value)
      ) ||
      !Number.isSafeInteger(j.expectedVersion) ||
      Number(j.expectedVersion) < 1 ||
      typeof j.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(j.fingerprint)
    )
      return null;
    return j as OfferFitmentJournal;
  } catch {
    return null;
  }
}
export function readOfferFitmentJournal(storage?: StoragePort): OfferFitmentJournalRead {
  if (!storage && typeof window === "undefined") return { kind: "empty" };
  try {
    const raw = (storage ?? window.sessionStorage).getItem(OFFER_FITMENT_JOURNAL_KEY);
    if (raw === null) return { kind: "empty" };
    const journal = parseOfferFitmentJournal(raw);
    return journal ? { kind: "valid", journal } : { kind: "invalid" };
  } catch {
    return { kind: "unavailable" };
  }
}
export function sameOfferFitmentJournal(a: OfferFitmentJournal, b: OfferFitmentJournal): boolean {
  return fields.every(
    (field) => a[field as keyof OfferFitmentJournal] === b[field as keyof OfferFitmentJournal]
  );
}
export function writeOfferFitmentJournal(
  journal: OfferFitmentJournal,
  storage?: StoragePort
): void {
  if (!parseOfferFitmentJournal(JSON.stringify(journal))) throw new Error("INVALID_JOURNAL");
  const target = storage ?? window.sessionStorage;
  const previous = readOfferFitmentJournal(target);
  if (
    previous.kind !== "empty" &&
    !(previous.kind === "valid" && sameOfferFitmentJournal(previous.journal, journal))
  )
    throw new Error("UNRESOLVED_COMMAND");
  target.setItem(OFFER_FITMENT_JOURNAL_KEY, JSON.stringify(journal));
  const recorded = readOfferFitmentJournal(target);
  if (recorded.kind !== "valid" || !sameOfferFitmentJournal(recorded.journal, journal))
    throw new Error("STORAGE_UNAVAILABLE");
}
export function clearOfferFitmentJournal(
  journal: OfferFitmentJournal,
  storage?: StoragePort
): boolean {
  const target = storage ?? window.sessionStorage;
  const recorded = readOfferFitmentJournal(target);
  if (recorded.kind !== "valid" || !sameOfferFitmentJournal(recorded.journal, journal))
    return false;
  target.removeItem(OFFER_FITMENT_JOURNAL_KEY);
  return readOfferFitmentJournal(target).kind === "empty";
}
export function offerFitmentRequest(
  identity: Pick<OfferFitmentJournal, "commandId" | "expectedVersion">,
  content: OfferFitmentContent
): OfferFitmentRequest {
  return {
    commandId: identity.commandId,
    expectedVersion: identity.expectedVersion,
    mode: content.mode,
    evidenceRef: content.evidenceRef.trim(),
    coverage: content.coverage
      .map(({ makeId, modelId, yearFrom, yearTo }) => ({ makeId, modelId, yearFrom, yearTo }))
      .sort(
        (a, b) =>
          a.makeId.localeCompare(b.makeId) ||
          a.modelId.localeCompare(b.modelId) ||
          a.yearFrom - b.yearFrom ||
          a.yearTo - b.yearTo
      ),
  };
}
export async function offerFitmentFingerprint(
  identity: Pick<OfferFitmentJournal, "actorId" | "offerId" | "revisionId">,
  body: OfferFitmentRequest
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      "offer-fitment-ui-v1",
      identity.actorId,
      identity.offerId,
      identity.revisionId,
      body,
    ])
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function offerFitmentPath(
  identity: Pick<OfferFitmentJournal, "offerId" | "revisionId">
): string {
  return `/api/v1/staff/offers/${identity.offerId}/revisions/${identity.revisionId}/fitment`;
}
export function ownsOfferFitmentCallback(
  journal: OfferFitmentJournal,
  actorId: string | undefined,
  offerId: string,
  revisionId: string,
  dispatched: number,
  current: number,
  stored: OfferFitmentJournalRead
): boolean {
  return (
    journal.actorId === actorId &&
    journal.offerId === offerId &&
    journal.revisionId === revisionId &&
    dispatched === current &&
    stored.kind === "valid" &&
    sameOfferFitmentJournal(journal, stored.journal)
  );
}
export function validOfferFitmentReceipt(
  value: unknown,
  journal: OfferFitmentJournal
): value is OfferFitmentReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<OfferFitmentReceipt>;
  return (
    receipt.commandId === journal.commandId &&
    receipt.outcome === "APPLIED" &&
    receipt.resultVersion === journal.expectedVersion + 1
  );
}
export function labelledOfferCoverage(review: OfferFitmentReview | null): LabelledCoverageRow[] {
  return (
    review?.coverage.map((row) => ({
      ...row,
      makeNameEn: row.make.nameEn,
      makeNameAr: row.make.nameAr,
      modelNameEn: row.model.nameEn,
      modelNameAr: row.model.nameAr,
      makeIsActive: row.make.isActive,
      modelIsActive: row.model.isActive,
    })) ?? []
  );
}
