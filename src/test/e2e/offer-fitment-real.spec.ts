import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import pg from "pg";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricEncrypt } from "better-auth/crypto";
import { getPrisma, disconnectDb } from "@/lib/db";
import { provisionStaffMember } from "@/lib/staff/provisioning";
import { OFFER_FITMENT_JOURNAL_KEY } from "@/lib/fitment/offer-client";
import en from "@/i18n/en.json" with { type: "json" };

const password = "ValidStaffPassword123!";
const secret = "JBSWY3DPEHPK3PXP";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function login(page: Page, email: string) {
  await page.goto("/staff/login");
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(password);
  await page.locator("button[type=submit]").click();
  await page.waitForURL("**/staff/mfa/verify");
  await page
    .locator("input[type=text]")
    .fill(await createOTP(secret, { digits: 6, period: 30 }).totp());
  await page.locator("button[type=submit]").click();
  await page.waitForURL(
    (url) => !url.pathname.includes("/mfa/") && !url.pathname.endsWith("/login")
  );
}
async function fillFitment(page: Page, fixture: Fixture, evidenceRef: string) {
  if (!(await page.getByTestId("offer-fitment-mode").isVisible()))
    await page.getByTestId("offer-editor-fitment").click();
  await page.getByTestId("offer-fitment-mode").selectOption("BASE_VEHICLE_ALL_VARIANTS_VERIFIED");
  await page.getByTestId("offer-fitment-evidence").fill(evidenceRef);
  if ((await page.locator("#fitment-make-0").count()) === 0)
    await page.getByTestId("fitment-add-range").click();
  const makeOption = page.locator(`#fitment-make-0 option[value="${fixture.make.id}"]`);
  await expect
    .poll(async () => {
      if ((await makeOption.count()) > 0) return true;
      const more = page.getByTestId("fitment-more-makes");
      if ((await more.isVisible()) && (await more.isEnabled())) {
        const response = page.waitForResponse(
          (item) =>
            item.request().method() === "GET" && item.url().includes("/api/v1/vehicles/catalog?")
        );
        await more.click();
        expect((await response).status()).toBe(200);
      }
      return (await makeOption.count()) > 0;
    })
    .toBe(true);
  await page.locator("#fitment-make-0").selectOption(fixture.make.id);
  await expect(page.locator(`#fitment-model-0 option[value="${fixture.model.id}"]`)).toHaveCount(1);
  await page.locator("#fitment-model-0").selectOption(fixture.model.id);
  await page.locator("#fitment-yearFrom-0").fill("2020");
  await page.locator("#fitment-yearTo-0").fill("2024");
}

