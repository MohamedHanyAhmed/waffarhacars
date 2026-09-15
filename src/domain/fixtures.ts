import {
  ServiceCategory,
  Provider,
  OfferVariant,
  OfferDraft,
  Reservation,
  PriceEvidence,
  PricingSnapshot,
  CompletionPinDetails,
} from "./types";
import { createMoney, calculateDiscount } from "./money";

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    id: "maintenance",
    iconName: "Wrench",
    nameEn: "Periodic Maintenance",
    nameAr: "صيانة دورية",
    descriptionEn: "Oil change, filters, multi-point inspection",
    descriptionAr: "تغيير زيت وفلاتر وفحص شامل",
  },
  {
    id: "repairs",
    iconName: "Tool",
    nameEn: "Mechanical & Brakes",
    nameAr: "ميكانيكا وفرامل",
    descriptionEn: "Brake pads, suspension, engine diagnostics",
    descriptionAr: "تيل فرامل، عفشة، فحص محرك",
  },
  {
    id: "wash",
    iconName: "Sparkles",
    nameEn: "Car Wash & Detailing",
    nameAr: "غسيل وتلميع",
    descriptionEn: "Steam wash, nano ceramic, interior cleaning",
    descriptionAr: "غسيل بخار، نانو سيراميك، تلميع داخلي",
  },
  {
    id: "tyres",
    iconName: "Disc",
    nameEn: "Tyres & Alignment",
    nameAr: "إطارات وضبط زوايا",
    descriptionEn: "Balancing, nitrogen inflation, puncture repair",
    descriptionAr: "ترصيص، نيتروجين، إصلاح لحام",
  },
  {
    id: "batteries",
    iconName: "Zap",
    nameEn: "Batteries & Electrical",
    nameAr: "بطاريات وكهرباء",
    descriptionEn: "Battery test, replacement, alternator check",
    descriptionAr: "فحص بطارية، استبدال، فحص دينامو",
  },
  {
    id: "ac",
    iconName: "Wind",
    nameEn: "Air Conditioning",
    nameAr: "تكييف سيارات",
    descriptionEn: "Freon recharge, leak test, filter replacement",
    descriptionAr: "شحن فريون، فحص تسريب، تغيير فلتر",
  },
  {
    id: "accessories",
    iconName: "Sliders",
    nameEn: "Accessories & Protection",
    nameAr: "كماليات وحماية",
    descriptionEn: "Tinting, thermal insulation, seat covers",
    descriptionAr: "فيميه، عزل حراري، فرش كراسي",
  },
];

export const DEMO_VEHICLES = {
  defaultSunny: {
    id: "veh-sunny-01",
    make: "Nissan",
    model: "Sunny",
    year: 2021,
    engineTrim: "1.5L Auto",
    licensePlate: "س ق ج 4821",
  },
  incompatibleChery: {
    id: "veh-chery-02",
    make: "Chery",
    model: "Tiggo 7 Pro",
    year: 2024,
    engineTrim: "1.5T Luxury",
    licensePlate: "أ ب ج 9922",
  },
};

export const DEMO_VEHICLE = DEMO_VEHICLES.defaultSunny;
export const INCOMPATIBLE_VEHICLE = DEMO_VEHICLES.incompatibleChery;

