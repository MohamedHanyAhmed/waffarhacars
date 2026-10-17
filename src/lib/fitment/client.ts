export type CapabilityAction = "CREATE" | "EDIT" | "SUBMIT" | "APPROVE" | "REJECT" | "WITHDRAW";
export type CapabilityStatus = "DRAFT" | "PENDING_REVIEW" | "ACTIVE" | "REJECTED" | "WITHDRAWN";
export type CapabilityCoverage = {
  makeId: string;
  modelId: string;
  yearFrom: number;
  yearTo: number;
};
export type CapabilityLabel = { id: string; nameEn: string; nameAr: string; isActive: boolean };
export type CapabilityCategory = CapabilityLabel & { code: string };
export type CapabilityPolicy = {
  id: string;
  categoryId: string;
  sequenceNumber: number;
  status: CapabilityStatus;
  version: number;
  evidenceRef: string | null;
  attested: boolean;
  category: CapabilityCategory;
  coverage: Array<CapabilityCoverage & { make: CapabilityLabel; model: CapabilityLabel }>;
  eligibility: {
    edit: boolean;
    submit: boolean;
    approve: boolean;
    reject: boolean;
    withdraw: boolean;
  };
  isCurrent: boolean;
  rejectionReason: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CurrentCapability = {
  categoryId: string;
  activeVersionId: string | null;
  version: number;
  activePolicyVersion: number | null;
  activePolicySequenceNumber: number | null;
  activePolicyStatus: CapabilityStatus | null;
  category: CapabilityCategory;
};
export type CapabilityWorkspace = {
  policies: CapabilityPolicy[];
  context: {
    branchId: string;
    providerOrganizationId: string;
    providerStatus: string;
    branchStatus: string;
    canCreate: boolean;
  };
  currentByCategory: CurrentCapability[];
};
export type CapabilityReceipt = {
  commandId: string;
  action: CapabilityAction;
  policyId: string;
  outcome: "APPLIED";
  resultVersion: number;
  recordedAt: string;
};
export type CapabilityRequest = {
  commandId: string;
  expectedVersion?: number;
  categoryId?: string;
  evidenceRef?: string;
  coverage?: CapabilityCoverage[];
  attested?: true;
  reason?: string;
};
/** Identity/CAS metadata only. Never persist evidence, coverage or reason bodies. */
export type CapabilityJournal = {
  schema: 1;
  actorId: string;
  branchId: string;
  commandId: string;
  action: CapabilityAction;
  policyId?: string;
  categoryId?: string;
  expectedVersion?: number;
  fingerprint: string;
};
export const CAPABILITY_JOURNAL_KEY = "waffarhacars_capability_pending_v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions: CapabilityAction[] = ["CREATE", "EDIT", "SUBMIT", "APPROVE", "REJECT", "WITHDRAW"];
const keys = [
  "schema",
  "actorId",
  "branchId",
  "commandId",
  "action",
  "policyId",
  "categoryId",
  "expectedVersion",
  "fingerprint",
];
type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type JournalRead =
  | { kind: "empty" }
  | { kind: "valid"; journal: CapabilityJournal }
  | { kind: "invalid" | "unavailable" };

export function parseCapabilityJournal(raw: string): CapabilityJournal | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const j = value as Record<string, unknown>;
    if (
      Object.keys(j).some((key) => !keys.includes(key)) ||
      j.schema !== 1 ||
      ![j.actorId, j.branchId, j.commandId].every(
        (id) => typeof id === "string" && uuid.test(id)
      ) ||
      !actions.includes(j.action as CapabilityAction) ||
      typeof j.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(j.fingerprint)
    )
      return null;
    if (j.action === "CREATE") {
      if (
        typeof j.categoryId !== "string" ||
        !uuid.test(j.categoryId) ||
        j.policyId !== undefined ||
        j.expectedVersion !== undefined
      )
        return null;
    } else if (
      typeof j.policyId !== "string" ||
      !uuid.test(j.policyId) ||
      !Number.isInteger(j.expectedVersion) ||
      Number(j.expectedVersion) < 1 ||
      j.categoryId !== undefined
    )
      return null;
    return j as CapabilityJournal;
  } catch {
    return null;
  }
}

export function readCapabilityJournal(storage?: JournalStorage): JournalRead {
  if (!storage && typeof window === "undefined") return { kind: "empty" };
  try {
    const raw = (storage ?? window.sessionStorage).getItem(CAPABILITY_JOURNAL_KEY);
    if (raw === null) return { kind: "empty" };
    const journal = parseCapabilityJournal(raw);
    return journal ? { kind: "valid", journal } : { kind: "invalid" };
  } catch {
    return { kind: "unavailable" };
  }
}

