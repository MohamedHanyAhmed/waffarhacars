import { deriveOfferPricing } from "@/domain/offerPricing";

export type OfferStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

export function offerStatusKey(status: OfferStatus): string {
  return {
    DRAFT: "staffOffers.statusDraft",
    PENDING_REVIEW: "staffOffers.statusPending",
    APPROVED: "staffOffers.statusApproved",
    REJECTED: "staffOffers.statusRejected",
  }[status];
}
export type OfferMutationKind = "create" | "edit" | "submit" | "successor" | "approve" | "reject";

export interface OfferRevisionDto {
  id: string;
  offerId: string;
  requestId: string;
  revisionNumber: number;
  version: number;
  status: OfferStatus;
  createdByUserId: string;
  submittedByUserId: string | null;
  submittedAt: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  titleEn: string;
  titleAr: string;
  includedLaborEn: string;
  includedLaborAr: string;
  includedPartsEn: string;
  includedPartsAr: string;
  excludedLaborEn: string;
  excludedLaborAr: string;
  excludedPartsEn: string;
  excludedPartsAr: string;
  bookingRule: "APPOINTMENT_REQUIRED" | "WALK_IN_ALLOWED" | "CONTACT_TO_BOOK";
  durationMinutes: number;
  validFrom: string;
  validUntil: string;
  normalPriceMinor: string;
  customerPriceMinor: string;
  savingsMinor: string;
  discountRateBps: string;
  evidencePacketId: string;
  evidenceType: string;
  evidenceDate: string;
  priceBasisNotes: string;
  commercialTermsPacketId: string;
  commercialTermsAgreedAt: string;
  commissionBasis: "DISCOUNTED_CUSTOMER_PRICE";
  commissionRateBps: number;
  serviceDefinitionId: string;
  serviceNameEn: string;
  serviceNameAr: string;
  serviceCode: string;
  serviceScopeEn: string;
  serviceScopeAr: string;
  categoryCode: string;
  categoryNameEn: string;
  categoryNameAr: string;
  offer?: OfferDto;
}

export interface OfferDto {
  id: string;
  creationRequestId: string;
  providerOrganizationId: string;
  branchId: string;
  serviceDefinitionId: string;
  currentApprovedRevisionId: string | null;
  providerOrganization?: { id: string; nameEn: string; nameAr: string; status: string };
  branch?: { id: string; nameEn: string; nameAr: string; status: string };
  revisions?: OfferRevisionDto[];
}

export interface ServiceDefinitionDto {
  id: string;
  code: string;
  categoryId: string;
  nameEn: string;
  nameAr: string;
  scopeEn: string;
  scopeAr: string;
  pricingMode: "FIXED_SCOPE" | "QUOTE_REQUIRED";
  itemSku: string | null;
  isActive: boolean;
  version: number;
}

export interface ServiceCategoryDto {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  definitions: ServiceDefinitionDto[];
}

export interface OfferDraftPayload {
  titleEn: string;
  titleAr: string;
  includedLaborEn: string;
  includedLaborAr: string;
  includedPartsEn: string;
  includedPartsAr: string;
  excludedLaborEn: string;
  excludedLaborAr: string;
  excludedPartsEn: string;
  excludedPartsAr: string;
  bookingRule: OfferRevisionDto["bookingRule"];
  durationMinutes: number;
  validFrom: string;
  validUntil: string;
  normalPriceMinor: string;
  customerPriceMinor: string;
  evidencePacketId: string;
  evidenceType: string;
  evidenceDate: string;
  priceBasisNotes: string;
  commercialTermsPacketId: string;
  commercialTermsAgreedAt: string;
  commissionBasis: "DISCOUNTED_CUSTOMER_PRICE";
  commissionRateBps: number;
}

export interface PendingOfferOperation {
  operationId: string;
  kind: OfferMutationKind;
  offerId?: string;
  revisionId?: string;
  creationRequestId?: string;
  revisionRequestId?: string;
  expectedVersion?: number;
  unresolved: true;
}

export type PublicationAction = "PUBLISH" | "REPLACE" | "UNPUBLISH";
export type PublicationStatus = "PUBLISHED" | "UNPUBLISHED";

export interface StaffPublicationDto {
  offerId: string;
  status: PublicationStatus;
  version: number;
  pinnedRevisionId: string | null;
  effectiveVisible: boolean;
  hiddenReasons: string[];
}

export interface PublicationCommandDto {
  commandId: string;
  action: PublicationAction;
  outcome: "APPLIED" | "REJECTED";
  resultVersion?: number;
  resultStatus?: PublicationStatus;
  pinnedRevisionId?: string | null;
  httpStatus?: number;
  errorCode?: string;
}

export interface PublicationCommandResult {
  command: PublicationCommandDto;
  publication: StaffPublicationDto;
}

/** Only command identity and CAS metadata, never offer terms or private packet references. */
export interface PendingPublicationOperation {
  commandId: string;
  offerId: string;
  actorUserId: string;
  action: PublicationAction;
  revisionId?: string;
  expectedVersion: number;
}

const JOURNAL_KEY = "waffarhacars_offer_pending_v1";
const CATALOG_JOURNAL_KEY = "waffarhacars_catalog_pending_v1";
const PUBLICATION_JOURNAL_KEY = "waffarhacars_publication_pending_v1";