export const DEMO_PROVIDERS: Provider[] = [
  {
    id: "prov-orbit-care",
    nameEn: "Orbit Auto Care",
    nameAr: "مركز أوربيت لصيانة السيارات",
    isDemo: true,
    verifiedBusiness: true,
    creditLimit: createMoney(2000), // 200000 minor (EGP 2,000)
    branches: [
      {
        id: "branch-nasr-city-01",
        providerId: "prov-orbit-care",
        nameEn: "Nasr City - Abbas El Akkad Branch",
        nameAr: "فرع مدينة نصر - عباس العقاد",
        areaEn: "Nasr City",
        areaAr: "مدينة نصر",
        addressEn: "14 Abbas El Akkad St, Behind Citystars",
        addressAr: "١٤ شارع عباس العقاد، خلف سيتي ستارز",
        distanceKm: 2.4,
        phone: "02 2401 9820",
      },
    ],
  },
  {
    id: "prov-german-tech",
    nameEn: "German Tech Center",
    nameAr: "المركز الألماني التقني",
    isDemo: true,
    verifiedBusiness: true,
    creditLimit: createMoney(3000),
    branches: [
      {
        id: "branch-heliopolis-01",
        providerId: "prov-german-tech",
        nameEn: "Heliopolis - Nozha St Branch",
        nameAr: "فرع مصر الجديدة - شارع النزهة",
        areaEn: "Heliopolis",
        areaAr: "مصر الجديدة",
        addressEn: "42 Nozha Street, Roxy",
        addressAr: "٤٢ شارع النزهة، روكسي",
        distanceKm: 4.8,
        phone: "02 2633 4410",
      },
    ],
  },
];

// Calculation helpers for published offers
const normalPrice = createMoney(1200); // 120000
const { lockedPrice, saving } = calculateDiscount(normalPrice, 2000); // 96000, 24000

// Incompatible offer for demo (e.g. BMW oil service)
const bmwNormal = createMoney(3500);
const { lockedPrice: bmwLocked, saving: bmwSaving } = calculateDiscount(bmwNormal, 1500);

