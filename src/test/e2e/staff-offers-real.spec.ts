import { expect, test, type Page } from "@playwright/test";
import crypto from "node:crypto";
import pg from "pg";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricEncrypt } from "better-auth/crypto";
import { getPrisma, disconnectDb } from "@/lib/db";
import { provisionStaffMember } from "@/lib/staff/provisioning";
import { utcToCairoInput } from "@/lib/offer/client";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";
const password = "ValidStaffPassword123!";
const totpSecret = "JBSWY3DPEHPK3PXP";

async function login(page: Page, email: string) {
  await page.goto("/staff/login");
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(password);
  await page.locator("button[type=submit]").click();
  await page.waitForURL("**/staff/mfa/verify");
  const code = await createOTP(totpSecret, { digits: 6, period: 30 }).totp();
  await page.locator("input[type=text]").fill(code);
  await page.locator("button[type=submit]").click();
  await page.waitForURL(
    (url) => !url.pathname.includes("/mfa/") && !url.pathname.endsWith("/login")
  );
}

test("real UI and PostgreSQL: Ops catalogs, Sales drafts/submits, separate Ops approves with exact persisted state", async ({
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const probe = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await probe.connect();
    await probe.query("SELECT 1");
  } finally {
    await probe.end();
  }

  const prisma = getPrisma();
  const uid = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const emails: string[] = [];
  let providerId: string | undefined;
  let offerId: string | undefined;
  const contexts = [] as Awaited<ReturnType<typeof browser.newContext>>[];

  async function staff(department: "SALES" | "OPERATIONS", role: "SALES_AGENT" | "OPS_SUPERVISOR") {
    if ((await prisma.internalStaffMembership.count()) === 0) {
      const bootstrapEmail = `offers-bootstrap-${uid}@test.eg`;
      emails.push(bootstrapEmail);
      await provisionStaffMember({
        email: bootstrapEmail,
        password,
        fullName: "E2E Bootstrap",
        employeeNumber: `BOOT-${uid}`,
        department: "ADMIN",
        isBootstrap: true,
      });
    }
    const email = `offers-${department.toLowerCase()}-${uid}@test.eg`;
    emails.push(email);
    const member = await provisionStaffMember({
      email,
      password,
      fullName: `E2E ${department}`,
      employeeNumber: `${department.slice(0, 3)}-${uid}`,
      department,
      role,
      isBootstrap: false,
    });
    const encryptedSecret = await symmetricEncrypt({
      key: process.env.BETTER_AUTH_SECRET ?? "ci-non-production-test-secret-at-least-32-chars-long",
      data: totpSecret,
    });
    await prisma.user.update({ where: { id: member.userId }, data: { twoFactorEnabled: true } });
    await prisma.twoFactor.create({
      data: { userId: member.userId, secret: encryptedSecret, backupCodes: "[]", verified: true },
    });
    await prisma.internalStaffMembership.update({
      where: { userId: member.userId },
      data: { mustChangePassword: false, isActive: true },
    });
    return { email, userId: member.userId };
  }

  try {
    const sales = await staff("SALES", "SALES_AGENT");
    const ops = await staff("OPERATIONS", "OPS_SUPERVISOR");
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: `Offer E2E Provider ${uid}`,
        nameAr: `مركز عروض تجريبي ${uid}`,
        legalName: `Offer E2E ${uid}`,
        taxRegistrationNumber: `${Math.floor(100000000 + Math.random() * 900000000)}`,
        commercialRegistrationNumber: `OFFER-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        status: "ACTIVE",
        version: 1,
        contactPersonName: "E2E Contact",
        contactEmail: `provider-${uid}@test.eg`,
        contactPhone: "+201011112222",
        createdByUserId: sales.userId,
        activatedByUserId: ops.userId,
        activatedAt: new Date(),
      },
    });
    providerId = provider.id;
    const branch = await prisma.providerBranch.create({
      data: {
        providerOrganizationId: provider.id,
        branchCode: `OFFER-${uid}`,
        nameEn: `E2E Branch ${uid}`,
        nameAr: `فرع تجريبي ${uid}`,
        cluster: "NASR_CITY_HELIOPOLIS",
        streetAddressEn: "E2E Street",
        streetAddressAr: "شارع تجريبي",
        latitude: "30.061200",
        longitude: "31.341100",
        contactPhone: "+201011112222",
        operatingHours: [],
        status: "ACTIVE",
        version: 2,
        legalIdentityChecked: true,
        physicalLocationChecked: true,
        contactAndHoursChecked: true,
        evidenceDocumentRef: `BR-${uid}`,
        vettedByUserId: ops.userId,
        vettedAt: new Date(),
      },
    });

    const opsContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    console.info("[Offer E2E] Operations catalog setup");
    contexts.push(opsContext);
    const opsPage = await opsContext.newPage();
    await login(opsPage, ops.email);
    await opsPage.goto("/staff/catalog");
    await expect(opsPage.locator("#catalog-categoryId")).toBeVisible();
    const category = await prisma.serviceCategory.findUniqueOrThrow({
      where: { code: "EXPRESS_MAINTENANCE" },
    });
    await opsPage.locator("#catalog-code").fill(`OFFER_E2E_${uid}`);
    await opsPage.locator("#catalog-categoryId").selectOption(category.id);
    await opsPage.locator("#catalog-nameEn").fill(`Express E2E ${uid}`);
    await opsPage.locator("#catalog-nameAr").fill(`صيانة سريعة تجريبية ${uid}`);
    await opsPage.locator("#catalog-scopeEn").fill("Fixed oil and filter replacement");
    await opsPage.locator("#catalog-scopeAr").fill("تغيير زيت وفلتر محدد النطاق");
    await opsPage.getByRole("button", { name: "Save service" }).click();
    await expect(opsPage.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    const definition = await prisma.serviceDefinition.findUniqueOrThrow({
      where: { code: `OFFER_E2E_${uid}` },
    });

    const salesContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    console.info("[Offer E2E] Sales offer form");
    contexts.push(salesContext);
    const salesPage = await salesContext.newPage();
    await login(salesPage, sales.email);
    await salesPage.goto("/staff/offers/new");
    await expect(salesPage.locator("#offer-provider")).toBeVisible();
    await salesPage.locator("#offer-provider").selectOption(provider.id);
    await salesPage.locator("#offer-branch").selectOption(branch.id);
    await salesPage.locator("#offer-service").selectOption(definition.id);
    const fields: Record<string, string> = {
      titleEn: "Express oil change",
      titleAr: "تغيير زيت سريع",
      includedLaborEn: "Drain and refill oil",
      includedLaborAr: "تفريغ الزيت وإعادة التعبئة",
      includedPartsEn: "Oil and one filter",
      includedPartsAr: "زيت وفلتر واحد",
      excludedLaborEn: "Engine diagnosis",
      excludedLaborAr: "فحص المحرك",
      excludedPartsEn: "Additional filters",
      excludedPartsAr: "فلاتر إضافية",
      durationMinutes: "45",
      normalPriceMinor: "1000.00",
      customerPriceMinor: "800.00",
      evidencePacketId: `PRICE_${uid}`,
      priceBasisNotes: "Verified printed price list",
      commercialTermsPacketId: `TERMS_${uid}`,
      commissionRateBps: "0",
    };
    for (const [name, value] of Object.entries(fields)) {
      await salesPage.locator(`#offer-${name}`).fill(value);
    }
    const future = utcToCairoInput(new Date(Date.now() + 2 * 60 * 60_000).toISOString());
    const later = utcToCairoInput(new Date(Date.now() + 15 * 24 * 60 * 60_000).toISOString());
    const yesterday = utcToCairoInput(new Date(Date.now() - 24 * 60 * 60_000).toISOString());
    await salesPage.locator("#offer-validFrom").fill(future);
    await salesPage.locator("#offer-validUntil").fill(later);
    await salesPage.locator("#offer-evidenceDate").fill(yesterday);
    await salesPage.locator("#offer-commercialTermsAgreedAt").fill(yesterday);
    await salesPage.locator("#offer-evidencePacketId").fill("x");
    await salesPage.locator("#offer-customerPriceMinor").fill("1000.00");
    await salesPage.getByRole("button", { name: "Check answers" }).click();
    await expect(salesPage.getByRole("alert").first()).toBeFocused();
    await expect(salesPage.locator("#offer-customerPriceMinor")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    await expect(salesPage.locator("#offer-evidencePacketId")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    await expect(salesPage.locator("#offer-titleAr")).toHaveValue(fields.titleAr);
    await salesPage.locator("#offer-evidencePacketId").fill(fields.evidencePacketId);
    await salesPage.locator("#offer-customerPriceMinor").fill(fields.customerPriceMinor);
    await salesPage.getByRole("button", { name: "Check answers" }).click();
    await expect(salesPage.getByText("1000.00")).toBeVisible();
    let committedButResponseLost = false;
    console.info("[Offer E2E] Committed creation with dropped response");
    await salesPage.route("**/api/v1/staff/offers", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      committedButResponseLost = true;
      await route.abort("failed");
    });
    await salesPage.getByRole("button", { name: "Save draft" }).click();
    await expect(salesPage.getByText("Outcome is unknown", { exact: false }).first()).toBeVisible();
    expect(committedButResponseLost).toBe(true);
    await salesPage.getByRole("button", { name: "Recheck server state" }).click();
    await salesPage.waitForURL(/\/staff\/offers\/[^/]+$/);
    offerId = new URL(salesPage.url()).pathname.split("/").at(-1);
    expect(offerId).toBeTruthy();
    const draft = await prisma.offerRevision.findFirstOrThrow({
      where: { offerId },
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.normalPriceMinor.toString()).toBe("100000");
    expect(draft.customerPriceMinor.toString()).toBe("80000");
    expect(draft.commissionRateBps).toBe(0);
    expect(draft.includedLaborAr).toBe(fields.includedLaborAr);
    expect(await prisma.offer.count({ where: { id: offerId } })).toBe(1);
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_DRAFT_CREATED", targetEntity: `offer_revision:${draft.id}` },
      })
    ).toBe(1);

    console.info("[Offer E2E] Sales submission");
    const submitSection = salesPage
      .locator("section")
      .filter({ hasText: "Submit for Operations review" });
    await submitSection.getByRole("button", { name: "Check answers" }).click();
    await submitSection.getByRole("button", { name: "Submit for Operations review" }).click();
    await expect(
      salesPage.getByRole("status").filter({ hasText: "Submission confirmed" })
    ).toBeVisible();

    console.info("[Offer E2E] Operations approval");
    await opsPage.goto("/staff/ops/offers");
    await expect(opsPage.getByText(fields.titleEn)).toBeVisible();
    await opsPage
      .locator("li")
      .filter({ hasText: fields.titleEn })
      .getByRole("link", { name: "Offer details" })
      .click();
    await expect(opsPage.getByText(fields.titleEn).first()).toBeVisible();
    for (const label of [
      "I inspected the evidence packet",
      "I verified the normal and customer prices",
      "I verified the bilingual service scope",
      "I verified provider consent and commercial terms",
    ]) {
      await opsPage.getByRole("checkbox", { name: label }).check();
    }
    await opsPage.getByRole("button", { name: "Approve internally" }).click();
    await expect(
      opsPage.getByRole("status").filter({ hasText: "Internal approval confirmed" })
    ).toBeVisible();
    const storedOffer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
    const approved = await prisma.offerRevision.findUniqueOrThrow({ where: { id: draft.id } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.version).toBe(3);
    expect(approved.submittedByUserId).toBe(sales.userId);
    expect(approved.decidedByUserId).toBe(ops.userId);
    expect(storedOffer.currentApprovedRevisionId).toBe(draft.id);
    const auditCount = await prisma.securityAuditEvent.count({
      where: {
        targetEntity: `offer_revision:${draft.id}`,
        eventType: { in: ["OFFER_DRAFT_CREATED", "OFFER_SUBMITTED_FOR_REVIEW", "OFFER_APPROVED"] },
      },
    });
    expect(auditCount).toBe(3);

    console.info("[Offer E2E] Arabic mobile evidence");
    await salesPage.getByRole("button", { name: "العربية (RTL)" }).click();
    await expect(salesPage.locator("main[dir=rtl]")).toBeVisible();
    await expect(salesPage.getByText(fields.titleAr).first()).toBeVisible();
    await testInfo.attach("offer-mobile-arabic", {
      body: await salesPage.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  } finally {
    const closeResults = await Promise.allSettled(contexts.map((context) => context.close()));
    try {
      const ownedOffers = providerId
        ? await prisma.offer.findMany({
            where: { providerOrganizationId: providerId },
            select: { id: true },
          })
        : [];
      const ownedOfferIds = ownedOffers.map((item) => item.id);
      if (ownedOfferIds.length) {
        await prisma.offer.updateMany({
          where: { id: { in: ownedOfferIds } },
          data: { currentApprovedRevisionId: null },
        });
        await prisma.offerRevision.deleteMany({ where: { offerId: { in: ownedOfferIds } } });
        await prisma.offer.deleteMany({ where: { id: { in: ownedOfferIds } } });
      }
      await prisma.serviceDefinition.deleteMany({ where: { code: `OFFER_E2E_${uid}` } });
      if (providerId) {
        await prisma.providerBranch.deleteMany({ where: { providerOrganizationId: providerId } });
        await prisma.providerOrganization.delete({ where: { id: providerId } });
      }
      const users = await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
      });
      const userIds = users.map((item) => item.id);
      if (userIds.length) {
        await prisma.securityAuditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
        await prisma.internalRoleAssignment.deleteMany({
          where: { staffMembership: { userId: { in: userIds } } },
        });
        await prisma.internalStaffMembership.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.twoFactor.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      await disconnectDb();
    }
    if (
      testInfo.status === "passed" &&
      closeResults.some((result) => result.status === "rejected")
    ) {
      throw new Error("Offer E2E context cleanup failed");
    }
  }
});