async function fixture() {
  const prisma = getPrisma();
  const uid = crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)
    .replace(/[0-9]/g, (digit) => String.fromCharCode(65 + Number(digit)))
    .toUpperCase();
  if ((await prisma.internalStaffMembership.count()) === 0)
    await provisionStaffMember({
      email: `fitment-bootstrap-${uid}@test.eg`,
      password,
      fullName: "E2E Bootstrap",
      employeeNumber: `BOOT-${uid}`,
      department: "ADMIN",
      isBootstrap: true,
    });
  async function staff(
    department: "SALES" | "OPERATIONS",
    role: "SALES_AGENT" | "OPS_SUPERVISOR",
    suffix = ""
  ) {
    const email = `fitment-${department.toLowerCase()}-${suffix}${uid}@test.eg`;
    const member = await provisionStaffMember({
      email,
      password,
      fullName: `Synthetic ${department}`,
      employeeNumber: `${department}-${suffix}${uid}`,
      department,
      role,
      isBootstrap: false,
    });
    await prisma.user.update({ where: { id: member.userId }, data: { twoFactorEnabled: true } });
    await prisma.twoFactor.create({
      data: {
        userId: member.userId,
        secret: await symmetricEncrypt({
          key:
            process.env.BETTER_AUTH_SECRET ??
            "ci-non-production-test-secret-at-least-32-chars-long",
          data: secret,
        }),
        backupCodes: "[]",
        verified: true,
      },
    });
    await prisma.internalStaffMembership.update({
      where: { userId: member.userId },
      data: { mustChangePassword: false, isActive: true },
    });
    return { email, userId: member.userId };
  }
  const sales = await staff("SALES", "SALES_AGENT");
  const ops = await staff("OPERATIONS", "OPS_SUPERVISOR");
  const provider = await prisma.providerOrganization.create({
    data: {
      nameEn: `Synthetic fitment ${uid}`,
      nameAr: `مركز تجريبي ${uid}`,
      legalName: `Synthetic ${uid}`,
      taxRegistrationNumber: String(Math.floor(100000000 + Math.random() * 900000000)),
      commercialRegistrationNumber: `FIT-${uid}`,
      primaryCluster: "NASR_CITY_HELIOPOLIS",
      status: "ACTIVE",
      version: 1,
      contactPersonName: "Synthetic Contact",
      contactEmail: `fitment-${uid}@test.eg`,
      contactPhone: "+201011112222",
      createdByUserId: sales.userId,
      activatedByUserId: ops.userId,
      activatedAt: new Date(),
    },
  });
  const branch = await prisma.providerBranch.create({
    data: {
      providerOrganizationId: provider.id,
      branchCode: `FIT-${uid}`,
      nameEn: "Synthetic fitment branch",
      nameAr: "فرع تجريبي",
      cluster: "NASR_CITY_HELIOPOLIS",
      streetAddressEn: "Synthetic Street",
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
      evidenceDocumentRef: `CI:BRANCH:${uid}`,
      vettedByUserId: ops.userId,
      vettedAt: new Date(),
    },
  });
  const category = await prisma.serviceCategory.findUniqueOrThrow({
    where: { code: "EXPRESS_MAINTENANCE" },
  });
  const definition = await prisma.serviceDefinition.create({
    data: {
      code: `FIT_${uid}`,
      categoryId: category.id,
      nameEn: "Synthetic fixed service",
      nameAr: "خدمة تجريبية",
      scopeEn: "Synthetic fixed scope",
      scopeAr: "نطاق تجريبي",
      pricingMode: "FIXED_SCOPE",
      createdByUserId: ops.userId,
      updatedByUserId: ops.userId,
    },
  });
  const make = await prisma.vehicleMake.create({
    data: {
      code: `FIT_${uid}`,
      nameEn: "Synthetic fitment make",
      nameAr: "ماركة تجريبية",
      evidenceRef: "CI:MAKE",
    },
  });
  const model = await prisma.vehicleModel.create({
    data: {
      code: "SYNTHETIC",
      makeId: make.id,
      nameEn: "Synthetic fitment model",
      nameAr: "طراز تجريبي",
      evidenceRef: "CI:MODEL",
    },
  });
  return { prisma, uid, sales, ops, provider, branch, definition, make, model, staff };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function createDraft(context: BrowserContext, f: Fixture) {
  const fields = {
    titleEn: "Synthetic oil change",
    titleAr: "تغيير زيت تجريبي",
    includedLaborEn: "Drain and refill",
    includedLaborAr: "تفريغ وتعبئة",
    includedPartsEn: "Oil and filter",
    includedPartsAr: "زيت وفلتر",
    excludedLaborEn: "Diagnosis",
    excludedLaborAr: "الفحص",
    excludedPartsEn: "Extra parts",
    excludedPartsAr: "قطع إضافية",
    bookingRule: "WALK_IN_ALLOWED",
    durationMinutes: 45,
    validFrom: new Date(Date.now() - 86_400_000).toISOString(),
    validUntil: new Date(Date.now() + 15 * 86_400_000).toISOString(),
    normalPriceMinor: "100000",
    customerPriceMinor: "80000",
    evidencePacketId: "CI_PRICE",
    evidenceType: "WRITTEN_QUOTE",
    evidenceDate: new Date(Date.now() - 86_400_000).toISOString(),
    priceBasisNotes: "Synthetic written price",
    commercialTermsPacketId: "CI_TERMS",
    commercialTermsAgreedAt: new Date(Date.now() - 86_400_000).toISOString(),
    commissionBasis: "DISCOUNTED_CUSTOMER_PRICE",
    commissionRateBps: 0,
  };
  const response = await context.request.post("/api/v1/staff/offers", {
    headers: { Origin: new URL(context.pages()[0].url()).origin },
    data: {
      creationRequestId: crypto.randomUUID(),
      revisionRequestId: crypto.randomUUID(),
      providerOrganizationId: f.provider.id,
      branchId: f.branch.id,
      serviceDefinitionId: f.definition.id,
      fields,
    },
  });
  expect(response.status()).toBe(201);
  const created = (await response.json()) as { offer: { id: string }; revision: { id: string } };
  return {
    offerId: created.offer.id,
    revisionId: created.revision.id,
    fields,
    path: `/api/v1/staff/offers/${created.offer.id}/revisions/${created.revision.id}/fitment`,
    workspace: `/staff/offers/${created.offer.id}`,
  };
}
type Draft = Awaited<ReturnType<typeof createDraft>>;
async function newSession(browser: Browser, f: Fixture, contexts: BrowserContext[]) {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.94" },
  });
  contexts.push(context);
  const page = await context.newPage();
  await login(page, f.sales.email);
  return { context, page };
}
async function snapshot(f: Fixture, draft: Draft) {
  const revision = await f.prisma.offerRevision.findUniqueOrThrow({
    where: { id: draft.revisionId },
    include: { fitmentCoverage: true },
  });
  const receipts = await f.prisma.fitmentCommand.count({ where: { resourceId: draft.revisionId } });
  const audits = await f.prisma.securityAuditEvent.count({
    where: {
      eventType: "OFFER_FITMENT_UPDATED",
      targetEntity: `offer_revision:${draft.revisionId}`,
    },
  });
  return { revision, receipts, audits };
}
async function cleanup(contexts: BrowserContext[]) {
  try {
    await Promise.all(contexts.map((context) => context.close()));
  } finally {
    await disconnectDb();
  }
}

const approvalChecks = {
  evidenceInspected: true,
  priceVerified: true,
  scopeVerified: true,
  providerConsentVerified: true,
  fitmentAllVariantsAttested: true,
  fitmentScopePriceAttested: true,
};
const approvalLabels = [
  en.staffOffers.attestEvidence,
  en.staffOffers.attestPrice,
  en.staffOffers.attestScope,
  en.staffOffers.attestConsent,
  en.staffOffers.attestFitmentVariants,
  en.staffOffers.attestFitmentScopePrice,
];
async function opsSession(browser: Browser, f: Fixture, contexts: BrowserContext[]) {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": "198.51.100.95" },
  });
  contexts.push(context);
  const page = await context.newPage();
  await login(page, f.ops.email);
  return { context, page };
}
async function submitAndApprove(
  sales: BrowserContext,
  ops: BrowserContext,
  draft: Draft,
  version: number
) {
  const origin = new URL(sales.pages()[0].url()).origin;
  const submitted = await sales.request.post(draft.path.replace(/\/fitment$/, "/submit"), {
    headers: { Origin: origin },
    data: { expectedVersion: version },
  });
  expect(submitted.status()).toBe(200);
  const approved = await ops.request.post(
    `/api/v1/staff/ops/offers/${draft.offerId}/revisions/${draft.revisionId}/approve`,
    { headers: { Origin: origin }, data: { expectedVersion: version + 1, ...approvalChecks } }
  );
  expect(approved.status()).toBe(200);
}