export const PUBLISHED_OFFERS: OfferVariant[] = [
  {
    id: "offer-oil-change-sunny",
    providerId: "prov-orbit-care",
    branchId: "branch-nasr-city-01",
    serviceCategory: "maintenance",
    titleEn: "10,000 km Periodic Service + Standard Synthetic 5W-30 & Matching Filter",
    titleAr: "صيانة دورية ١٠,٠٠٠ كم + زيت تخليقي 5W-30 وفلتر مطابق",
    subtitleEn:
      "Comprehensive 24-point vehicle health check, fluid top-up, and brake inspection included.",
    subtitleAr: "فحص شامل لـ ٢٤ نقطة أمان، تزويد سوائل، وفحص دورة الفرامل.",
    normalPrice,
    discountBps: 2000, // 20%
    lockedPrice,
    saving,
    commissionBps: 1000, // 10%
    inclusionsEn: [
      "4 Litres Standard Synthetic 5W-30 fully synthetic motor oil",
      "Standard matching oil filter replacement",
      "Engine air filter air-blow cleaning & fluid inspection",
      "Brake pad wear & brake fluid boiling point measurement",
      "24-point computerized electrical diagnostic scan",
      "Full chassis suspension & steering check",
    ],
    inclusionsAr: [
      "٤ لتر زيت تخليقي قياسي 5W-30 بالكامل",
      "تغيير فلتر زيت مطابق قياسي",
      "تنظيف فلتر الهواء وفحص مستوى سوائل التبريد والمساحات",
      "قياس تيل الفرامل وفحص نقطة غليان سائل الفرامل",
      "فحص كمبيوتر لـ ٢٤ نقطة للمنظومة الكهربائية",
      "فحص عفشة السيارة ومنظومة التوجيه بالكامل",
    ],
    exclusionsEn: [
      "Engine air filter or cabin AC filter replacement (billed if requested by customer)",
      "Brake pad replacement or disc skimming",
      "Major mechanical repairs or engine oil flush",
    ],
    exclusionsAr: [
      "استبدال فلتر الهواء أو فلتر التكييف (يحاسب عليها إضافياً إذا طلب العميل)",
      "تغيير تيل الفرامل أو خراطة الطنابير",
      "أي إصلاحات ميكانيكية كبرى أو غسيل داخلي للمحرك",
    ],
    partsSpecificationEn:
      "Standard Synthetic 5W-30 (API SP / ILSAC GF-6A) + Standard matching filter",
    partsSpecificationAr: "زيت تخليقي قياسي 5W-30 (تصنيف API SP) + فلتر زيت مطابق",
    laborIncluded: true,
    durationMinutes: 45,
    warrantyTermsEn:
      "Provisional recourse policy: 30 days or 1,000 km on oil and workmanship from service date.",
    warrantyTermsAr: "سياسة رجوع مؤقتة: ٣٠ يوماً أو ١,٠٠٠ كم على الزيت والمصنعية من تاريخ الخدمة.",
    additionalWorkRuleEn:
      "Any additional parts or labor required outside this scope must be quoted and approved by customer before execution.",
    additionalWorkRuleAr:
      "أي أعمال أو قطع غيار إضافية تتطلب موافقة كتابية ومسبقة من العميل قبل البدء.",
    cancellationPolicyEn: "Free cancellation anytime prior to check-in. No booking fee is charged.",
    cancellationPolicyAr: "إلغاء مجاني في أي وقت قبل تسجيل الحضور بالمركز بدون أي رسوم.",
    compatibleVehicles: [
      { make: "Nissan", model: "Sunny", yearFrom: 2013, yearTo: 2025 },
      { make: "Nissan", model: "Sentra", yearFrom: 2014, yearTo: 2024 },
      { make: "Renault", model: "Logan", yearFrom: 2012, yearTo: 2023 },
    ],
    status: "published",
    isSponsored: true,
    rating: 4.85,
    reviewCount: 42,
  },
  {
    id: "offer-bmw-exclusive",
    providerId: "prov-german-tech",
    branchId: "branch-heliopolis-01",
    serviceCategory: "maintenance",
    titleEn: "Executive Synthetic 5W-30 & Matching Filter Periodic Service",
    titleAr: "صيانة متقدمة وتغيير زيت تخليقي 5W-30 وفلتر مطابق",
    subtitleEn: "Dedicated service for mid-size executive sedans with computerized reset.",
    subtitleAr: "خدمة مخصصة لسيارات الصالون التنفيذية مع إعادة ضبط العداد بالكمبيوتر.",
    normalPrice: bmwNormal,
    discountBps: 1500,
    lockedPrice: bmwLocked,
    saving: bmwSaving,
    commissionBps: 1000,
    inclusionsEn: [
      "5 Litres Standard Synthetic 5W-30 Oil",
      "Standard matching oil filter",
      "Service history diagnostic reset",
    ],
    inclusionsAr: [
      "٥ لتر زيت تخليقي 5W-30 مطابق للمواصفات",
      "فلتر زيت مطابق قياسي",
      "إعادة ضبط سجل الصيانة في النظام الإلكتروني",
    ],
    exclusionsEn: ["Spark plugs", "Brake pads"],
    exclusionsAr: ["بوجيهات", "تيل فرامل"],
    partsSpecificationEn: "Standard Synthetic 5W-30 Engine Oil",
    partsSpecificationAr: "زيت محرك تخليقي مطابق للمواصفات",
    laborIncluded: true,
    durationMinutes: 60,
    warrantyTermsEn: "Provisional recourse policy: 60 days or 2,000 km.",
    warrantyTermsAr: "سياسة رجوع مؤقتة: ٦٠ يوماً أو ٢,٠٠٠ كم.",
    additionalWorkRuleEn: "Customer authorization required for extra work.",
    additionalWorkRuleAr: "موافقة العميل المسبقة مطلوبة لأي أعمال إضافية.",
    cancellationPolicyEn: "Free cancellation before arrival.",
    cancellationPolicyAr: "إلغاء مجاني قبل الحضور.",
    compatibleVehicles: [
      { make: "BMW", model: "320i", yearFrom: 2015, yearTo: 2024 },
      { make: "BMW", model: "520i", yearFrom: 2016, yearTo: 2024 },
    ],
    status: "published",
    rating: 4.9,
    reviewCount: 18,
  },
];

export const DEMO_OFFER = PUBLISHED_OFFERS[0];
export const INCOMPATIBLE_OFFER = PUBLISHED_OFFERS[1];

export const DEMO_PRICE_EVIDENCE: PriceEvidence = {
  id: "evid-orbit-official-01",
  fileName: "Orbit_Official_Price_Board_Sept2026.pdf",
  evidenceType: "official_price_list",
  capturedDate: "2026-09-12T10:00:00.000Z",
  fileSizeBytes: 1420500,
  description: "Stamped workshop price board showing 10k km service at normal rate of EGP 1,200.",
};

