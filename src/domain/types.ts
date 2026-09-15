import { Money, BasisPoints } from "./money";

export type ServiceCategoryId =
  "maintenance" | "repairs" | "wash" | "tyres" | "batteries" | "ac" | "accessories";

export interface ServiceCategory {
  id: ServiceCategoryId;
  iconName: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
}

export type ActorRole = "customer" | "provider_staff" | "sales" | "operations";

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  engineTrim: string;
  licensePlate: string;
}

export interface ProviderBranch {
  id: string;
  providerId: string;
  nameEn: string;
  nameAr: string;
  areaEn: string;
  areaAr: string;
  addressEn: string;
  addressAr: string;
  distanceKm: number;
  phone: string;
}

export interface Provider {
  id: string;
  nameEn: string;
  nameAr: string;
  isDemo: true;
  verifiedBusiness: boolean;
  creditLimit: Money;
  branches: ProviderBranch[];
}

export interface ProviderDraft {
  id: string;
  nameEn: string;
  nameAr: string;
  commercialRegistrationNumber: string;
  taxId: string;
  workshopAddressEn: string;
  workshopAddressAr: string;
  clusterArea: string; // e.g. "Nasr City"
  contactPhone: string;
  isTrainedRedeemer: boolean;
  creditLimit: Money;
}

export interface PriceEvidence {
  id: string;
  fileName: string;
  evidenceType: "official_price_list" | "prior_invoice" | "service_board";
  capturedDate: string; // Deterministic ISO timestamp
  fileSizeBytes: number;
  description: string;
}

export interface ApprovalMetadata {
  draftId: string;
  submittedBySalesId: string;
  submittedAt: string;
  reviewedByOpsId: string;
  reviewedAt: string;
  decision: "approved" | "rejected";
  decisionRationaleEn: string;
  decisionRationaleAr: string;
}

export interface VehicleCompatibilityRule {
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
}

export interface OfferVariant {
  id: string;
  providerId: string;
  branchId: string;
  serviceCategory: ServiceCategoryId;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  normalPrice: Money; // e.g. 120000 (EGP 1,200)
  discountBps: BasisPoints; // e.g. 2000 (20%)
  lockedPrice: Money; // e.g. 96000 (EGP 960)
  saving: Money; // e.g. 24000 (EGP 240)
  commissionBps: BasisPoints; // e.g. 1000 (10%)
  inclusionsEn: string[];
  inclusionsAr: string[];
  exclusionsEn: string[];
  exclusionsAr: string[];
  partsSpecificationEn: string;
  partsSpecificationAr: string;
  laborIncluded: boolean;
  durationMinutes: number;
  warrantyTermsEn: string;
  warrantyTermsAr: string;
  additionalWorkRuleEn: string;
  additionalWorkRuleAr: string;
  cancellationPolicyEn: string;
  cancellationPolicyAr: string;
  compatibleVehicles: VehicleCompatibilityRule[];
  status: "published";
  isSponsored?: boolean;
  rating: number;
  reviewCount: number;
}

export interface OfferDraft {
  id: string;
  providerId: string;
  branchId: string;
  serviceCategory: ServiceCategoryId;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  normalPrice: Money;
  discountBps: BasisPoints;
  commissionBps: BasisPoints;
  priceEvidence: PriceEvidence | null;
  status: "draft" | "pending_ops_approval" | "approved" | "rejected";
  createdBySalesId: string;
  createdAt: string;
  approvalMetadata?: ApprovalMetadata;
}

export type ReservationStatus =
  "confirmed" | "checked_in" | "completed" | "customer_cancelled" | "no_show" | "disputed";

export interface VerifiedReview {
  rating: number;
  scopeHonored: boolean;
  priceHonored: boolean;
  comment: string;
  submittedAt: string;
}

export interface PricingSnapshot {
  normalPrice: Money;
  discountBps: BasisPoints;
  lockedPrice: Money;
  saving: Money;
  commissionBps: BasisPoints;
}

export interface CompletionPinDetails {
  pin: string; // e.g. "4921"
  isIssued: boolean;
  issuedAt?: string;
  expiresAt: string;
  isConsumed: boolean;
}

export interface Reservation {
  id: string;
  revision: number; // Aggregate revision for CAS
  passCode: string; // "WC-7492"
  qrTokenHash: string;
  customerName: string;
  customerPhoneMasked: string; // "+20 10 **** 5821"
  vehicle: Vehicle;
  provider: Provider;
  branch: ProviderBranch;
  offerSnapshot: OfferVariant; // Frozen immutable offer metadata
  pricingSnapshot: PricingSnapshot; // Authoritative frozen pricing
  scheduledSlot: string; // Deterministic e.g. "Today, 3:30 PM"
  status: ReservationStatus;
  checkInTimestamp?: string;
  checkedInByStaffId?: string;
  completionPinDetails: CompletionPinDetails | null; // null until arrival/reveal
  completionTimestamp?: string;
  commissionAccrualId?: string; // Authoritative reference to CommissionAccrual
  isMutuallyConfirmed: boolean;
  verifiedReview?: VerifiedReview;
}

export interface CommissionAccrual {
  id: string;
  reservationId: string;
  passCode: string;
  providerId: string;
  providerNameEn: string;
  providerNameAr: string;
  branchNameEn: string;
  branchNameAr: string;
  serviceTitleEn: string;
  serviceTitleAr: string;
  lockedPrice: Money;
  commissionRateBps: BasisPoints;
  commissionAmount: Money; // Authoritative calculated commission
  providerNet: Money; // Authoritative calculated net
  status: "unbilled" | "statement_pending" | "invoiced" | "paid";
  accruedAt: string;
}

export interface ProviderStatement {
  providerId: string;
  providerNameEn: string;
  providerNameAr: string;
  completedReservationsCount: number;
  totalServiceVolume: Money;
  totalCommissionAccrued: Money;
  creditLimit: Money;
  currentExposure: Money;
  isExposureHealthy: boolean;
  accruals: CommissionAccrual[];
}

export interface ActorContext {
  actorId: string;
  role: ActorRole;
}

export type DemoScenarioMode =
  | "clean_empty"
  | "loading"
  | "incompatible_vehicle"
  | "confirmed"
  | "checked_in_unissued"
  | "checked_in_valid_pin"
  | "wrong_pin"
  | "expired_pin"
  | "cancelled"
  | "no_show"
  | "already_completed";