test("real fitment and commercial browser saves: controlled first-commit ordering shares CAS and preserves dirty loser input", async ({
  browser,
}) => {
  const f = await fixture();
  const contexts: BrowserContext[] = [];
  const releases: (() => void)[] = [];
  try {
    const { context } = await newSession(browser, f, contexts);
    for (const first of ["commercial", "fitment"] as const) {
      const draft = await createDraft(context, f);
      const page = await context.newPage();
      const contender = await context.newPage();
      await page.goto(draft.workspace);
      await contender.goto(draft.workspace);
      await page.locator("#offer-titleEn").fill("Commercial contender wins only by CAS");
      await expect(page.getByTestId("offer-editor-fitment")).toBeDisabled();
      await page
        .getByRole("navigation", { name: "Staff navigation", exact: true })
        .getByRole("link", { name: en.staffOffers.offers, exact: true })
        .click();
      await expect(
        page.getByRole("alert").filter({ hasText: en.offerFitment.navigationBlocked })
      ).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${draft.workspace}$`));
      await expect(page.locator("#offer-titleEn")).toHaveValue(
        "Commercial contender wins only by CAS"
      );
      await page.getByTestId("offer-commercial-discard").click();
      await expect(page.getByTestId("offer-editor-fitment")).toBeEnabled();
      await fillFitment(page, f, "CI:DISCARD_UNSAVED");
      await expect(page.getByTestId("offer-editor-commercial")).toBeDisabled();
      await page.getByTestId("offer-fitment-discard").click();
      await page.getByTestId("offer-editor-commercial").click();
      await expect(page.locator("#offer-titleEn")).toHaveValue(draft.fields.titleEn);
      await page.locator("#offer-titleEn").fill("Commercial contender wins only by CAS");
      await page.locator("form").getByRole("button", { name: "Check answers" }).click();
      await fillFitment(contender, f, `CI:ORDER:${first}`);
      await expect(contender.getByTestId("offer-editor-commercial")).toBeDisabled();
      const loser = first === "commercial" ? contender : page;
      const loserMethod = first === "commercial" ? "PUT" : "PATCH";
      const loserPath = first === "commercial" ? draft.path : draft.path.replace(/\/fitment$/, "");
      const held = deferred();
      const release = deferred();
      releases.push(release.resolve);
      await loser.route(`**${loserPath}`, async (route) => {
        if (route.request().method() !== loserMethod) return route.continue();
        held.resolve();
        await release.promise;
        await route.continue();
      });
      await (
        first === "commercial"
          ? contender.getByTestId("offer-fitment-save")
          : page.getByRole("button", { name: "Save draft" })
      ).click();
      await held.promise;
      const winningPage = first === "commercial" ? page : contender;
      const winningResponse = winningPage.waitForResponse(
        (response) =>
          response.request().method() === (first === "commercial" ? "PATCH" : "PUT") &&
          new URL(response.url()).pathname ===
            (first === "commercial" ? draft.path.replace(/\/fitment$/, "") : draft.path)
      );
      await (
        first === "commercial"
          ? page.getByRole("button", { name: "Save draft" })
          : contender.getByTestId("offer-fitment-save")
      ).click();
      expect((await winningResponse).status()).toBe(200);
      const staleResponse = loser.waitForResponse(
        (response) =>
          response.request().method() === loserMethod &&
          new URL(response.url()).pathname === loserPath
      );
      release.resolve();
      expect((await staleResponse).status()).toBe(409);
      const after = await snapshot(f, draft);
      expect(after.revision.version).toBe(2);
      expect(after.revision.status).toBe("DRAFT");
      expect(after.revision.titleEn).toBe(
        first === "commercial" ? "Commercial contender wins only by CAS" : draft.fields.titleEn
      );
      expect(after.revision.fitmentEvidenceRef).toBe(
        first === "fitment" ? "CI:ORDER:fitment" : null
      );
      expect(after.revision.fitmentCoverage).toHaveLength(first === "fitment" ? 1 : 0);
      expect(after.receipts).toBe(first === "fitment" ? 1 : 0);
      expect(after.audits).toBe(first === "fitment" ? 1 : 0);
      if (first === "commercial")
        await expect(contender.getByTestId("offer-fitment-evidence")).toHaveValue(
          "CI:ORDER:commercial"
        );
      else
        await expect(page.locator("#offer-titleEn")).toHaveValue(
          "Commercial contender wins only by CAS"
        );
      await loser.unroute(`**${loserPath}`);
      // These contexts contain deliberately dirty losing forms. Browser closure
      // ends the test-owned intent; no application journal is manually erased.
      await contender.close();
      await page.close();
    }
  } finally {
    releases.forEach((release) => release());
    await cleanup(contexts);
  }
});

test("real fitment versus submission: ordered commits reject stale submit or freeze the losing fitment edit without partial writes", async ({
  browser,
}) => {
  const f = await fixture();
  const contexts: BrowserContext[] = [];
  const releases: (() => void)[] = [];
  try {
    const { context } = await newSession(browser, f, contexts);
    for (const first of ["fitment", "submit"] as const) {
      const draft = await createDraft(context, f);
      const page = await context.newPage();
      await page.goto(draft.workspace);
      await fillFitment(page, f, "CI:INITIAL_SCOPE");
      await page.getByTestId("offer-fitment-save").click();
      await expect.poll(async () => (await snapshot(f, draft)).revision.version).toBe(2);
      await expect
        .poll(() => page.evaluate((key) => sessionStorage.getItem(key), OFFER_FITMENT_JOURNAL_KEY))
        .toBeNull();
      const submitPage = await context.newPage();
      await submitPage.goto(draft.workspace);
      const submitSection = submitPage
        .locator("section")
        .filter({ hasText: "Submit for Operations review" });
      await submitSection.getByRole("button", { name: "Check answers" }).click();
      await page.getByTestId("offer-fitment-evidence").fill("CI:EDITED_SCOPE");
      const loser = first === "fitment" ? submitPage : page;
      const loserPath =
        first === "fitment" ? draft.path.replace(/\/fitment$/, "/submit") : draft.path;
      const loserMethod = first === "fitment" ? "POST" : "PUT";
      const held = deferred();
      const release = deferred();
      releases.push(release.resolve);
      await loser.route(`**${loserPath}`, async (route) => {
        if (route.request().method() !== loserMethod) return route.continue();
        held.resolve();
        await release.promise;
        await route.continue();
      });
      await (
        first === "fitment"
          ? submitSection.getByRole("button", { name: "Submit for Operations review" })
          : page.getByTestId("offer-fitment-save")
      ).click();
      await held.promise;
      const winner = first === "fitment" ? page : submitPage;
      const winnerResponse = winner.waitForResponse(
        (response) =>
          response.request().method() === (first === "fitment" ? "PUT" : "POST") &&
          new URL(response.url()).pathname ===
            (first === "fitment" ? draft.path : draft.path.replace(/\/fitment$/, "/submit"))
      );
      await (
        first === "fitment"
          ? page.getByTestId("offer-fitment-save")
          : submitSection.getByRole("button", { name: "Submit for Operations review" })
      ).click();
      expect((await winnerResponse).status()).toBe(200);
      const staleResponse = loser.waitForResponse(
        (response) =>
          response.request().method() === loserMethod &&
          new URL(response.url()).pathname === loserPath
      );
      release.resolve();
      expect((await staleResponse).status()).toBe(first === "fitment" ? 409 : 422);
      const after = await snapshot(f, draft);
      expect(after.revision.version).toBe(3);
      expect(after.revision.status).toBe(first === "fitment" ? "DRAFT" : "PENDING_REVIEW");
      expect(after.revision.fitmentEvidenceRef).toBe(
        first === "fitment" ? "CI:EDITED_SCOPE" : "CI:INITIAL_SCOPE"
      );
      expect(after.revision.fitmentCoverage).toHaveLength(1);
      expect(after.receipts).toBe(first === "fitment" ? 2 : 1);
      expect(after.audits).toBe(after.receipts);
      await loser.unroute(`**${loserPath}`);
      await submitPage.close();
      await page.close();
    }
  } finally {
    releases.forEach((release) => release());
    await cleanup(contexts);
  }
});

test("real fitment account switching waits for the foreign workspace final session check and preserves original actor recovery", async ({
  browser,
}) => {
  const f = await fixture();
  const contexts: BrowserContext[] = [];
  const release = deferred();
  try {
    const { context, page } = await newSession(browser, f, contexts);
    const draft = await createDraft(context, f);
    await page.goto(draft.workspace);
    await fillFitment(page, f, "CI:ACCOUNT_PRIVATE_EVIDENCE");
    let originalBody: string | null = null;
    await page.route(`**${draft.path}`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      originalBody = route.request().postData();
      await route.abort("failed");
    });
    await page.getByTestId("offer-fitment-save").click();
    await expect(page.getByTestId("offer-fitment-recheck")).toBeEnabled();
    const originalJournal = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      OFFER_FITMENT_JOURNAL_KEY
    );
    expect(originalJournal).not.toBeNull();
    expect(originalBody).not.toBeNull();
    await page.unroute(`**${draft.path}`);
    await context.clearCookies();
    const accountTab = await context.newPage();
    await login(accountTab, f.ops.email);
    expect(await (await context.request.get("/api/v1/staff/auth/status")).json()).toMatchObject({
      state: "ACTIVE",
      userId: f.ops.userId,
    });
    let foreignReceiptReads = 0;
    page.on("request", (request) => {
      if (request.url().includes(`${draft.path}/commands/`)) foreignReceiptReads += 1;
    });
    const held = deferred();
    const offerPath = `/api/v1/staff/offers/${draft.offerId}`;
    await page.route(`**${offerPath}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      held.resolve();
      await release.promise;
      await route.fulfill({ response: actual });
    });
    await page.getByTestId("offer-fitment-recheck").click();
    await held.promise;
    await expect(page.getByTestId("offer-detail-refresh")).toBeDisabled();
    const finalAuth = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/staff/auth/status"
    );
    release.resolve();
    expect(await (await finalAuth).json()).toMatchObject({ state: "ACTIVE", userId: f.ops.userId });
    await expect(page.getByTestId("offer-detail-refresh")).toBeEnabled();
    await expect(
      page.getByRole("alert").filter({ hasText: en.offerFitment.otherOwner })
    ).toBeVisible();
    await expect(page.getByTestId("offer-fitment-evidence")).toHaveCount(0);
    await expect(page.getByText("CI:ACCOUNT_PRIVATE_EVIDENCE", { exact: true })).toHaveCount(0);
    expect(foreignReceiptReads).toBe(0);
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), OFFER_FITMENT_JOURNAL_KEY)
    ).toBe(originalJournal);
    const foreignState = await snapshot(f, draft);
    expect(foreignState.revision.version).toBe(1);
    expect(foreignState.receipts).toBe(0);
    expect(foreignState.audits).toBe(0);
    await page.unroute(`**${offerPath}`);
    // Complete the foreign page's real final-auth check BEFORE clearing shared
    // cookies. A generic alert does not establish that the read has settled.
    await context.clearCookies();
    await login(accountTab, f.sales.email);
    expect(await (await context.request.get("/api/v1/staff/auth/status")).json()).toMatchObject({
      state: "ACTIVE",
      userId: f.sales.userId,
    });
    await accountTab.close();
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(draft.workspace);
    await page.getByTestId("offer-fitment-recheck").click();
    await page.getByTestId("offer-fitment-restore").click();
    await fillFitment(page, f, "CI:ACCOUNT_PRIVATE_EVIDENCE");
    const retry = page.waitForRequest(
      (request) => request.method() === "PUT" && new URL(request.url()).pathname === draft.path
    );
    await page.getByTestId("offer-fitment-retry").click();
    expect((await retry).postData()).toBe(originalBody);
    await expect
      .poll(() => page.evaluate((key) => sessionStorage.getItem(key), OFFER_FITMENT_JOURNAL_KEY))
      .toBeNull();
    const recovered = await snapshot(f, draft);
    expect(recovered.revision.version).toBe(2);
    expect(recovered.revision.status).toBe("DRAFT");
    expect(recovered.revision.fitmentEvidenceRef).toBe("CI:ACCOUNT_PRIVATE_EVIDENCE");
    expect(recovered.receipts).toBe(1);
    expect(recovered.audits).toBe(1);
  } finally {
    release.resolve();
    await cleanup(contexts);
  }
});