// Draft express service for Sales Wizard demo (Distinct from published offer)
export const SEED_OFFER_DRAFTS: OfferDraft[] = [
  {
    id: "draft-express-service-01",
    providerId: "prov-orbit-care",
    branchId: "branch-nasr-city-01",
    serviceCategory: "wash",
    titleEn: "Comprehensive Steam Detailing + Interior Nano Sanitization",
    titleAr: "غسيل بخار تفصيلي + تعقيم نانو داخلي للصالون",
    subtitleEn: "Full exterior decontamination and upholstery deep clean.",
    subtitleAr: "تنظيف وتطهير عميق للصالون والفرش وإزالة الرواسب الخارجية.",
    normalPrice: createMoney(850),
    discountBps: 1500,
    commissionBps: 1000,
    priceEvidence: DEMO_PRICE_EVIDENCE,
    status: "pending_ops_approval",
    createdBySalesId: "sales-rep-ahmed",
    createdAt: "2026-09-11T09:15:00.000Z",
  },
];

// Helper to construct authoritative PricingSnapshot
export function createPricingSnapshot(offer: OfferVariant): PricingSnapshot {
  return {
    normalPrice: offer.normalPrice,
    discountBps: offer.discountBps,
    lockedPrice: offer.lockedPrice,
    saving: offer.saving,
    commissionBps: offer.commissionBps,
  };
}

// Pre-seeded reservations for Scenario Shortcuts
export function createSeededReservation(
  status: "confirmed" | "checked_in" | "completed" | "customer_cancelled" | "no_show",
  clockNow: string = "2026-09-13T12:00:00.000Z"
): Reservation {
  const offer = PUBLISHED_OFFERS[0];
  const pricingSnapshot = createPricingSnapshot(offer);

  let revision = 1;
  let checkInTimestamp: string | undefined = undefined;
  let completionPinDetails: CompletionPinDetails | null = null;
  let completionTimestamp: string | undefined = undefined;
  let commissionAccrualId: string | undefined = undefined;
  let isMutuallyConfirmed = false;

  if (status === "confirmed") {
    revision = 1;
  } else if (status === "checked_in") {
    revision = 3; // check-in (2) + reveal PIN (3)
    checkInTimestamp = clockNow;
    completionPinDetails = {
      pin: "4921",
      isIssued: true,
      issuedAt: clockNow,
      expiresAt: new Date(Date.parse(clockNow) + 15 * 60 * 1000).toISOString(),
      isConsumed: false,
    };
  } else if (status === "completed") {
    revision = 4;
    checkInTimestamp = clockNow;
    completionTimestamp = clockNow;
    commissionAccrualId = "ACCRUAL-res-sunny-7492";
    isMutuallyConfirmed = true;
    completionPinDetails = {
      pin: "4921",
      isIssued: true,
      issuedAt: clockNow,
      expiresAt: new Date(Date.parse(clockNow) + 15 * 60 * 1000).toISOString(),
      isConsumed: true,
    };
  } else if (status === "customer_cancelled" || status === "no_show") {
    revision = 2;
  }

  return {
    id: "res-sunny-7492",
    revision,
    passCode: "WC-7492",
    qrTokenHash: "wc:pass:7492:sha256-verified-demo",
    customerName: "Tarek Mostafa (Demo Customer)",
    customerPhoneMasked: "+20 10 **** 5821",
    vehicle: DEMO_VEHICLES.defaultSunny,
    provider: DEMO_PROVIDERS[0],
    branch: DEMO_PROVIDERS[0].branches[0],
    offerSnapshot: offer,
    pricingSnapshot,
    scheduledSlot: "Today, 3:30 PM (Nasr City)",
    status,
    checkInTimestamp,
    completionPinDetails,
    completionTimestamp,
    commissionAccrualId,
    isMutuallyConfirmed,
  };
}