export function writeCapabilityJournal(journal: CapabilityJournal, storage?: JournalStorage): void {
  if (!parseCapabilityJournal(JSON.stringify(journal)))
    throw new Error("Invalid capability journal");
  const target = storage ?? window.sessionStorage;
  const existing = readCapabilityJournal(target);
  if (
    existing.kind !== "empty" &&
    !(
      existing.kind === "valid" &&
      existing.journal.commandId === journal.commandId &&
      existing.journal.actorId === journal.actorId &&
      existing.journal.fingerprint === journal.fingerprint
    )
  )
    throw new Error("Capability command unresolved");
  target.setItem(CAPABILITY_JOURNAL_KEY, JSON.stringify(journal));
  const recorded = readCapabilityJournal(target);
  if (
    recorded.kind !== "valid" ||
    recorded.journal.commandId !== journal.commandId ||
    recorded.journal.fingerprint !== journal.fingerprint
  )
    throw new Error("Capability journal unavailable");
}

export function clearCapabilityJournal(
  actorId: string,
  commandId: string,
  storage?: JournalStorage
): boolean {
  const target = storage ?? window.sessionStorage;
  const current = readCapabilityJournal(target);
  if (
    current.kind !== "valid" ||
    current.journal.actorId !== actorId ||
    current.journal.commandId !== commandId
  )
    return false;
  target.removeItem(CAPABILITY_JOURNAL_KEY);
  return readCapabilityJournal(target).kind === "empty";
}

/** Same stable ordering for initial dispatch and deliberate content reconstruction. */
export function capabilityRequest(
  journal: Pick<CapabilityJournal, "action" | "commandId" | "categoryId" | "expectedVersion">,
  content?: { evidenceRef?: string; coverage?: CapabilityCoverage[]; reason?: string }
): CapabilityRequest {
  const { action, commandId } = journal;
  const coverage = content?.coverage
    ?.map(({ makeId, modelId, yearFrom, yearTo }) => ({ makeId, modelId, yearFrom, yearTo }))
    .sort(
      (a, b) =>
        a.makeId.localeCompare(b.makeId) ||
        a.modelId.localeCompare(b.modelId) ||
        a.yearFrom - b.yearFrom ||
        a.yearTo - b.yearTo
    );
  if (action === "CREATE")
    return {
      commandId,
      categoryId: journal.categoryId,
      evidenceRef: content?.evidenceRef?.trim(),
      coverage,
    };
  if (action === "EDIT")
    return {
      commandId,
      expectedVersion: journal.expectedVersion,
      evidenceRef: content?.evidenceRef?.trim(),
      coverage,
    };
  if (action === "APPROVE")
    return { commandId, expectedVersion: journal.expectedVersion, attested: true };
  if (action === "REJECT")
    return { commandId, expectedVersion: journal.expectedVersion, reason: content?.reason?.trim() };
  return { commandId, expectedVersion: journal.expectedVersion };
}

export async function capabilityRequestFingerprint(
  identity: Pick<CapabilityJournal, "actorId" | "branchId" | "policyId" | "action">,
  body: CapabilityRequest
): Promise<string> {
  const value = JSON.stringify([
    "capability-ui-intent-v1",
    identity.actorId,
    identity.branchId,
    identity.policyId ?? null,
    identity.action,
    body,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function capabilityCommandPath(journal: CapabilityJournal): string {
  const base = `/api/v1/staff/branches/${journal.branchId}/fitment-policies`;
  if (journal.action === "CREATE") return base;
  if (journal.action === "EDIT") return `${base}/${journal.policyId}`;
  return `${base}/${journal.policyId}/${journal.action.toLowerCase()}`;
}

export function ownsCapabilityCallback(
  journal: CapabilityJournal,
  actorId: string | undefined,
  branchId: string,
  dispatchedGeneration: number,
  currentGeneration: number,
  stored: JournalRead
): boolean {
  return (
    actorId === journal.actorId &&
    branchId === journal.branchId &&
    dispatchedGeneration === currentGeneration &&
    stored.kind === "valid" &&
    stored.journal.actorId === journal.actorId &&
    stored.journal.branchId === journal.branchId &&
    stored.journal.commandId === journal.commandId &&
    stored.journal.fingerprint === journal.fingerprint
  );
}