test("one offer workspace saves both editor orderings against refreshed shared versions without dropping either content", async ({
  browser,
}, testInfo) => {
  const f = await fixture();
  const contexts: BrowserContext[] = [];
  try {
    const { context } = await newSession(browser, f, contexts);
    for (const first of ["commercial", "fitment"] as const) {
      const draft = await createDraft(context, f);
      const page = await context.newPage();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(draft.workspace);
      for (const editor of first === "commercial"
        ? ["commercial", "fitment"]
        : ["fitment", "commercial"]) {
        if (editor === "commercial") {
          await page.getByTestId("offer-editor-commercial").click();
          await page.locator("#offer-titleEn").fill("Deliberately saved commercial scope");
          await expect(page.getByTestId("offer-editor-fitment")).toBeDisabled();
          await page.locator("form").getByRole("button", { name: "Check answers" }).click();
          const saved = page.waitForResponse(
            (response) =>
              response.request().method() === "PATCH" &&
              new URL(response.url()).pathname === draft.path.replace(/\/fitment$/, "")
          );
          await page.getByRole("button", { name: "Save draft" }).click();
          expect((await saved).status()).toBe(200);
          await expect(page.getByTestId("offer-editor-fitment")).toBeEnabled();
        } else {
          await fillFitment(page, f, `CI:SAME_PAGE:${first}`);
          await expect(page.getByTestId("offer-editor-commercial")).toBeDisabled();
          const screenshot = testInfo.outputPath(`offer-fitment-english-desktop-${first}.png`);
          await page.getByTestId("offer-fitment-mode").scrollIntoViewIfNeeded();
          await page.screenshot({ path: screenshot, fullPage: true });
          await testInfo.attach(`offer-fitment-english-desktop-${first}`, {
            path: screenshot,
            contentType: "image/png",
          });
          await page.getByTestId("offer-fitment-save").click();
          await expect
            .poll(() =>
              page.evaluate((key) => sessionStorage.getItem(key), OFFER_FITMENT_JOURNAL_KEY)
            )
            .toBeNull();
          await expect(page.getByTestId("offer-editor-commercial")).toBeEnabled();
        }
      }
      const saved = await snapshot(f, draft);
      expect(saved.revision.version).toBe(3);
      expect(saved.revision.status).toBe("DRAFT");
      expect(saved.revision.titleEn).toBe("Deliberately saved commercial scope");
      expect(saved.revision.fitmentEvidenceRef).toBe(`CI:SAME_PAGE:${first}`);
      expect(
        saved.revision.fitmentCoverage.map(({ makeId, modelId, yearFrom, yearTo }) => ({
          makeId,
          modelId,
          yearFrom,
          yearTo,
        }))
      ).toEqual([{ makeId: f.make.id, modelId: f.model.id, yearFrom: 2020, yearTo: 2024 }]);
      expect(saved.receipts).toBe(1);
      expect(saved.audits).toBe(1);
      expect(
        await f.prisma.securityAuditEvent.count({
          where: {
            eventType: "OFFER_DRAFT_UPDATED",
            targetEntity: `offer_revision:${draft.revisionId}`,
          },
        })
      ).toBe(1);
      await page.close();
    }
  } finally {
    await cleanup(contexts);
  }
});

