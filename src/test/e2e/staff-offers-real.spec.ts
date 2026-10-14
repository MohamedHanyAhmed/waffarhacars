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

async function waitForBlockedRequests(blocker: pg.Client, expected: number): Promise<number> {
  const blockerPid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
    .rows[0].pid;
  const observer = new pg.Client({ connectionString: databaseUrl });
  await observer.connect();
  let waiting = 0;
  const deadline = Date.now() + 5000;
  try {
    while (Date.now() < deadline && waiting < expected) {
      const result = await observer.query<{ count: number }>(
        `WITH RECURSIVE blocked(pid) AS (
           SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))
           UNION
           SELECT activity.pid FROM pg_stat_activity activity
           JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
         ) SELECT count(*)::int AS count FROM blocked`,
        [blockerPid]
      );
      waiting = result.rows[0]?.count ?? 0;
      if (waiting < expected) await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    await observer.end();
  }
  return waiting;
}

test("real UI and PostgreSQL: bilingual mobile offers, approval, explicit publication and withdrawal", async ({
  browser,
}, testInfo) => {
  test.setTimeout(270_000);
  const probe = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await probe.connect();
    await probe.query("SELECT 1");
  } finally {
    await probe.end();
  }

  const prisma = getPrisma();
  // Keep synthetic display names alphabetic: a numeric UUID slice can look like a phone number
  // and correctly fail the production customer-copy PII validator.
  const uid = crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)
    .replace(/[0-9]/g, (digit) => String.fromCharCode(65 + Number(digit)))
    .toUpperCase();
  let offerId: string | undefined;
  const contexts = [] as Awaited<ReturnType<typeof browser.newContext>>[];

  async function staff(department: "SALES" | "OPERATIONS", role: "SALES_AGENT" | "OPS_SUPERVISOR") {
    if ((await prisma.internalStaffMembership.count()) === 0) {
      const bootstrapEmail = `offers-bootstrap-${uid}@test.eg`;
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
        operatingHours: [{ dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false }],
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
    // Engineering-only synthetic catalogue. Operational release requires real
    // provider-backed all-variant evidence for each enumerated base vehicle.
    const fitmentMake = await prisma.vehicleMake.create({
      data: {
        code: `OFFER_E2E_${uid}`,
        nameEn: "Synthetic E2E make",
        nameAr: "ماركة تجريبية",
        evidenceRef: "CI:E2E:MAKE",
      },
    });
    const fitmentModel = await prisma.vehicleModel.create({
      data: {
        makeId: fitmentMake.id,
        code: "ALL_VARIANTS_TEST",
        nameEn: "Synthetic all-variants model",
        nameAr: "طراز تجريبي",
        evidenceRef: "CI:E2E:MODEL",
      },
    });
    const fitmentCoverage = [
      {
        makeId: fitmentMake.id,
        modelId: fitmentModel.id,
        yearFrom: 2020,
        yearTo: 2024,
      },
    ];

    const opsContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.81" },
    });
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

    const salesContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.82" },
    });
    console.info("[Offer E2E] Sales offer form");
    contexts.push(salesContext);
    const salesPage = await salesContext.newPage();
    await login(salesPage, sales.email);
    const browserOrigin = new URL(salesPage.url()).origin;
    const capabilityPath = `/api/v1/staff/branches/${branch.id}/fitment-policies`;
    const policyCreated = await salesContext.request.post(
      new URL(capabilityPath, browserOrigin).toString(),
      {
        headers: { Origin: browserOrigin },
        data: {
          commandId: crypto.randomUUID(),
          categoryId: category.id,
          evidenceRef: `CI:E2E:BRANCH_CAPABILITY:${uid}`,
          coverage: fitmentCoverage,
        },
      }
    );
    expect(policyCreated.status()).toBe(201);
    const policyId = ((await policyCreated.json()) as { command: { policyId: string } }).command
      .policyId;
    const policySubmitted = await salesContext.request.post(
      new URL(`${capabilityPath}/${policyId}/submit`, browserOrigin).toString(),
      {
        headers: { Origin: browserOrigin },
        data: { commandId: crypto.randomUUID(), expectedVersion: 1 },
      }
    );
    expect(policySubmitted.status()).toBe(200);
    const policyApproved = await opsContext.request.post(
      new URL(`${capabilityPath}/${policyId}/approve`, browserOrigin).toString(),
      {
        headers: { Origin: browserOrigin },
        data: { commandId: crypto.randomUUID(), expectedVersion: 2, attested: true },
      }
    );
    expect(policyApproved.status()).toBe(200);
    await salesPage.goto("/staff/offers/new");
    await expect(salesPage.locator("#offer-provider")).toBeVisible();
    await expect(salesPage.locator(`#offer-provider option[value="${provider.id}"]`)).toHaveCount(
      1,
      { timeout: 10_000 }
    );
    await salesPage.locator("#offer-provider").selectOption(provider.id);
    await expect(salesPage.locator(`#offer-branch option[value="${branch.id}"]`)).toHaveCount(1);
    await salesPage.locator("#offer-branch").selectOption(branch.id);
    await expect(salesPage.locator(`#offer-service option[value="${definition.id}"]`)).toHaveCount(
      1
    );
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
    // Midday Cairo avoids Egypt's midnight DST gaps/repeated hour in long-lived CI.
    const cairoNoon = (instant: string) => `${utcToCairoInput(instant).slice(0, 10)}T12:00`;
    const activeFrom = cairoNoon(new Date(Date.now() - 24 * 60 * 60_000).toISOString());
    const later = cairoNoon(new Date(Date.now() + 15 * 24 * 60 * 60_000).toISOString());
    const yesterday = activeFrom;
    await salesPage.locator("#offer-validFrom").fill(activeFrom);
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
    await salesPage.waitForURL(
      (url) =>
        /^\/staff\/offers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          url.pathname
        ),
      { timeout: 15_000 }
    );
    await salesPage.unroute("**/api/v1/staff/offers");
    offerId = new URL(salesPage.url()).pathname.split("/").at(-1);
    expect(offerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
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

    console.info("[Offer E2E] Committed edit with dropped response and reload reconciliation");
    const editedTitle = "Express oil change after price-list review";
    await salesPage.locator("form #offer-titleEn").fill(editedTitle);
    await salesPage.locator("form").getByRole("button", { name: "Check answers" }).click();
    let editCommittedButResponseLost = false;
    await salesPage.route("**/api/v1/staff/offers/*/revisions/*", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      editCommittedButResponseLost = true;
      await route.abort("failed");
    });
    await salesPage.getByRole("button", { name: "Save draft" }).click();
    await expect(salesPage.getByText("Outcome is unknown", { exact: false }).first()).toBeVisible();
    expect(editCommittedButResponseLost).toBe(true);
    await salesPage.unroute("**/api/v1/staff/offers/*/revisions/*");
    await salesPage.reload();
    await expect(salesPage.getByRole("button", { name: "Recheck server state" })).toHaveCount(1);
    await salesPage.getByRole("button", { name: "Recheck server state" }).click();
    await expect(
      salesPage.getByText("This record changed.", { exact: false }).first()
    ).toBeVisible();
    await expect(salesPage.locator("form #offer-titleEn")).toHaveValue(editedTitle);
    await expect(
      salesPage.locator("form").getByRole("button", { name: "Check answers" })
    ).toBeEnabled();
    const afterLostEdit = await prisma.offerRevision.findUniqueOrThrow({ where: { id: draft.id } });
    expect(afterLostEdit.titleEn).toBe(editedTitle);
    expect(afterLostEdit.version).toBe(2);
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_DRAFT_UPDATED", targetEntity: `offer_revision:${draft.id}` },
      })
    ).toBe(1);

    console.info("[Offer E2E] Two real browser contexts compete on one draft version");
    const secondSalesContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.83" },
      // Clone only the browser-obtained session from the genuine login above;
      // no handmade auth cookie or database session is introduced.
      storageState: await salesContext.storageState(),
    });
    contexts.push(secondSalesContext);
    const secondSalesPage = await secondSalesContext.newPage();
    await secondSalesPage.goto(`/staff/offers/${offerId}`);
    await expect(secondSalesPage.locator("form #offer-titleEn")).toBeVisible();
    const firstContenderTitle = "First competing value";
    const secondContenderTitle = "Second competing value";
    await salesPage.locator("form #offer-titleEn").fill(firstContenderTitle);
    await secondSalesPage.locator("form #offer-titleEn").fill(secondContenderTitle);
    await salesPage.locator("form").getByRole("button", { name: "Check answers" }).click();
    await secondSalesPage.locator("form").getByRole("button", { name: "Check answers" }).click();

    const blocker = new pg.Client({ connectionString: databaseUrl });
    await blocker.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM provider_organizations WHERE id = $1 FOR UPDATE", [
        provider.id,
      ]);
      await Promise.all([
        salesPage.getByRole("button", { name: "Save draft" }).click(),
        secondSalesPage.getByRole("button", { name: "Save draft" }).click(),
      ]);
      expect(await waitForBlockedRequests(blocker, 2)).toBeGreaterThanOrEqual(2);
    } finally {
      await blocker.query("COMMIT").catch(async () => blocker.query("ROLLBACK"));
      await blocker.end();
    }
    await expect
      .poll(async () => {
        const current = await prisma.offerRevision.findUniqueOrThrow({ where: { id: draft.id } });
        return current.version;
      })
      .toBe(3);
    const raceWinner = await prisma.offerRevision.findUniqueOrThrow({ where: { id: draft.id } });
    expect([firstContenderTitle, secondContenderTitle]).toContain(raceWinner.titleEn);
    const winnerPage = raceWinner.titleEn === firstContenderTitle ? salesPage : secondSalesPage;
    const loserPage = raceWinner.titleEn === firstContenderTitle ? secondSalesPage : salesPage;
    await expect(winnerPage.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await expect(
      loserPage.getByRole("alert").filter({ hasText: "This record changed." }).first()
    ).toBeVisible();
    await expect
      .poll(async () => {
        const pages = [salesPage, secondSalesPage];
        const results = await Promise.all(
          pages.map(async (page) => ({
            saved: await page.getByText("Saved from the server record.").count(),
            conflict: await page.getByText("This record changed.", { exact: false }).count(),
          }))
        );
        return {
          saved: results.reduce((sum, result) => sum + result.saved, 0),
          conflict: results.reduce((sum, result) => sum + result.conflict, 0),
        };
      })
      .toEqual({ saved: 1, conflict: 1 });
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_DRAFT_UPDATED", targetEntity: `offer_revision:${draft.id}` },
      })
    ).toBe(2);
    // Fitment UI is explicitly out of PR4B-B scope. Use the actual authenticated
    // Sales API/session boundary to attach reviewed synthetic coverage before
    // continuing the existing browser submission journey.
    const fitmentSaved = await salesContext.request.put(
      new URL(
        `/api/v1/staff/offers/${offerId}/revisions/${draft.id}/fitment`,
        browserOrigin
      ).toString(),
      {
        headers: { Origin: browserOrigin },
        data: {
          commandId: crypto.randomUUID(),
          expectedVersion: 3,
          mode: "BASE_VEHICLE_ALL_VARIANTS_VERIFIED",
          evidenceRef: `CI:E2E:OFFER_ALL_VARIANTS:${uid}`,
          coverage: fitmentCoverage,
        },
      }
    );
    expect(fitmentSaved.status()).toBe(200);
    await salesPage.reload();
    await expect(salesPage.locator("form #offer-titleEn")).toBeVisible();

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
    await expect(opsPage.locator(`a[href="/staff/offers/${offerId}"]`)).toBeVisible();
    await opsPage.locator(`a[href="/staff/offers/${offerId}"]`).click();
    await expect(opsPage.getByText(raceWinner.titleEn).first()).toBeVisible();
    const approvedViaOps = await opsContext.request.post(
      new URL(
        `/api/v1/staff/ops/offers/${offerId}/revisions/${draft.id}/approve`,
        browserOrigin
      ).toString(),
      {
        headers: { Origin: browserOrigin },
        data: {
          expectedVersion: 5,
          evidenceInspected: true,
          priceVerified: true,
          scopeVerified: true,
          providerConsentVerified: true,
          fitmentAllVariantsAttested: true,
          fitmentScopePriceAttested: true,
        },
      }
    );
    expect(approvedViaOps.status()).toBe(200);
    await opsPage.reload();
    const storedOffer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
    const approved = await prisma.offerRevision.findUniqueOrThrow({ where: { id: draft.id } });
    expect(approved.status).toBe("APPROVED");
    expect(approved.version).toBe(6);
    expect(approved.submittedByUserId).toBe(sales.userId);
    expect(approved.decidedByUserId).toBe(ops.userId);
    expect(storedOffer.currentApprovedRevisionId).toBe(draft.id);
    const auditCount = await prisma.securityAuditEvent.count({
      where: {
        targetEntity: `offer_revision:${draft.id}`,
        eventType: {
          in: [
            "OFFER_DRAFT_CREATED",
            "OFFER_DRAFT_UPDATED",
            "OFFER_SUBMITTED_FOR_REVIEW",
            "OFFER_APPROVED",
          ],
        },
      },
    });
    expect(auditCount).toBe(5);

    console.info("[Offer E2E] Internal approval remains invisible until explicit publication");
    const anonymousContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    contexts.push(anonymousContext);
    expect((await anonymousContext.request.get(`/api/v1/offers/${offerId}`)).status()).toBe(404);
    const englishPublication = opsPage.getByRole("region", {
      name: "Customer publication control",
    });
    await expect(englishPublication).toBeVisible();
    await expect(englishPublication.getByText("Withdrawn or never published")).toBeVisible();
    await expect(englishPublication.getByText("No", { exact: true })).toBeVisible();
    // The former direct INSERT of a copied terminal revision is intentionally
    // removed: the new database guard correctly forbids manufacturing approved
    // fitment. Maker-checker refusal is exercised through real API integration.
    await expect(opsPage.locator("#offer-revision")).toHaveValue(draft.id);
    await expect(
      englishPublication.getByRole("button", { name: "Prepare publication" })
    ).toBeVisible();
    let publishCommittedButResponseLost = false;
    await opsPage.route(`**/api/v1/staff/ops/offers/${offerId}/publication`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      publishCommittedButResponseLost = true;
      await route.abort("failed");
    });
    await englishPublication.getByRole("button", { name: "Prepare publication" }).click();
    await expect(englishPublication.getByText("Check the publication decision")).toBeVisible();
    await englishPublication.getByRole("button", { name: "Confirm Operations command" }).click();
    await expect(
      englishPublication.getByText("The command outcome is unknown.", { exact: false }).first()
    ).toBeVisible();
    expect(publishCommittedButResponseLost).toBe(true);
    await opsPage.unroute(`**/api/v1/staff/ops/offers/${offerId}/publication`);
    await opsPage.reload();
    await expect(
      englishPublication.getByRole("button", { name: "Recheck publication command" })
    ).toBeVisible();
    await englishPublication.getByRole("button", { name: "Recheck publication command" }).click();
    await expect(englishPublication.getByText("Published command active")).toBeVisible();
    await expect(
      englishPublication.getByText("Yes, subject to recheck on each request")
    ).toBeVisible();
    const publicDetailResponse = await anonymousContext.request.get(`/api/v1/offers/${offerId}`);
    expect(publicDetailResponse.status()).toBe(200);
    const publicDetail = (await publicDetailResponse.json()) as Record<string, unknown>;
    expect(publicDetail.offerId).toBe(offerId);
    expect(publicDetail.revisionId).toBe(draft.id);
    expect(publicDetail.customerPriceMinor).toBe("80000");
    expect(publicDetail.normalPriceMinor).toBe("100000");
    const publicBody = JSON.stringify(publicDetail);
    for (const privateValue of [
      approved.evidencePacketId,
      approved.commercialTermsPacketId,
      approved.priceBasisNotes,
      approved.createdByUserId,
    ]) {
      expect(publicBody).not.toContain(privateValue);
    }
    expect(publicBody).not.toContain("commissionRateBps");
    const publicListResponse = await anonymousContext.request.get("/api/v1/offers");
    expect(publicListResponse.status()).toBe(200);
    const publicList = (await publicListResponse.json()) as { items: Array<{ offerId: string }> };
    expect(publicList.items.some((item) => item.offerId === offerId)).toBe(true);
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_PUBLISHED", targetEntity: `offer:${offerId}` },
      })
    ).toBe(1);
    const englishPublicationRow = await prisma.offerPublication.findUniqueOrThrow({
      where: { offerId },
    });
    expect(englishPublicationRow.pinnedRevisionId).toBe(draft.id);
    expect(englishPublicationRow.version).toBe(1);

    await englishPublication.getByRole("button", { name: "Prepare withdrawal" }).click();
    await englishPublication.getByRole("button", { name: "Confirm Operations command" }).click();
    await expect(englishPublication.getByText("Withdrawn or never published")).toBeVisible();
    expect((await anonymousContext.request.get(`/api/v1/offers/${offerId}`)).status()).toBe(404);
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_UNPUBLISHED", targetEntity: `offer:${offerId}` },
      })
    ).toBe(1);
    const withdrawnRow = await prisma.offerPublication.findUniqueOrThrow({ where: { offerId } });
    expect(withdrawnRow.version).toBe(2);
    expect(withdrawnRow.status).toBe("UNPUBLISHED");

    console.info("[Offer E2E] Arabic mobile form, validation, and check-answers journey");
    await salesPage
      .getByRole("button", { name: "Toggle language between Arabic and English" })
      .click();
    await salesPage.goto("/staff/offers/new");
    await expect(salesPage.locator("main[dir=rtl]")).toBeVisible();
    await expect(salesPage.locator("#offer-provider")).toBeVisible();
    await expect(salesPage.locator(`#offer-provider option[value="${provider.id}"]`)).toHaveCount(
      1
    );
    await salesPage.locator("#offer-provider").selectOption(provider.id);
    await expect(salesPage.locator(`#offer-branch option[value="${branch.id}"]`)).toHaveCount(1);
    await salesPage.locator("#offer-branch").selectOption(branch.id);
    await expect(salesPage.locator(`#offer-service option[value="${definition.id}"]`)).toHaveCount(
      1
    );
    await salesPage.locator("#offer-service").selectOption(definition.id);
    const arabicFields: Record<string, string> = {
      ...fields,
      titleEn: "Arabic mobile journey offer",
      titleAr: "عرض صيانة عبر الهاتف",
      evidencePacketId: `AR_PRICE_${uid}`,
      commercialTermsPacketId: `AR_TERMS_${uid}`,
    };
    for (const [name, value] of Object.entries(arabicFields)) {
      await salesPage.locator(`#offer-${name}`).fill(value);
    }
    await salesPage.locator("#offer-bookingRule").selectOption("WALK_IN_ALLOWED");
    await salesPage.locator("#offer-evidenceType").selectOption("WRITTEN_QUOTE");
    await salesPage.locator("#offer-validFrom").fill(activeFrom);
    await salesPage.locator("#offer-validUntil").fill(later);
    await salesPage.locator("#offer-evidenceDate").fill(yesterday);
    await salesPage.locator("#offer-commercialTermsAgreedAt").fill(yesterday);
    await salesPage.locator("#offer-evidencePacketId").fill("x");
    await salesPage.locator("#offer-customerPriceMinor").fill("1000.00");
    await salesPage.getByRole("button", { name: "مراجعة البيانات" }).click();
    await expect(salesPage.getByRole("alert").first()).toBeFocused();
    await expect(salesPage.locator("#offer-evidencePacketId")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    await expect(salesPage.locator("#offer-customerPriceMinor")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    await expect(salesPage.locator("#offer-titleAr")).toHaveValue(arabicFields.titleAr);
    await salesPage.locator("#offer-evidencePacketId").fill(arabicFields.evidencePacketId);
    await salesPage.locator("#offer-customerPriceMinor").fill(arabicFields.customerPriceMinor);
    await salesPage.getByRole("button", { name: "مراجعة البيانات" }).click();
    const checkAnswers = salesPage.getByRole("region", { name: "مراجعة البيانات" });
    await expect(checkAnswers).toBeVisible();
    await expect(checkAnswers.getByText(arabicFields.titleAr)).toBeVisible();
    await expect(checkAnswers.getByText(arabicFields.includedLaborAr)).toBeVisible();
    await expect(checkAnswers.getByText(arabicFields.evidencePacketId)).toBeVisible();
    await expect(checkAnswers.getByText("800.00")).toBeVisible();
    expect(
      await salesPage.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <=
          innerWidth + 1
      )
    ).toBe(true);
    await salesPage.evaluate(() => window.scrollTo(0, 0));
    const checkScreenshot = testInfo.outputPath("offer-mobile-arabic-check-answers.png");
    await salesPage.screenshot({ path: checkScreenshot, fullPage: true });
    await testInfo.attach("offer-mobile-arabic-check-answers", {
      path: checkScreenshot,
      contentType: "image/png",
    });
    await salesPage.getByRole("button", { name: "حفظ المسودة" }).click();
    await salesPage.waitForURL(
      (url) =>
        /^\/staff\/offers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          url.pathname
        ),
      { timeout: 15_000 }
    );
    const arabicOfferId = new URL(salesPage.url()).pathname.split("/").at(-1)!;
    expect(arabicOfferId).not.toBe(offerId);
    const arabicDraft = await prisma.offerRevision.findFirstOrThrow({
      where: { offerId: arabicOfferId },
    });
    expect(arabicDraft.status).toBe("DRAFT");
    expect(arabicDraft.titleAr).toBe(arabicFields.titleAr);
    expect(arabicDraft.bookingRule).toBe("WALK_IN_ALLOWED");
    expect(arabicDraft.evidenceType).toBe("WRITTEN_QUOTE");
    expect(arabicDraft.normalPriceMinor.toString()).toBe("100000");
    expect(arabicDraft.customerPriceMinor.toString()).toBe("80000");
    expect(arabicDraft.commissionRateBps).toBe(0);
    const arabicFitmentSaved = await salesContext.request.put(
      new URL(
        `/api/v1/staff/offers/${arabicOfferId}/revisions/${arabicDraft.id}/fitment`,
        browserOrigin
      ).toString(),
      {
        headers: { Origin: browserOrigin },
        data: {
          commandId: crypto.randomUUID(),
          expectedVersion: 1,
          mode: "SERVICE_VEHICLE_INDEPENDENT_WITHIN_LISTED_COVERAGE",
          evidenceRef: `CI:E2E:ARABIC_SCOPE:${uid}`,
          coverage: fitmentCoverage,
        },
      }
    );
    expect(arabicFitmentSaved.status()).toBe(200);
    await salesPage.reload();
    await expect(salesPage.locator("main[dir=rtl]")).toBeVisible();
    await expect(salesPage.locator("form #offer-titleAr")).toHaveValue(arabicDraft.titleAr);
    await expect(salesPage.locator("form #offer-bookingRule")).toHaveValue(arabicDraft.bookingRule);
    await expect(salesPage.locator("form #offer-evidenceType")).toHaveValue(
      arabicDraft.evidenceType
    );
    const arabicSubmitSection = salesPage
      .locator("section")
      .filter({ hasText: "إرسال لمراجعة العمليات" });
    await arabicSubmitSection.getByRole("button", { name: "مراجعة البيانات" }).click();
    await arabicSubmitSection.getByRole("button", { name: "إرسال لمراجعة العمليات" }).click();
    await expect(
      salesPage.getByRole("status").filter({ hasText: "أكد الخادم إرسال العرض" })
    ).toBeVisible();

    console.info("[Offer E2E] Arabic Operations snapshot and decision");
    await opsPage
      .getByRole("button", { name: "Toggle language between Arabic and English" })
      .click();
    await opsPage.goto("/staff/ops/offers");
    await expect(opsPage.locator("main[dir=rtl]")).toBeVisible();
    await expect(opsPage.locator(`a[href="/staff/offers/${arabicOfferId}"]`)).toBeVisible();
    await opsPage.locator(`a[href="/staff/offers/${arabicOfferId}"]`).click();
    await expect(opsPage.getByText(arabicDraft.titleAr).first()).toBeVisible();
    for (const value of [
      arabicDraft.titleEn,
      arabicDraft.includedLaborEn,
      arabicDraft.includedLaborAr,
      arabicDraft.includedPartsEn,
      arabicDraft.includedPartsAr,
      arabicDraft.excludedLaborEn,
      arabicDraft.excludedLaborAr,
      arabicDraft.excludedPartsEn,
      arabicDraft.excludedPartsAr,
      arabicDraft.evidencePacketId,
      arabicDraft.commercialTermsPacketId,
      arabicDraft.priceBasisNotes,
    ]) {
      await expect(opsPage.getByText(value, { exact: true }).first()).toBeVisible();
    }
    await expect(opsPage.getByText("قاعدة الحجز", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("الزيارة دون موعد متاحة", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("نوع الإثبات", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("عرض سعر مكتوب", { exact: true })).toBeVisible();
    await expect(
      opsPage.getByText("بداية الصلاحية (توقيت القاهرة)", { exact: true })
    ).toBeVisible();
    await expect(
      opsPage.getByText("نهاية الصلاحية (توقيت القاهرة)", { exact: true })
    ).toBeVisible();
    await expect(opsPage.getByText("تاريخ الإثبات (توقيت القاهرة)", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("تاريخ الاتفاق (توقيت القاهرة)", { exact: true })).toBeVisible();
    for (const date of [
      arabicDraft.validFrom,
      arabicDraft.validUntil,
      arabicDraft.evidenceDate,
      arabicDraft.commercialTermsAgreedAt,
    ]) {
      await expect(
        opsPage
          .getByText(utcToCairoInput(date.toISOString()).replace("T", " "), { exact: true })
          .first()
      ).toBeVisible();
    }
    await expect(opsPage.getByText("المدة بالدقائق", { exact: true })).toBeVisible();
    await expect(
      opsPage.getByText(String(arabicDraft.durationMinutes), { exact: true }).first()
    ).toBeVisible();
    await expect(
      opsPage.getByText("العمولة المتفق عليها بالنقاط الأساسية (الصفر مسموح)", { exact: true })
    ).toBeVisible();
    await expect(opsPage.getByText("أساس احتساب العمولة", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("اسم الخدمة (بالإنجليزية)", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("اسم الخدمة (بالعربية)", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("نطاق الخدمة (بالإنجليزية)", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("نطاق الخدمة (بالعربية)", { exact: true })).toBeVisible();
    await expect(
      opsPage.getByText("Fixed oil and filter replacement", { exact: true })
    ).toBeVisible();
    await expect(opsPage.getByText("تغيير زيت وفلتر محدد النطاق", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("EGP 1000.00", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("EGP 800.00", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("0 bps (0.00%)", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("تاريخ الإرسال (توقيت القاهرة)", { exact: true })).toBeVisible();
    await expect(opsPage.getByText("معرّف الموظف المُرسل", { exact: true })).toBeVisible();
    await expect(opsPage.getByText(sales.userId, { exact: true })).toBeVisible();
    await expect(opsPage.getByText("موعد مسبق مطلوب", { exact: true })).toHaveCount(0);
    await expect(opsPage.getByRole("button", { name: "اعتماد داخلي" })).toBeDisabled();
    const reviewScreenshot = testInfo.outputPath("offer-mobile-arabic-ops-review.png");
    await opsPage.setViewportSize({ width: 390, height: 844 });
    expect(
      await opsPage.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <=
          innerWidth + 1
      )
    ).toBe(true);
    await opsPage.evaluate(() => window.scrollTo(0, 0));
    await opsPage.screenshot({ path: reviewScreenshot, fullPage: true });
    await testInfo.attach("offer-mobile-arabic-ops-review", {
      path: reviewScreenshot,
      contentType: "image/png",
    });
    const arabicApproval = await opsContext.request.post(
      new URL(
        `/api/v1/staff/ops/offers/${arabicOfferId}/revisions/${arabicDraft.id}/approve`,
        browserOrigin
      ).toString(),
      {
        headers: { Origin: browserOrigin },
        data: {
          expectedVersion: 3,
          evidenceInspected: true,
          priceVerified: true,
          scopeVerified: true,
          providerConsentVerified: true,
          fitmentAllVariantsAttested: true,
          fitmentScopePriceAttested: true,
        },
      }
    );
    expect(arabicApproval.status()).toBe(200);
    await opsPage.reload();
    const arabicApproved = await prisma.offerRevision.findUniqueOrThrow({
      where: { id: arabicDraft.id },
    });
    const arabicOffer = await prisma.offer.findUniqueOrThrow({ where: { id: arabicOfferId } });
    expect(arabicApproved.status).toBe("APPROVED");
    expect(arabicApproved.version).toBe(4);
    expect(arabicApproved.submittedByUserId).toBe(sales.userId);
    expect(arabicApproved.decidedByUserId).toBe(ops.userId);
    expect(arabicOffer.currentApprovedRevisionId).toBe(arabicDraft.id);
    expect(
      await prisma.securityAuditEvent.count({
        where: { targetEntity: `offer_revision:${arabicDraft.id}` },
      })
    ).toBe(4);
    console.info("[Offer E2E] Arabic mobile explicit publication and withdrawal");
    expect((await anonymousContext.request.get(`/api/v1/offers/${arabicOfferId}`)).status()).toBe(
      404
    );
    const arabicPublication = opsPage.getByRole("region", {
      name: "التحكم في نشر العروض للعملاء",
    });
    await expect(arabicPublication).toBeVisible();
    await expect(arabicPublication.getByText("مسحوب أو لم يُنشر بعد")).toBeVisible();
    await arabicPublication.getByRole("button", { name: "تحضير النشر" }).click();
    await expect(arabicPublication.getByText("مراجعة قرار النشر")).toBeVisible();
    await arabicPublication.getByRole("button", { name: "تأكيد أمر العمليات" }).click();
    await expect(arabicPublication.getByText("أمر النشر نشط")).toBeVisible();
    await expect(arabicPublication.getByText("نعم، مع إعادة التحقق عند كل طلب")).toBeVisible();
    const arabicPublicResponse = await anonymousContext.request.get(
      `/api/v1/offers/${arabicOfferId}`
    );
    expect(arabicPublicResponse.status()).toBe(200);
    const arabicPublic = (await arabicPublicResponse.json()) as Record<string, unknown>;
    expect(arabicPublic.revisionId).toBe(arabicDraft.id);
    expect(arabicPublic.titleAr).toBe(arabicDraft.titleAr);
    const arabicPublishedRow = await prisma.offerPublication.findUniqueOrThrow({
      where: { offerId: arabicOfferId },
    });
    expect(arabicPublishedRow.status).toBe("PUBLISHED");
    expect(arabicPublishedRow.pinnedRevisionId).toBe(arabicDraft.id);
    expect(arabicPublishedRow.version).toBe(1);
    const publicationScreenshot = testInfo.outputPath("offer-mobile-arabic-published.png");
    await opsPage.evaluate(() => window.scrollTo(0, 0));
    await opsPage.screenshot({ path: publicationScreenshot, fullPage: true });
    await testInfo.attach("offer-mobile-arabic-published", {
      path: publicationScreenshot,
      contentType: "image/png",
    });
    await arabicPublication.getByRole("button", { name: "تحضير سحب النشر" }).click();
    await arabicPublication.getByRole("button", { name: "تأكيد أمر العمليات" }).click();
    await expect(arabicPublication.getByText("مسحوب أو لم يُنشر بعد")).toBeVisible();
    expect((await anonymousContext.request.get(`/api/v1/offers/${arabicOfferId}`)).status()).toBe(
      404
    );
    const arabicWithdrawnRow = await prisma.offerPublication.findUniqueOrThrow({
      where: { offerId: arabicOfferId },
    });
    expect(arabicWithdrawnRow.status).toBe("UNPUBLISHED");
    expect(arabicWithdrawnRow.version).toBe(2);
    expect(
      await prisma.securityAuditEvent.count({
        where: {
          targetEntity: `offer:${arabicOfferId}`,
          eventType: { in: ["OFFER_PUBLISHED", "OFFER_UNPUBLISHED"] },
        },
      })
    ).toBe(2);
    await salesPage.reload();
    await expect(salesPage.getByText(arabicDraft.titleAr).first()).toBeVisible();
    expect(
      await salesPage.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <=
          innerWidth + 1
      )
    ).toBe(true);
    await salesPage.evaluate(() => window.scrollTo(0, 0));
    const screenshotPath = testInfo.outputPath("offer-mobile-arabic.png");
    await salesPage.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach("offer-mobile-arabic", {
      path: screenshotPath,
      contentType: "image/png",
    });

    console.info("[Offer E2E] Undelivered publish is recovered with original command identity");
    await opsPage
      .getByRole("button", { name: "Toggle language between Arabic and English" })
      .click();
    await opsPage.goto(`/staff/offers/${offerId}`);
    await expect(englishPublication.getByText("Withdrawn or never published")).toBeVisible();
    let undeliveredPayload: Record<string, unknown> | undefined;
    const englishPublicationUrl = `**/api/v1/staff/ops/offers/${offerId}/publication`;
    await opsPage.route(englishPublicationUrl, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      undeliveredPayload = route.request().postDataJSON() as Record<string, unknown>;
      // Abort before route.continue/route.fetch: the API never sees this browser request.
      await route.abort("failed");
    });
    await englishPublication.getByRole("button", { name: "Prepare publication" }).click();
    await englishPublication.getByRole("button", { name: "Confirm Operations command" }).click();
    await expect(
      englishPublication.getByText("The command outcome is unknown.", { exact: false }).first()
    ).toBeVisible();
    await opsPage.unroute(englishPublicationUrl);
    const undeliveredJournal = JSON.parse(
      (await opsPage.evaluate(() => sessionStorage.getItem("waffarhacars_publication_pending_v1")))!
    ) as {
      commandId: string;
      offerId: string;
      action: string;
      revisionId: string;
      expectedVersion: number;
    };
    expect(undeliveredJournal.offerId).toBe(offerId);
    expect(undeliveredJournal.action).toBe("PUBLISH");
    expect(undeliveredJournal.revisionId).toBe(draft.id);
    expect(undeliveredJournal.expectedVersion).toBe(2);
    expect(undeliveredPayload).toEqual({
      commandId: undeliveredJournal.commandId,
      action: undeliveredJournal.action,
      revisionId: undeliveredJournal.revisionId,
      expectedVersion: undeliveredJournal.expectedVersion,
    });
    expect(
      await prisma.offerPublicationCommand.count({
        where: { commandId: undeliveredJournal.commandId },
      })
    ).toBe(0);
    await opsPage.reload();
    await englishPublication.getByRole("button", { name: "Recheck publication command" }).click();
    await expect(
      englishPublication.getByText("No durable command record found.", { exact: false })
    ).toBeVisible();
    const exactRetryRequest = opsPage.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith(`/api/v1/staff/ops/offers/${offerId}/publication`)
    );
    await englishPublication
      .getByRole("button", { name: "Retry same publication command" })
      .click();
    expect((await exactRetryRequest).postDataJSON()).toEqual(undeliveredPayload);
    await expect(englishPublication.getByText("Published command active")).toBeVisible();
    const recoveredPublish = await prisma.offerPublication.findUniqueOrThrow({
      where: { offerId },
    });
    expect(recoveredPublish.version).toBe(3);
    expect(recoveredPublish.status).toBe("PUBLISHED");
    expect(recoveredPublish.pinnedRevisionId).toBe(draft.id);
    expect(
      await prisma.offerPublicationCommand.count({
        where: { commandId: undeliveredJournal.commandId, outcome: "APPLIED" },
      })
    ).toBe(1);
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_PUBLISHED", targetEntity: `offer:${offerId}` },
      })
    ).toBe(2);
    expect((await anonymousContext.request.get(`/api/v1/offers/${offerId}`)).status()).toBe(200);

    console.info("[Offer E2E] Browser same-key retry overlaps an in-flight real API command");
    let overlappingPayload: Record<string, unknown> | undefined;
    await opsPage.route(englishPublicationUrl, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      overlappingPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.abort("failed");
    });
    await englishPublication.getByRole("button", { name: "Prepare withdrawal" }).click();
    await englishPublication.getByRole("button", { name: "Confirm Operations command" }).click();
    await expect(
      englishPublication.getByText("The command outcome is unknown.", { exact: false }).first()
    ).toBeVisible();
    await opsPage.unroute(englishPublicationUrl);
    const overlappingJournal = JSON.parse(
      (await opsPage.evaluate(() => sessionStorage.getItem("waffarhacars_publication_pending_v1")))!
    ) as { commandId: string; offerId: string; action: string; expectedVersion: number };
    expect(overlappingJournal.offerId).toBe(offerId);
    expect(overlappingJournal.action).toBe("UNPUBLISH");
    expect(overlappingJournal.expectedVersion).toBe(3);
    expect(overlappingPayload).toEqual({
      commandId: overlappingJournal.commandId,
      action: overlappingJournal.action,
      expectedVersion: overlappingJournal.expectedVersion,
    });
    await englishPublication.getByRole("button", { name: "Recheck publication command" }).click();
    await expect(
      englishPublication.getByText("No durable command record found.", { exact: false })
    ).toBeVisible();
    const overlapBlocker = new pg.Client({ connectionString: databaseUrl });
    await overlapBlocker.connect();
    let originalResponse: Promise<Awaited<ReturnType<typeof opsPage.request.post>>> | undefined;
    try {
      await overlapBlocker.query("BEGIN");
      await overlapBlocker.query("SELECT id FROM provider_organizations WHERE id = $1 FOR UPDATE", [
        provider.id,
      ]);
      originalResponse = opsPage.request.post(
        new URL(`/api/v1/staff/ops/offers/${offerId}/publication`, opsPage.url()).toString(),
        {
          data: overlappingPayload,
          headers: { Origin: new URL(opsPage.url()).origin },
        }
      );
      expect(await waitForBlockedRequests(overlapBlocker, 1)).toBeGreaterThanOrEqual(1);
      const retryRequest = opsPage.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith(`/api/v1/staff/ops/offers/${offerId}/publication`)
      );
      await englishPublication
        .getByRole("button", { name: "Retry same publication command" })
        .click();
      expect((await retryRequest).postDataJSON()).toEqual(overlappingPayload);
      expect(await waitForBlockedRequests(overlapBlocker, 2)).toBeGreaterThanOrEqual(2);
    } finally {
      await overlapBlocker.query("COMMIT").catch(async () => overlapBlocker.query("ROLLBACK"));
      await overlapBlocker.end();
    }
    expect((await originalResponse!).status()).toBe(200);
    await expect(englishPublication.getByText("Withdrawn or never published")).toBeVisible();
    const overlapWithdrawn = await prisma.offerPublication.findUniqueOrThrow({
      where: { offerId },
    });
    expect(overlapWithdrawn.status).toBe("UNPUBLISHED");
    expect(overlapWithdrawn.version).toBe(4);
    expect(
      await prisma.offerPublicationCommand.count({
        where: { commandId: overlappingJournal.commandId, outcome: "APPLIED" },
      })
    ).toBe(1);
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_UNPUBLISHED", targetEntity: `offer:${offerId}` },
      })
    ).toBe(2);

    console.info("[Offer E2E] Lock-timeout rollback and same-key withdrawal while branch paused");
    await opsPage
      .getByRole("button", { name: "Toggle language between Arabic and English" })
      .click();
    await opsPage.goto(`/staff/offers/${arabicOfferId}`);
    await expect(arabicPublication.getByText("مسحوب أو لم يُنشر بعد")).toBeVisible();
    await arabicPublication.getByRole("button", { name: "تحضير النشر" }).click();
    await arabicPublication.getByRole("button", { name: "تأكيد أمر العمليات" }).click();
    await expect(arabicPublication.getByText("أمر النشر نشط")).toBeVisible();
    const republishedArabic = await prisma.offerPublication.findUniqueOrThrow({
      where: { offerId: arabicOfferId },
    });
    expect(republishedArabic.version).toBe(3);
    await prisma.providerBranch.update({ where: { id: branch.id }, data: { status: "PAUSED" } });
    expect((await anonymousContext.request.get(`/api/v1/offers/${arabicOfferId}`)).status()).toBe(
      404
    );
    await arabicPublication.getByRole("button", { name: "تحديث" }).click();
    await expect(arabicPublication.getByText("الفرع غير نشط.")).toBeVisible();
    const rollbackBlocker = new pg.Client({ connectionString: databaseUrl });
    await rollbackBlocker.connect();
    let rolledBackCommandId: string | undefined;
    let rollbackPayload: Record<string, unknown> | undefined;
    try {
      await rollbackBlocker.query("BEGIN");
      await rollbackBlocker.query(
        "SELECT id FROM provider_organizations WHERE id = $1 FOR UPDATE",
        [provider.id]
      );
      const failedRequest = opsPage.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          request.url().endsWith(`/api/v1/staff/ops/offers/${arabicOfferId}/publication`)
      );
      const failedResponse = opsPage.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/api/v1/staff/ops/offers/${arabicOfferId}/publication`)
      );
      await arabicPublication.getByRole("button", { name: "تحضير سحب النشر" }).click();
      await arabicPublication.getByRole("button", { name: "تأكيد أمر العمليات" }).click();
      rollbackPayload = (await failedRequest).postDataJSON() as Record<string, unknown>;
      rolledBackCommandId = rollbackPayload.commandId as string;
      expect(await waitForBlockedRequests(rollbackBlocker, 1)).toBeGreaterThanOrEqual(1);
      expect((await failedResponse).status()).toBe(503);
      await expect(
        arabicPublication.getByText("نتيجة الأمر غير مؤكدة.", { exact: false }).first()
      ).toBeVisible();
      const afterRollback = await prisma.offerPublication.findUniqueOrThrow({
        where: { offerId: arabicOfferId },
      });
      expect(afterRollback.status).toBe("PUBLISHED");
      expect(afterRollback.version).toBe(3);
      expect(
        await prisma.offerPublicationCommand.count({ where: { commandId: rolledBackCommandId } })
      ).toBe(0);
      expect(
        await prisma.securityAuditEvent.count({
          where: { eventType: "OFFER_UNPUBLISHED", targetEntity: `offer:${arabicOfferId}` },
        })
      ).toBe(1);
    } finally {
      await rollbackBlocker.query("COMMIT").catch(async () => rollbackBlocker.query("ROLLBACK"));
      await rollbackBlocker.end();
    }
    await arabicPublication.getByRole("button", { name: "إعادة فحص أمر النشر" }).click();
    await expect(
      arabicPublication.getByRole("button", { name: "إعادة محاولة أمر النشر نفسه" })
    ).toBeVisible();
    const recoveredWithdrawalRequest = opsPage.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith(`/api/v1/staff/ops/offers/${arabicOfferId}/publication`)
    );
    await arabicPublication.getByRole("button", { name: "إعادة محاولة أمر النشر نفسه" }).click();
    expect((await recoveredWithdrawalRequest).postDataJSON()).toEqual(rollbackPayload);
    await expect(arabicPublication.getByText("مسحوب أو لم يُنشر بعد")).toBeVisible();
    const recoveredWithdrawal = await prisma.offerPublication.findUniqueOrThrow({
      where: { offerId: arabicOfferId },
    });
    expect(recoveredWithdrawal.status).toBe("UNPUBLISHED");
    expect(recoveredWithdrawal.version).toBe(4);
    expect(
      await prisma.offerPublicationCommand.count({
        where: { commandId: rolledBackCommandId, outcome: "APPLIED" },
      })
    ).toBe(1);
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_UNPUBLISHED", targetEntity: `offer:${arabicOfferId}` },
      })
    ).toBe(2);
    expect((await anonymousContext.request.get(`/api/v1/offers/${arabicOfferId}`)).status()).toBe(
      404
    );
  } finally {
    const closeResults = await Promise.allSettled(contexts.map((context) => context.close()));
    // The database intentionally freezes submitted coverage and capability
    // history. CI supplies a disposable database; uniquely named synthetic
    // fixtures are removed with that database, not by bypassing its guards.
    await disconnectDb();
    if (
      testInfo.status === "passed" &&
      closeResults.some((result) => result.status === "rejected")
    ) {
      throw new Error("Offer E2E context cleanup failed");
    }
  }
});
