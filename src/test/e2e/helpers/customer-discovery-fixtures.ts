import crypto from "node:crypto";
import { getPrisma, disconnectDb } from "@/lib/db";

// Disposable PostgreSQL fixtures, not application seeds. These use actual
// draft -> submitted -> checker-approved transitions enforced by DB triggers.
// No customer/staff session is fabricated: every browser read is anonymous.
export async function customerDiscoveryFixture() {
  const url = new URL(process.env.DATABASE_URL ?? "http://unconfigured.invalid");
  if (
    process.env.CI !== "true" ||
    process.env.APP_RUNTIME_PROFILE !== "showcase" ||
    process.env.APP_DATA_BACKEND !== "postgres" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/waffarhacars_test"
  )
    throw new Error("Anonymous discovery fixtures require the isolated loopback test database.");
  const db = getPrisma();
  const offerIds: string[] = [];
  try {
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (identity[0]?.name !== "waffarhacars_test")
      throw new Error("Unexpected anonymous discovery test database.");
    const uid = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
    const maker = await db.user.create({
      data: { name: "Synthetic discovery maker", email: `discovery-maker-${uid}@test.eg` },
    });
    const checker = await db.user.create({
      data: { name: "Synthetic discovery checker", email: `discovery-checker-${uid}@test.eg` },
    });
    const provider = await db.providerOrganization.create({
      data: {
        nameEn: `Synthetic discovery center ${uid}`,
        nameAr: `مركز اكتشاف تجريبي ${uid}`,
        legalName: `Synthetic discovery ${uid}`,
        taxRegistrationNumber: String(crypto.randomInt(100_000_000, 1_000_000_000)),
        commercialRegistrationNumber: `DISC-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        status: "ACTIVE",
        contactPersonName: "Synthetic private contact",
        contactEmail: `private-discovery-${uid}@test.eg`,
        contactPhone: "+201011112222",
        createdByUserId: maker.id,
        activatedByUserId: checker.id,
        activatedAt: new Date(),
      },
    });
    const branch = await db.providerBranch.create({
      data: {
        providerOrganizationId: provider.id,
        branchCode: `DISC-${uid}`,
        nameEn: "Synthetic discovery branch",
        nameAr: "فرع اكتشاف تجريبي",
        cluster: "NASR_CITY_HELIOPOLIS",
        streetAddressEn: "Synthetic Cairo test street",
        streetAddressAr: "شارع تجريبي بالقاهرة",
        landmarkEn: "Synthetic test landmark",
        landmarkAr: "علامة تجريبية",
        latitude: "30.061200",
        longitude: "31.341100",
        contactPhone: "+201011112222",
        operatingHours: [
          { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
          { dayOfWeek: 1, openTime: "00:00", closeTime: "00:00", isClosed: true },
        ],
        status: "ACTIVE",
        legalIdentityChecked: true,
        physicalLocationChecked: true,
        contactAndHoursChecked: true,
        evidenceDocumentRef: `CI:PRIVATE:BRANCH:${uid}`,
        vettedByUserId: checker.id,
        vettedAt: new Date(),
      },
    });
    const make = await db.vehicleMake.create({
      data: {
        code: `DISC_${uid}`,
        nameEn: "Synthetic discovery make",
        nameAr: "ماركة اكتشاف تجريبية",
        evidenceRef: `CI:PRIVATE:MAKE:${uid}`,
      },
    });
    const model = await db.vehicleModel.create({
      data: {
        makeId: make.id,
        code: "DISCOVERY_MODEL",
        nameEn: "Synthetic discovery model",
        nameAr: "طراز اكتشاف تجريبي",
        evidenceRef: `CI:PRIVATE:MODEL:${uid}`,
      },
    });
    const ranges = { makeId: make.id, modelId: model.id, yearFrom: 2020, yearTo: 2024 };
    const services = new Map<string, Awaited<ReturnType<typeof db.serviceDefinition.create>>>();
    const capabilities: string[] = [];
    async function service(code: "CAR_WASH" | "ACCESSORIES") {
      const existing = services.get(code);
      if (existing) return existing;
      const category = await db.serviceCategory.findUniqueOrThrow({ where: { code } });
      const definition = await db.serviceDefinition.create({
        data: {
          code: `DISC_${code}_${uid}`,
          categoryId: category.id,
          nameEn: `Synthetic ${code} service`,
          nameAr: code === "CAR_WASH" ? "خدمة غسيل تجريبية" : "خدمة إكسسوارات تجريبية",
          scopeEn: "A defined service for the listed base vehicles",
          scopeAr: "خدمة محددة للسيارات الأساسية المذكورة",
          pricingMode: "FIXED_SCOPE",
          createdByUserId: maker.id,
          updatedByUserId: maker.id,
        },
      });
      const capability = await db.branchCapabilityVersion.create({
        data: {
          branchId: branch.id,
          categoryId: category.id,
          sequenceNumber: 1,
          createdByUserId: maker.id,
          evidenceRef: `CI:PRIVATE:CAPABILITY:${uid}`,
        },
      });
      await db.branchCapabilityCoverage.create({ data: { versionId: capability.id, ...ranges } });
      await db.branchCapabilityVersion.update({
        where: { id: capability.id },
        data: {
          status: "PENDING_REVIEW",
          version: 2,
          submittedByUserId: maker.id,
          submittedAt: new Date(),
        },
      });
      await db.$transaction(async (tx) => {
        await tx.branchCapabilityVersion.update({
          where: { id: capability.id },
          data: {
            status: "ACTIVE",
            version: 3,
            decidedByUserId: checker.id,
            decidedAt: new Date(),
            attested: true,
          },
        });
        await tx.branchCapabilityCurrent.create({
          data: { branchId: branch.id, categoryId: category.id, activeVersionId: capability.id },
        });
      });
      capabilities.push(capability.id);
      services.set(code, definition);
      return definition;
    }
    async function revision(
      offerId: string,
      code: "CAR_WASH" | "ACCESSORIES",
      sequence = 1,
      expired = false
    ) {
      const definition = await service(code);
      const category = await db.serviceCategory.findUniqueOrThrow({ where: { code } });
      const now = Date.now();
      const draft = await db.offerRevision.create({
        data: {
          offerId,
          revisionNumber: sequence,
          requestId: crypto.randomUUID(),
          serviceDefinitionId: definition.id,
          categoryCode: code,
          categoryNameEn: category.nameEn,
          categoryNameAr: category.nameAr,
          serviceCode: definition.code,
          serviceNameEn: definition.nameEn,
          serviceNameAr: definition.nameAr,
          serviceScopeEn: definition.scopeEn,
          serviceScopeAr: definition.scopeAr,
          titleEn: `Synthetic ${code} offer ${offerIds.indexOf(offerId) + 1} revision ${sequence}`,
          titleAr: `عرض ${code === "CAR_WASH" ? "غسيل" : "إكسسوارات"} تجريبي ${offerIds.indexOf(offerId) + 1} إصدار ${sequence}`,
          includedLaborEn: "One fixed cleaning service",
          includedLaborAr: "خدمة تنظيف واحدة محددة",
          includedPartsEn: "Listed cleaning materials",
          includedPartsAr: "مواد التنظيف المذكورة",
          excludedLaborEn: "Repairs and diagnosis",
          excludedLaborAr: "الإصلاح والفحص",
          excludedPartsEn: "Replacement parts",
          excludedPartsAr: "قطع الغيار",
          bookingRule: "APPOINTMENT_REQUIRED",
          durationMinutes: 45,
          validFrom: new Date(now - 86_400_000),
          validUntil: new Date(expired ? now - 1000 : now + 3_600_000 + offerIds.length * 1000),
          normalPriceMinor: 100000n,
          customerPriceMinor: 80000n,
          evidencePacketId: `PRIVATE_PRICE_${uid}`,
          evidenceType: "PROVIDER_PRICE_LIST",
          evidenceDate: new Date(now - 86_400_000),
          priceBasisNotes: "Private synthetic price notes",
          commercialTermsPacketId: `PRIVATE_TERMS_${uid}`,
          commercialTermsAgreedAt: new Date(now - 86_400_000),
          commissionBasis: "DISCOUNTED_CUSTOMER_PRICE",
          commissionRateBps: 0,
          createdByUserId: maker.id,
          fitmentMode: "BASE_VEHICLE_ALL_VARIANTS_VERIFIED",
          fitmentEvidenceRef: `CI:PRIVATE:FITMENT:${uid}`,
        },
      });
      await db.offerFitmentCoverage.create({ data: { revisionId: draft.id, ...ranges } });
      await db.offerRevision.update({
        where: { id: draft.id },
        data: {
          status: "PENDING_REVIEW",
          version: 2,
          submittedByUserId: maker.id,
          submittedAt: new Date(),
        },
      });
      const approved = await db.offerRevision.update({
        where: { id: draft.id },
        data: {
          status: "APPROVED",
          version: 3,
          decidedByUserId: checker.id,
          decidedAt: new Date(),
          evidenceInspected: true,
          priceVerified: true,
          scopeVerified: true,
          providerConsentVerified: true,
          fitmentAllVariantsAttested: true,
          fitmentScopePriceAttested: true,
        },
      });
      await db.offer.update({
        where: { id: offerId },
        data: { currentApprovedRevisionId: approved.id },
      });
      return approved;
    }
    async function offer(code: "CAR_WASH" | "ACCESSORIES") {
      const definition = await service(code);
      const created = await db.offer.create({
        data: {
          providerOrganizationId: provider.id,
          branchId: branch.id,
          serviceDefinitionId: definition.id,
          createdByUserId: maker.id,
          creationRequestId: crypto.randomUUID(),
          creationRequestFingerprint: "0".repeat(64),
        },
      });
      offerIds.push(created.id);
      const approved = await revision(created.id, code);
      await db.offerPublication.create({
        data: {
          offerId: created.id,
          status: "PUBLISHED",
          pinnedRevisionId: approved.id,
          version: 1,
          lastActorUserId: checker.id,
          publishedAt: new Date(),
        },
      });
      return {
        offerId: created.id,
        revisionId: approved.id,
        titleEn: approved.titleEn,
        titleAr: approved.titleAr,
        code,
      };
    }
    const offers = [];
    for (let index = 0; index < 12; index += 1) offers.push(await offer("CAR_WASH"));
    offers.push(await offer("ACCESSORIES"));
    return {
      db,
      uid,
      maker,
      checker,
      provider,
      branch,
      make,
      model,
      offers,
      capabilities,
      revision,
      offerIds,
    };
  } catch {
    try {
      if (offerIds.length)
        await db.offerPublication.updateMany({
          where: { offerId: { in: offerIds }, status: "PUBLISHED" },
          data: { status: "UNPUBLISHED", unpublishedAt: new Date(), version: { increment: 1 } },
        });
    } finally {
      await disconnectDb();
    }
    throw new Error("Synthetic anonymous discovery fixture setup failed.");
  }
}

export type DiscoveryFixture = Awaited<ReturnType<typeof customerDiscoveryFixture>>;

export async function withdrawDiscoveryFixtures(f: DiscoveryFixture) {
  // Terminal review history is deliberately retained in this disposable DB;
  // trigger/foreign-key protections are not disabled to delete it. Only our
  // own synthetic publications are withdrawn so later suites cannot see them.
  try {
    await f.db.offerPublication.updateMany({
      where: { offerId: { in: f.offerIds }, status: "PUBLISHED" },
      data: { status: "UNPUBLISHED", unpublishedAt: new Date(), version: { increment: 1 } },
    });
  } finally {
    await disconnectDb();
  }
}