test("a recovered fitment receipt remains historical after a separate authenticated commercial save advances the revision", async ({
  browser,
}) => {
  const f = await fixture();
  const contexts: BrowserContext[] = [];
  try {
    const { context, page } = await newSession(browser, f, contexts);
    const draft = await createDraft(context, f);
    await page.goto(draft.workspace);
    await fillFitment(page, f, "CI:HISTORICAL_RECEIPT");
    let commandId: string | undefined;
    await page.route(`**${draft.path}`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      commandId = (route.request().postDataJSON() as { commandId: string }).commandId;
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      await route.abort("failed");
    });
    await page.getByTestId("offer-fitment-save").click();
    await expect(page.getByTestId("offer-fitment-recheck")).toBeEnabled();
    await expect.poll(async () => (await snapshot(f, draft)).revision.version).toBe(2);
    await page.unroute(`**${draft.path}`);
    // A separate request authenticated by the real browser session advances
    // commercial content. This is NOT attributed to the lost fitment command.
    const commercial = await context.request.patch(draft.path.replace(/\/fitment$/, ""), {
      headers: { Origin: new URL(page.url()).origin },
      data: {
        expectedVersion: 2,
        fields: { ...draft.fields, titleEn: "Current separate commercial edit" },
      },
    });
    expect(commercial.status()).toBe(200);
    page.on("dialog", (dialog) => dialog.accept());
    await page.reload();
    await page.getByTestId("offer-fitment-recheck").click();
    await expect
      .poll(() => page.evaluate((key) => sessionStorage.getItem(key), OFFER_FITMENT_JOURNAL_KEY))
      .toBeNull();
    await expect(page.getByTestId("offer-fitment-receipt")).toContainText("2");
    await expect(page.getByTestId("offer-fitment-saved")).toContainText(
      en.offerFitment.savedVersion.replace("{version}", "3")
    );
    await expect(
      page.getByText("Current separate commercial edit", { exact: true }).first()
    ).toBeVisible();
    const current = await snapshot(f, draft);
    expect(current.revision.version).toBe(3);
    expect(current.revision.titleEn).toBe("Current separate commercial edit");
    expect(current.revision.fitmentEvidenceRef).toBe("CI:HISTORICAL_RECEIPT");
    expect(current.revision.status).toBe("DRAFT");
    expect(current.receipts).toBe(1);
    expect(current.audits).toBe(1);
    expect(await f.prisma.fitmentCommand.findUniqueOrThrow({ where: { commandId } })).toMatchObject(
      { resultVersion: 2, outcome: "APPLIED" }
    );
    expect(
      await f.prisma.securityAuditEvent.count({
        where: {
          eventType: "OFFER_DRAFT_UPDATED",
          targetEntity: `offer_revision:${draft.revisionId}`,
        },
      })
    ).toBe(1);
  } finally {
    await cleanup(contexts);
  }
});