export function readPendingPublicationOperation(): PendingPublicationOperation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PUBLICATION_JOURNAL_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const operation = value as Partial<PendingPublicationOperation>;
    if (
      typeof operation.commandId !== "string" ||
      typeof operation.offerId !== "string" ||
      typeof operation.actorUserId !== "string" ||
      !["PUBLISH", "REPLACE", "UNPUBLISH"].includes(operation.action ?? "") ||
      typeof operation.expectedVersion !== "number"
    )
      return null;
    return operation as PendingPublicationOperation;
  } catch {
    return null;
  }
}

export function writePendingPublicationOperation(operation: PendingPublicationOperation): void {
  const existing = readPendingPublicationOperation();
  if (existing && existing.commandId !== operation.commandId)
    throw new Error("A different publication command is unresolved");
  sessionStorage.setItem(PUBLICATION_JOURNAL_KEY, JSON.stringify(operation));
}

export function clearPendingPublicationOperation(commandId: string): boolean {
  if (readPendingPublicationOperation()?.commandId !== commandId) return false;
  sessionStorage.removeItem(PUBLICATION_JOURNAL_KEY);
  return true;
}

export function ownsPendingPublicationCallback(
  commandId: string,
  dispatchedGeneration: number,
  currentGeneration: number
): boolean {
  return (
    dispatchedGeneration === currentGeneration &&
    readPendingPublicationOperation()?.commandId === commandId
  );
}

export interface PendingCatalogOperation {
  operationId: string;
  code: string;
  definitionId?: string;
  expectedVersion?: number;
}

export function readPendingCatalogOperation(): PendingCatalogOperation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CATALOG_JOURNAL_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const pending = value as Partial<PendingCatalogOperation>;
    return typeof pending.code === "string" ? (pending as PendingCatalogOperation) : null;
  } catch {
    return null;
  }
}

export function writePendingCatalogOperation(operation: PendingCatalogOperation): void {
  const existing = readPendingCatalogOperation();
  if (existing && existing.operationId !== operation.operationId)
    throw new Error("A different catalog operation is unresolved");
  sessionStorage.setItem(CATALOG_JOURNAL_KEY, JSON.stringify(operation));
}

export function clearPendingCatalogOperation(operationId: string): boolean {
  if (readPendingCatalogOperation()?.operationId !== operationId) return false;
  sessionStorage.removeItem(CATALOG_JOURNAL_KEY);
  return true;
}

export function ownsPendingCatalogCallback(
  operationId: string,
  dispatchedGeneration: number,
  currentGeneration: number
): boolean {
  return (
    dispatchedGeneration === currentGeneration &&
    readPendingCatalogOperation()?.operationId === operationId
  );
}

export function readPendingOfferOperation(): PendingOfferOperation | null {
  if (typeof window === "undefined") return null;
  try {
    const value = sessionStorage.getItem(JOURNAL_KEY);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const operation = parsed as Partial<PendingOfferOperation>;
    if (operation.unresolved !== true || !operation.kind) return null;
    return operation as PendingOfferOperation;
  } catch {
    return null;
  }
}

export function writePendingOfferOperation(operation: PendingOfferOperation): void {
  const existing = readPendingOfferOperation();
  if (existing && existing.operationId !== operation.operationId)
    throw new Error("A different offer operation is unresolved");
  sessionStorage.setItem(JOURNAL_KEY, JSON.stringify(operation));
}

export function clearPendingOfferOperation(operationId: string): boolean {
  if (readPendingOfferOperation()?.operationId !== operationId) return false;
  sessionStorage.removeItem(JOURNAL_KEY);
  return true;
}

export function ownsPendingOfferCallback(
  operationId: string,
  dispatchedGeneration: number,
  currentGeneration: number
): boolean {
  return (
    dispatchedGeneration === currentGeneration &&
    readPendingOfferOperation()?.operationId === operationId
  );
}

/** A newer server version settles this CAS attempt, not proof that its values won. */
export function editReconciliationAdvanced(
  operation: PendingOfferOperation,
  offerId: string,
  revisionId: string,
  serverVersion: number
): boolean {
  return (
    operation.kind === "edit" &&
    operation.offerId === offerId &&
    operation.revisionId === revisionId &&
    operation.expectedVersion !== undefined &&
    serverVersion > operation.expectedVersion
  );
}

/** Exact decimal EGP to integer piastres, with no floating-point arithmetic. */
export function egpToMinor(input: string): string | null {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  return minor.toString().length <= 18 ? minor.toString() : null;
}

export function minorToEgp(input: string): string {
  const value = BigInt(input);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

export function offerDiscountBps(normalMinor: string, customerMinor: string): string | null {
  try {
    return deriveOfferPricing(
      BigInt(normalMinor),
      BigInt(customerMinor)
    ).discountRateBps.toString();
  } catch {
    return null;
  }
}

const cairoFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function cairoParts(instant: Date) {
  const parts = Object.fromEntries(
    cairoFormatter.formatToParts(instant).map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function utcToCairoInput(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid instant");
  const parts = cairoParts(date);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}T${parts.hour.toString().padStart(2, "0")}:${parts.minute.toString().padStart(2, "0")}`;
}

/** Rejects Cairo clock gaps and ambiguous repeated times instead of guessing. */
export function cairoInputToUtc(input: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(naive)) return null;
  const requested = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  const matches = new Set<number>();
  for (const probe of [
    naive - 86_400_000,
    naive - 43_200_000,
    naive,
    naive + 43_200_000,
    naive + 86_400_000,
  ]) {
    const parts = cairoParts(new Date(probe));
    const observedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute
    );
    const candidate = naive - (observedAsUtc - probe);
    if (utcToCairoInput(new Date(candidate).toISOString()) === requested) matches.add(candidate);
  }
  return matches.size === 1 ? new Date([...matches][0]).toISOString() : null;
}