test("lost fitment commit recovery selects its original approved revision rather than a newer unapproved successor", async ({
  browser,
}) => {
  const f = await fixture();
  const contexts: BrowserContext[] = [];
  try {
    const sales = await newSession(browser, f, contexts);
    const ops = await opsSession(browser, f, contexts);
    const draft = await createDraft(sales.context, f);
    await sales.page.goto(draft.workspace);
    await fillFitment(sales.page, f, "CI:ORIGINAL_REVISION_RECOVERY");
    await sales.page.route(`**${draft.path}`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      await route.abort("failed");
    });
    await sales.page.getByTestId("offer-fitment-save").click();
    await expect(sales.page.getByTestId("offer-fitment-recheck")).toBeEnabled();
    await expect.poll(async () => (await snapshot(f, draft)).revision.version).toBe(2);
    await sales.page.unroute(`**${draft.path}`);
    const journal = await sales.page.evaluate(
      (key) => sessionStorage.getItem(key),
      OFFER_FITMENT_JOURNAL_KEY
    );
    expect(journal).not.toBeNull();
    await submitAndApprove(sales.context, ops.context, draft, 2);
    const successorResponse = await sales.context.request.post(
      `/api/v1/staff/offers/${draft.offerId}/revisions`,
      {
        headers: { Origin: new URL(sales.page.url()).origin },
        data: { requestId: crypto.randomUUID() },
      }
    );
    expect(successorResponse.status()).toBe(201);
    const successor = (await successorResponse.json()) as { id: string };
    expect(successor.id).not.toBe(draft.revisionId);
    const publicationBefore = await f.prisma.offerPublication.findUnique({
      where: { offerId: draft.offerId },
    });
    expect(publicationBefore).toBeNull();
    sales.page.on("dialog", (dialog) => dialog.accept());
    await sales.page.reload();
    await expect(sales.page.locator("#offer-revision")).toHaveValue(draft.revisionId);
    await expect(sales.page.getByTestId("offer-fitment-recheck")).toBeEnabled();
    expect(
      await sales.page.evaluate((key) => sessionStorage.getItem(key), OFFER_FITMENT_JOURNAL_KEY)
    ).toBe(journal);
    await sales.page.getByTestId("offer-fitment-recheck").click();
    await expect
      .poll(() =>
        sales.page.evaluate((key) => sessionStorage.getItem(key), OFFER_FITMENT_JOURNAL_KEY)
      )
      .toBeNull();
    await expect(sales.page.getByTestId("offer-fitment-receipt")).toContainText(
      en.offerFitment.receipt.replace("{version}", "2")
    );
    await expect(sales.page.locator("#offer-revision")).toHaveValue(draft.revisionId);
    await expect(sales.page.getByTestId("offer-fitment-save")).toHaveCount(0);
    const original = await snapshot(f, draft);
    expect(original.revision.version).toBe(4);
    expect(original.revision.status).toBe("APPROVED");
    expect(original.revision.fitmentEvidenceRef).toBe("CI:ORIGINAL_REVISION_RECOVERY");
    expect(original.receipts).toBe(1);
    expect(original.audits).toBe(1);
    expect(await f.prisma.offer.findUniqueOrThrow({ where: { id: draft.offerId } })).toMatchObject({
      currentApprovedRevisionId: draft.revisionId,
    });
    expect(
      await f.prisma.offerRevision.findUniqueOrThrow({ where: { id: successor.id } })
    ).toMatchObject({
      status: "DRAFT",
      version: 1,
      submittedByUserId: null,
      decidedByUserId: null,
      fitmentAllVariantsAttested: false,
      fitmentScopePriceAttested: false,
    });
    expect(
      await f.prisma.offerPublication.findUnique({ where: { offerId: draft.offerId } })
    ).toEqual(publicationBefore);
  } finally {
    await cleanup(contexts);
  }
});

test("lost commercial edit remains reconcilable after approval while terminal mutation controls stay disabled", async ({
  browser,
}) => {
  const f = await fixture();
  const contexts: BrowserContext[] = [];
  try {
    const sales = await newSession(browser, f, contexts);
    const ops = await opsSession(browser, f, contexts);
    const draft = await createDraft(sales.context, f);
    await sales.page.goto(draft.workspace);
    await fillFitment(sales.page, f, "CI:TERMINAL_COMMERCIAL_RECOVERY");
    await sales.page.getByTestId("offer-fitment-save").click();
    await expect.poll(async () => (await snapshot(f, draft)).revision.version).toBe(2);
    await expect(sales.page.getByTestId("offer-editor-commercial")).toBeEnabled();
    await sales.page.getByTestId("offer-editor-commercial").click();
    await sales.page.locator("#offer-titleEn").fill("Committed commercial title before approval");
    await sales.page.locator("form").getByRole("button", { name: "Check answers" }).click();
    const commercialPath = draft.path.replace(/\/fitment$/, "");
    await sales.page.route(`**${commercialPath}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      await route.abort("failed");
    });
    await sales.page.getByRole("button", { name: "Save draft" }).click();
    await expect(
      sales.page.getByRole("button", { name: en.staffOffers.reconcile }).last()
    ).toBeEnabled();
    await expect.poll(async () => (await snapshot(f, draft)).revision.version).toBe(3);
    await sales.page.unroute(`**${commercialPath}`);
    const journalKey = "waffarhacars_offer_pending_v1";
    const journal = await sales.page.evaluate((key) => sessionStorage.getItem(key), journalKey);
    expect(journal).not.toBeNull();
    await submitAndApprove(sales.context, ops.context, draft, 3);
    sales.page.on("dialog", (dialog) => dialog.accept());
    await sales.page.reload();
    await expect(sales.page.locator("#offer-revision")).toHaveValue(draft.revisionId);
    await expect(sales.page.locator("#offer-titleEn")).toBeDisabled();
    const recheck = sales.page.getByTestId("offer-commercial-recheck");
    await expect(recheck).toBeEnabled();
    expect(await sales.page.evaluate((key) => sessionStorage.getItem(key), journalKey)).toBe(
      journal
    );
    await recheck.click();
    await expect
      .poll(() => sales.page.evaluate((key) => sessionStorage.getItem(key), journalKey))
      .toBeNull();
    await expect(
      sales.page.getByRole("alert").filter({ hasText: en.staffOffers.conflict }).first()
    ).toBeVisible();
    await expect(sales.page.getByTestId("offer-fitment-receipt")).toHaveCount(0);
    await expect(sales.page.getByTestId("offer-fitment-save")).toHaveCount(0);
    await expect(sales.page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(
      0
    );
    const current = await snapshot(f, draft);
    expect(current.revision.version).toBe(5);
    expect(current.revision.status).toBe("APPROVED");
    expect(current.revision.titleEn).toBe("Committed commercial title before approval");
    expect(current.revision.fitmentEvidenceRef).toBe("CI:TERMINAL_COMMERCIAL_RECOVERY");
    expect(current.receipts).toBe(1);
    expect(current.audits).toBe(1);
    expect(
      await f.prisma.securityAuditEvent.count({
        where: {
          eventType: "OFFER_DRAFT_UPDATED",
          targetEntity: `offer_revision:${draft.revisionId}`,
        },
      })
    ).toBe(1);
    expect(
      await f.prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_APPROVED", targetEntity: `offer_revision:${draft.revisionId}` },
      })
    ).toBe(1);
  } finally {
    await cleanup(contexts);
  }
});

test("six Operations review checks cannot be transferred to another genuinely authenticated reviewer account", async ({
  browser,
}) => {
  const f = await fixture();
  const contexts: BrowserContext[] = [];
  try {
    const sales = await newSession(browser, f, contexts);
    const ops = await opsSession(browser, f, contexts);
    const reviewerB = await f.staff("OPERATIONS", "OPS_SUPERVISOR", "B");
    const draft = await createDraft(sales.context, f);
    await sales.page.goto(draft.workspace);
    await fillFitment(sales.page, f, "CI:REVIEW_ACTOR_BINDING");
    await sales.page.getByTestId("offer-fitment-save").click();
    await expect.poll(async () => (await snapshot(f, draft)).revision.version).toBe(2);
    const submitted = await sales.context.request.post(
      draft.path.replace(/\/fitment$/, "/submit"),
      { headers: { Origin: new URL(sales.page.url()).origin }, data: { expectedVersion: 2 } }
    );
    expect(submitted.status()).toBe(200);
    await ops.page.goto(draft.workspace);
    for (const label of approvalLabels)
      await ops.page.getByRole("checkbox", { name: label, exact: true }).check();
    const approve = ops.page.getByRole("button", { name: "Approve internally", exact: true });
    await expect(approve).toBeEnabled();
    await ops.context.clearCookies();
    const accountTab = await ops.context.newPage();
    await login(accountTab, reviewerB.email);
    expect(await (await ops.context.request.get("/api/v1/staff/auth/status")).json()).toMatchObject(
      { state: "ACTIVE", userId: reviewerB.userId }
    );
    const approvalPath = `/api/v1/staff/ops/offers/${draft.offerId}/revisions/${draft.revisionId}/approve`;
    let approvalPosts = 0;
    ops.page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === approvalPath)
        approvalPosts += 1;
    });
    await approve.click();
    await expect(ops.page.getByTestId("offer-detail-refresh")).toBeEnabled();
    for (const label of approvalLabels)
      await expect(ops.page.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
    await expect(approve).toBeDisabled();
    expect(approvalPosts).toBe(0);
    const beforeNewReview = await snapshot(f, draft);
    expect(beforeNewReview.revision.status).toBe("PENDING_REVIEW");
    expect(beforeNewReview.revision.version).toBe(3);
    expect(beforeNewReview.revision.decidedByUserId).toBeNull();
    expect(
      await f.prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_APPROVED", targetEntity: `offer_revision:${draft.revisionId}` },
      })
    ).toBe(0);
    // The new actor must perform all six explicit checks on its own snapshot.
    for (const label of approvalLabels)
      await ops.page.getByRole("checkbox", { name: label, exact: true }).check();
    await expect(approve).toBeEnabled();
    const approved = ops.page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === approvalPath
    );
    await approve.click();
    expect((await approved).status()).toBe(200);
    expect(approvalPosts).toBe(1);
    const final = await snapshot(f, draft);
    expect(final.revision.status).toBe("APPROVED");
    expect(final.revision.version).toBe(4);
    expect(final.revision.decidedByUserId).toBe(reviewerB.userId);
    expect(final.revision.fitmentAllVariantsAttested).toBe(true);
    expect(final.revision.fitmentScopePriceAttested).toBe(true);
    expect(
      await f.prisma.securityAuditEvent.count({
        where: {
          eventType: "OFFER_APPROVED",
          targetEntity: `offer_revision:${draft.revisionId}`,
          actorUserId: reviewerB.userId,
        },
      })
    ).toBe(1);
  } finally {
    await cleanup(contexts);
  }
});

test("real PostgreSQL fitment audit failure and lock timeout roll back every write before identical same-key browser recovery", async ({
  browser,
}) => {
  const f = await fixture();
  const contexts: BrowserContext[] = [];
  const database = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  await database.connect();
  const triggerName = `e2e_fitment_audit_${f.uid}`;
  let triggerInstalled = false;
  let lockHeld = false;
  try {
    const { context } = await newSession(browser, f, contexts);
    for (const failure of ["audit", "lock"] as const) {
      const draft = await createDraft(context, f);
      const page = await context.newPage();
      await page.goto(draft.workspace);
      await fillFitment(page, f, `CI:ROLLBACK:${failure}`);
      if (failure === "audit") {
        // Restrict the disposable-database trigger to this synthetic revision;
        // no production hook or mocked audit implementation is introduced.
        await database.query(
          `CREATE FUNCTION "${triggerName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType" = 'OFFER_FITMENT_UPDATED' AND NEW."targetEntity" = 'offer_revision:${draft.revisionId}' THEN RAISE EXCEPTION 'synthetic audit refusal' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$`
        );
        triggerInstalled = true;
        await database.query(
          `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION "${triggerName}"()`
        );
      } else {
        await database.query("BEGIN");
        lockHeld = true;
        await database.query("SELECT id FROM provider_organizations WHERE id=$1 FOR UPDATE", [
          f.provider.id,
        ]);
      }
      const request = page.waitForRequest(
        (item) => item.method() === "PUT" && new URL(item.url()).pathname === draft.path
      );
      const response = page.waitForResponse(
        (item) => item.request().method() === "PUT" && new URL(item.url()).pathname === draft.path
      );
      await page.getByTestId("offer-fitment-save").click();
      const body = (await request).postData();
      if (failure === "lock") {
        const observer = new pg.Client({ connectionString: databaseUrl });
        await observer.connect();
        try {
          const pid = (await database.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
            .rows[0].pid;
          await expect
            .poll(
              async () =>
                (
                  await observer.query<{ count: number }>(
                    "SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))",
                    [pid]
                  )
                ).rows[0].count
            )
            .toBeGreaterThanOrEqual(1);
        } finally {
          await observer.end();
        }
      }
      expect((await response).status()).toBe(503);
      await expect(page.getByTestId("offer-fitment-recheck")).toBeEnabled();
      const after = await snapshot(f, draft);
      expect(after.revision.version).toBe(1);
      expect(after.revision.fitmentMode).toBeNull();
      expect(after.revision.fitmentEvidenceRef).toBeNull();
      expect(after.revision.fitmentCoverage).toHaveLength(0);
      expect(after.receipts).toBe(0);
      expect(after.audits).toBe(0);
      if (lockHeld) {
        await database.query("ROLLBACK");
        lockHeld = false;
      }
      if (triggerInstalled) {
        await database.query(`DROP TRIGGER "${triggerName}" ON security_audit_events`);
        await database.query(`DROP FUNCTION "${triggerName}"()`);
        triggerInstalled = false;
      }
      await page.getByTestId("offer-fitment-recheck").click();
      const retry = page.waitForRequest(
        (item) => item.method() === "PUT" && new URL(item.url()).pathname === draft.path
      );
      await page.getByTestId("offer-fitment-retry").click();
      expect((await retry).postData()).toBe(body);
      await expect
        .poll(() => page.evaluate((key) => sessionStorage.getItem(key), OFFER_FITMENT_JOURNAL_KEY))
        .toBeNull();
      const recovered = await snapshot(f, draft);
      expect(recovered.revision.version).toBe(2);
      expect(recovered.revision.fitmentEvidenceRef).toBe(`CI:ROLLBACK:${failure}`);
      expect(recovered.revision.fitmentCoverage).toHaveLength(1);
      expect(recovered.receipts).toBe(1);
      expect(recovered.audits).toBe(1);
      await page.close();
    }
  } finally {
    if (lockHeld) await database.query("ROLLBACK");
    if (triggerInstalled) {
      await database.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON security_audit_events`);
      await database.query(`DROP FUNCTION IF EXISTS "${triggerName}"()`);
    }
    await database.end();
    await cleanup(contexts);
  }
});
