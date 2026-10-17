import { expect, test, type BrowserContext, type Page, type Response } from "@playwright/test";
import crypto from "node:crypto";
import pg from "pg";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricEncrypt } from "better-auth/crypto";
import { getPrisma, disconnectDb } from "@/lib/db";
import { provisionStaffMember } from "@/lib/staff/provisioning";
import ar from "@/i18n/ar.json";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";
const password = "ValidStaffPassword123!";
const totpSecret = "JBSWY3DPEHPK3PXP";
const journalKey = "waffarhacars_capability_pending_v1";

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function blockedBy(client: pg.Client, expected: number) {
  const pid = Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  const observer = new pg.Client({ connectionString: databaseUrl });
  await observer.connect();
  try {
    await expect
      .poll(
        async () => {
          const result = await observer.query<{ count: number }>(
            `WITH RECURSIVE blocked(pid) AS (
            SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))
            UNION
            SELECT activity.pid FROM pg_stat_activity activity
            JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
          ) SELECT count(*)::int AS count FROM blocked`,
            [pid]
          );
          return result.rows[0].count;
        },
        { timeout: 2500, intervals: [10, 20, 30] }
      )
      .toBeGreaterThanOrEqual(expected);
  } finally {
    await observer.end();
  }
}

type CommandResult = { command: { commandId: string; policyId: string; resultVersion: number } };

test("real capability controls: bilingual lifecycle, exact-command recovery, stale edits and database rollback", async ({
  browser,
}, testInfo) => {
  test.setTimeout(360_000);
  const prisma = getPrisma();
  const uid = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const contexts: BrowserContext[] = [];
  const releaseBarriers: Array<() => void> = [];
  const temporarySql: Array<{ trigger: string; fn: string }> = [];
  async function staff(department: "SALES" | "OPERATIONS", role: "SALES_AGENT" | "OPS_SUPERVISOR") {
    if ((await prisma.internalStaffMembership.count()) === 0) {
      await provisionStaffMember({
        email: `cap-bootstrap-${uid}@test.eg`,
        password,
        fullName: "Capability Bootstrap",
        employeeNumber: `CB-${uid}`,
        department: "ADMIN",
        isBootstrap: true,
      });
    }
    const email = `cap-${department.toLowerCase()}-${uid}@test.eg`;
    const member = await provisionStaffMember({
      email,
      password,
      fullName: `Capability ${department}`,
      employeeNumber: `C-${department}-${uid}`,
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
          data: totpSecret,
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
  async function responseCommand(response: Response, status = 200) {
    expect(response.status()).toBe(status);
    return (await response.json()) as CommandResult;
  }
  try {
    const sales = await staff("SALES", "SALES_AGENT");
    const ops = await staff("OPERATIONS", "OPS_SUPERVISOR");
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: `Capability Test ${uid}`,
        nameAr: `مركز تجريبي ${uid}`,
        legalName: `Capability ${uid}`,
        taxRegistrationNumber: `${Math.floor(100000000 + Math.random() * 900000000)}`,
        commercialRegistrationNumber: `CAP-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        status: "ACTIVE",
        version: 1,
        contactPersonName: "Synthetic Contact",
        contactEmail: `cap-provider-${uid}@test.eg`,
        contactPhone: "+201011112222",
        createdByUserId: sales.userId,
        activatedByUserId: ops.userId,
        activatedAt: new Date(),
      },
    });
    const branch = await prisma.providerBranch.create({
      data: {
        providerOrganizationId: provider.id,
        branchCode: `CAP-${uid}`,
        nameEn: `Capability Branch ${uid}`,
        nameAr: `فرع تجريبي ${uid}`,
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
        evidenceDocumentRef: `CI:CAP:BRANCH:${uid}`,
        vettedByUserId: ops.userId,
        vettedAt: new Date(),
      },
    });
    const category = await prisma.serviceCategory.findUniqueOrThrow({
      where: { code: "EXPRESS_MAINTENANCE" },
    });
    // Synthetic catalogue records only; no capability policy or command is seeded.
    const make = await prisma.vehicleMake.create({
      data: {
        code: `ZZ_CAP_E2E_${uid}`,
        nameEn: `Capability Make ${uid}`,
        nameAr: "ماركة تجريبية",
        evidenceRef: "CI:CAP:MAKE",
      },
    });
    const model = await prisma.vehicleModel.create({
      data: {
        makeId: make.id,
        code: `ZZ_CAP_MODEL_${uid}`,
        nameEn: "All variants test model",
        nameAr: "طراز تجريبي",
        evidenceRef: "CI:CAP:MODEL",
      },
    });
    await prisma.vehicleMake.createMany({
      data: Array.from({ length: 31 }, (_, index) => ({
        code: `AA_CAP_${uid}_${String(index).padStart(2, "0")}`,
        nameEn: `Synthetic cursor make ${index}`,
        nameAr: `ماركة اختبار ${index}`,
        evidenceRef: "CI:CAP:CURSOR",
      })),
    });
    await prisma.vehicleModel.createMany({
      data: Array.from({ length: 31 }, (_, index) => ({
        makeId: make.id,
        code: `AA_CAP_MODEL_${uid}_${String(index).padStart(2, "0")}`,
        nameEn: `Synthetic cursor model ${index}`,
        nameAr: `طراز اختبار ${index}`,
        evidenceRef: "CI:CAP:CURSOR",
      })),
    });
    const workspace = `/staff/providers/${provider.id}/branches/${branch.id}/capabilities`;
    const api = `/api/v1/staff/branches/${branch.id}/fitment-policies`;
    const salesContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.91" },
    });
    const opsContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: { "x-forwarded-for": "198.51.100.92" },
    });
    contexts.push(salesContext, opsContext);
    for (const context of contexts)
      context.on("page", (page) => {
        page.on("dialog", async (dialog) => {
          if (dialog.type() === "beforeunload") await dialog.accept();
          else await dialog.dismiss();
        });
      });
    const salesPage = await salesContext.newPage();
    const opsPage = await opsContext.newPage();
    let firstCatalogRead = true;
    await salesPage.route("**/api/v1/vehicles/catalog?**", async (route) => {
      if (firstCatalogRead) {
        firstCatalogRead = false;
        await route.abort("failed");
      } else await route.continue();
    });
    let continuedCatalogRequests = 0;
    salesPage.on("request", (request) => {
      if (
        request.url().includes("/api/v1/vehicles/catalog") &&
        new URL(request.url()).searchParams.has("cursor")
      )
        continuedCatalogRequests++;
    });
    await login(salesPage, sales.email);
    await login(opsPage, ops.email);
    await salesPage.goto(`/staff/providers/${provider.id}`);
    await salesPage.getByRole("link", { name: "Vehicle capability", exact: true }).click();
    await expect(salesPage).toHaveURL(new RegExp(`${branch.id}/capabilities$`));
    await opsPage.goto(workspace);

    async function fill(page: Page, evidence: string, yearTo = 2024) {
      await page.locator("#capability-evidence").fill(evidence);
      const makeSelect = page.locator("#fitment-make-0");
      // The editor must follow every real cursor before claiming a catalogue choice is absent.
      while (!(await makeSelect.locator(`option[value="${make.id}"]`).count())) {
        const more = page.getByTestId("fitment-more-makes");
        await expect(more).toBeVisible();
        const catalogResponse = page.waitForResponse(
          (r) => r.url().includes("/api/v1/vehicles/catalog") && r.request().method() === "GET"
        );
        await more.click();
        expect((await catalogResponse).ok()).toBe(true);
      }
      await makeSelect.selectOption(make.id);
      await expect(page.locator("#fitment-model-0")).toBeEnabled();
      while (!(await page.locator(`#fitment-model-0 option[value="${model.id}"]`).count())) {
        const more = page.getByTestId("fitment-more-models-0");
        await expect(more).toBeVisible();
        const catalogResponse = page.waitForResponse(
          (r) => r.url().includes("/api/v1/vehicles/catalog") && r.request().method() === "GET"
        );
        await more.click();
        expect((await catalogResponse).ok()).toBe(true);
      }
      await page.locator("#fitment-model-0").selectOption(model.id);
      await page.locator("#fitment-yearFrom-0").fill("2020");
      await page.locator("#fitment-yearTo-0").fill(String(yearTo));
    }
    async function choose(page: Page, policyId: string) {
      await page.getByTestId("capability-refresh").click();
      await expect(page.locator(`#capability-policy option[value="${policyId}"]`)).toHaveCount(1);
      await page.locator("#capability-policy").selectOption(policyId);
    }
    async function command(page: Page, control: string, actionPath: string, status = 200) {
      const response = page.waitForResponse(
        (r) => r.url().endsWith(api + actionPath) && r.request().method() !== "GET"
      );
      await page.getByTestId(control).click();
      return responseCommand(await response, status);
    }
    let firstCreate = true;
    async function create(page: Page, evidence: string) {
      await page.getByTestId("capability-new").click();
      await page.locator("#capability-category").selectOption(category.id);
      if (firstCreate) await expect(page.locator('main [role="alert"]').first()).toBeVisible();
      await fill(page, evidence);
      if (firstCreate) {
        firstCreate = false;
        await page.locator("#fitment-yearTo-0").fill("2019");
        await page.getByTestId("capability-create").click();
        await expect(page.locator('main [role="alert"]').first()).toBeVisible();
        expect(await prisma.branchCapabilityVersion.count({ where: { branchId: branch.id } })).toBe(
          0
        );
        await page.locator("#fitment-yearTo-0").fill("2024");
        await page.getByTestId("fitment-add-range").click();
        await page.locator("#fitment-make-1").selectOption(make.id);
        while (!(await page.locator(`#fitment-model-1 option[value="${model.id}"]`).count())) {
          const more = page.getByTestId("fitment-more-models-1");
          await expect(more).toBeVisible();
          const next = page.waitForResponse(
            (r) => r.url().includes("/api/v1/vehicles/catalog") && r.request().method() === "GET"
          );
          await more.click();
          expect((await next).ok()).toBe(true);
        }
        await page.locator("#fitment-model-1").selectOption(model.id);
        await page.locator("#fitment-yearFrom-1").fill("2022");
        await page.locator("#fitment-yearTo-1").fill("2024");
        await page.getByTestId("capability-create").click();
        await expect(page.locator('main [role="alert"]').first()).toBeVisible();
        expect(await prisma.branchCapabilityVersion.count({ where: { branchId: branch.id } })).toBe(
          0
        );
        await page.getByTestId("fitment-remove-range-1").click();
        await page.locator("#capability-evidence").focus();
        await expect(page.locator("#capability-evidence")).toBeFocused();
        expect(
          await page
            .locator("#fitment-make-0")
            .evaluate((select) => (select as HTMLSelectElement).labels?.length)
        ).toBe(1);
        // Native Back is a same-document traversal, not an anchor click. Dirty
        // work must survive it, while a deliberate discard restores clean Back.
        const routerStateKeys = await page.evaluate(() => Object.keys(window.history.state).sort());
        await page.evaluate(() => window.history.back());
        await expect(page.locator('main [role="alert"]').first()).toHaveText(
          "You have unsaved changes. Discard them to leave this version?"
        );
        await expect(page).toHaveURL(new RegExp(`${branch.id}/capabilities$`));
        await expect(page.locator("#capability-evidence")).toHaveValue(evidence);
        expect(await page.evaluate(() => Object.keys(window.history.state).sort())).toEqual(
          routerStateKeys
        );
        await page.getByTestId("capability-discard").click();
        await page.evaluate(() => window.history.back());
        await expect(page).toHaveURL(new RegExp(`/staff/providers/${provider.id}$`));
        await page.getByRole("link", { name: "Vehicle capability", exact: true }).click();
        await page.locator("#capability-category").selectOption(category.id);
        await fill(page, evidence);
      }
      return (await command(page, "capability-create", "", 201)).command.policyId;
    }
    async function submit(page: Page, id: string) {
      return command(page, "capability-submit", `/${id}/submit`);
    }
    async function decide(page: Page, id: string, action: "approve" | "reject" | "withdraw") {
      if (action === "approve") {
        await expect(page.getByTestId("capability-approve")).toBeDisabled();
        await page.getByRole("checkbox").check();
      }
      if (action === "reject")
        await page.locator("#capability-reason").fill("Synthetic evidence needs a revised scope");
      await page.getByTestId(`capability-${action}`).click();
      return command(page, "capability-confirm", `/${id}/${action}`);
    }
    async function policy(id: string) {
      return prisma.branchCapabilityVersion.findUniqueOrThrow({
        where: { id },
        include: { coverage: true },
      });
    }
    async function receiptCount(id: string, action: string) {
      return prisma.fitmentCommand.count({
        where: { domain: "CAPABILITY", resourceId: id, action },
      });
    }
    async function auditCount(
      id: string,
      eventType:
        | "BRANCH_CAPABILITY_DRAFT_CREATED"
        | "BRANCH_CAPABILITY_DRAFT_UPDATED"
        | "BRANCH_CAPABILITY_SUBMITTED"
        | "BRANCH_CAPABILITY_APPROVED"
        | "BRANCH_CAPABILITY_REJECTED"
        | "BRANCH_CAPABILITY_WITHDRAWN"
    ) {
      return prisma.securityAuditEvent.count({
        where: { targetEntity: `branch_capability:${id}`, eventType },
      });
    }
    async function current() {
      return prisma.branchCapabilityCurrent.findUniqueOrThrow({
        where: { branchId_categoryId: { branchId: branch.id, categoryId: category.id } },
      });
    }

    // First policy is created, edited, submitted and approved entirely through real controls.
    const first = await create(salesPage, "CI:CAP:INITIAL");
    expect(continuedCatalogRequests).toBeGreaterThanOrEqual(2);
    expect((await policy(first)).version).toBe(1);
    await salesPage.locator("#capability-evidence").fill("CI:CAP:EDITED");
    await command(salesPage, "capability-save", `/${first}`);
    expect((await policy(first)).version).toBe(2);
    await submit(salesPage, first);
    expect((await policy(first)).status).toBe("PENDING_REVIEW");
    await choose(opsPage, first);
    await expect(opsPage.getByText("CI:CAP:EDITED", { exact: true })).toBeVisible();
    await decide(opsPage, first, "approve");
    expect(await policy(first)).toMatchObject({
      status: "ACTIVE",
      version: 4,
      attested: true,
      createdByUserId: sales.userId,
      decidedByUserId: ops.userId,
    });
    expect((await current()).activeVersionId).toBe(first);
    for (const action of ["CREATE", "EDIT", "SUBMIT", "APPROVE"])
      expect(await receiptCount(first, action)).toBe(1);
    expect(await auditCount(first, "BRANCH_CAPABILITY_APPROVED")).toBe(1);
    expect((await policy(first)).coverage).toMatchObject([
      { makeId: make.id, modelId: model.id, yearFrom: 2020, yearTo: 2024 },
    ]);
    await salesPage.screenshot({
      path: testInfo.outputPath("capability-sales-en-mobile.png"),
      fullPage: true,
    });
    await opsPage.screenshot({
      path: testInfo.outputPath("capability-ops-en-desktop.png"),
      fullPage: true,
    });

    // Rejection is terminal; correction explicitly creates a distinct draft.
    const rejected = await create(salesPage, "CI:CAP:REJECT");
    await submit(salesPage, rejected);
    await choose(opsPage, rejected);
    await opsPage.getByRole("checkbox").check();
    await prisma.providerBranch.update({ where: { id: branch.id }, data: { status: "PAUSED" } });
    await opsPage.getByTestId("capability-refresh").click();
    await expect(opsPage.getByTestId("capability-approve")).toHaveCount(0);
    await prisma.providerBranch.update({ where: { id: branch.id }, data: { status: "ACTIVE" } });
    await opsPage.getByTestId("capability-refresh").click();
    await expect(opsPage.getByRole("checkbox")).toBeVisible();
    await expect(opsPage.getByRole("checkbox")).not.toBeChecked();
    await expect(opsPage.getByTestId("capability-approve")).toBeDisabled();
    await decide(opsPage, rejected, "reject");
    expect(await policy(rejected)).toMatchObject({
      status: "REJECTED",
      version: 3,
      rejectionReason: "Synthetic evidence needs a revised scope",
    });
    expect(await auditCount(rejected, "BRANCH_CAPABILITY_REJECTED")).toBe(1);
    await choose(salesPage, rejected);
    await expect(salesPage.getByTestId("capability-submit")).toHaveCount(0);
    const replacement = await create(salesPage, "CI:CAP:REPLACEMENT");
    expect(replacement).not.toBe(rejected);
    await submit(salesPage, replacement);
    await choose(opsPage, replacement);
    await opsPage.getByRole("checkbox").check();
    await opsPage.getByTestId("capability-approve").click();
    const winningOps = await opsContext.newPage();
    await winningOps.goto(workspace);
    await choose(winningOps, replacement);
    await decide(winningOps, replacement, "approve");
    // The first modal remains bound to version two. The actual winning request
    // completes before its stale confirmation is delivered, proving the order.
    const staleDecision = opsPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`${api}/${replacement}/approve`)
    );
    await opsPage.getByTestId("capability-confirm").click();
    expect((await staleDecision).status()).toBe(409);
    await expect(opsPage.locator('main [role="alert"]').first()).toBeVisible();
    await opsPage.getByTestId("capability-refresh").click();
    await expect(opsPage.getByTestId("capability-approve")).toHaveCount(0);
    await expect(opsPage.getByTestId("capability-confirm")).toHaveCount(0);
    await winningOps.close();
    expect(await policy(first)).toMatchObject({ status: "WITHDRAWN", version: 5 });
    expect(await policy(replacement)).toMatchObject({ status: "ACTIVE", version: 3 });
    expect(await current()).toMatchObject({ activeVersionId: replacement, version: 2 });
    expect(await auditCount(first, "BRANCH_CAPABILITY_WITHDRAWN")).toBe(1);
    expect(await receiptCount(replacement, "APPROVE")).toBe(1);
    expect(await auditCount(replacement, "BRANCH_CAPABILITY_APPROVED")).toBe(1);

    // Withdrawal remains reachable for a paused dependency and preserves historical approval.
    await prisma.providerBranch.update({ where: { id: branch.id }, data: { status: "PAUSED" } });
    await opsPage.getByTestId("capability-refresh").click();
    await decide(opsPage, replacement, "withdraw");
    expect(await policy(replacement)).toMatchObject({ status: "WITHDRAWN", version: 4 });
    expect(await current()).toMatchObject({ activeVersionId: null, version: 3 });
    expect(await auditCount(replacement, "BRANCH_CAPABILITY_WITHDRAWN")).toBe(1);
    await prisma.providerBranch.update({ where: { id: branch.id }, data: { status: "ACTIVE" } });

    // A delivered CREATE commits; transport discards its actual response. Reload resolves the receipt.
    await salesPage.getByTestId("capability-new").click();
    await salesPage.locator("#capability-category").selectOption(category.id);
    await fill(salesPage, "CI:CAP:LOST_CREATE");
    let deliveredBody: Record<string, unknown> | undefined;
    const delivered = deferred();
    await salesPage.route(`**${api}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      deliveredBody = route.request().postDataJSON() as Record<string, unknown>;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      delivered.resolve();
      await route.abort("failed");
    });
    await salesPage.getByTestId("capability-create").click();
    await delivered.promise;
    await expect(salesPage.getByTestId("capability-unknown")).toBeVisible();
    const deliveredCommand = await prisma.fitmentCommand.findUniqueOrThrow({
      where: { commandId: String(deliveredBody!.commandId) },
    });
    const journal = await salesPage.evaluate((key) => sessionStorage.getItem(key), journalKey);
    expect(journal).not.toContain("LOST_CREATE");
    expect(journal).not.toContain("evidenceRef");
    await salesPage.evaluate(() => window.history.back());
    await expect(salesPage.locator('main [role="alert"]').first()).toContainText(
      "Resolve the pending command"
    );
    await expect(salesPage).toHaveURL(new RegExp(`${branch.id}/capabilities$`));
    expect(await salesPage.evaluate((key) => sessionStorage.getItem(key), journalKey)).toBe(
      journal
    );
    await expect(salesPage.getByTestId("capability-discard")).toHaveCount(0);
    await salesPage.unroute(`**${api}`);
    await salesPage.reload();
    await salesPage.getByTestId("capability-recheck").click();
    await expect(salesPage.getByTestId("capability-unknown")).toHaveCount(0);
    expect(await receiptCount(deliveredCommand.resourceId, "CREATE")).toBe(1);
    expect(await auditCount(deliveredCommand.resourceId, "BRANCH_CAPABILITY_DRAFT_CREATED")).toBe(
      1
    );

    // An EDIT never reaches the server. Reload requires deliberate exact-content reconstruction.
    await choose(salesPage, deliveredCommand.resourceId);
    await salesPage.locator("#capability-evidence").fill("CI:CAP:UNDELIVERED_EDIT");
    let originalEdit: Record<string, unknown> | undefined;
    await salesPage.route(`**${api}/${deliveredCommand.resourceId}`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      originalEdit = route.request().postDataJSON() as Record<string, unknown>;
      await route.abort("failed");
    });
    await salesPage.getByTestId("capability-save").click();
    await expect(salesPage.getByTestId("capability-unknown")).toBeVisible();
    await expect(salesPage.getByTestId("capability-recheck")).toBeEnabled();
    expect(
      await prisma.fitmentCommand.count({ where: { commandId: String(originalEdit!.commandId) } })
    ).toBe(0);
    await salesPage.unroute(`**${api}/${deliveredCommand.resourceId}`);
    await salesPage.reload();
    await salesPage.getByTestId("capability-recheck").click();
    await salesPage.getByTestId("capability-restore").click();
    await fill(salesPage, "CI:CAP:MISMATCH");
    let mismatchedRequests = 0;
    const countMismatch = (request: import("@playwright/test").Request) => {
      if (
        request.method() === "PUT" &&
        request.url().endsWith(`${api}/${deliveredCommand.resourceId}`)
      )
        mismatchedRequests++;
    };
    salesPage.on("request", countMismatch);
    await salesPage.getByTestId("capability-retry").click();
    await expect(salesPage.locator('main [role="alert"]').first()).toBeVisible();
    expect(mismatchedRequests).toBe(0);
    salesPage.off("request", countMismatch);
    await salesPage.locator("#capability-evidence").fill("CI:CAP:UNDELIVERED_EDIT");
    const retryRequest = salesPage.waitForRequest(
      (r) => r.method() === "PUT" && r.url().endsWith(`${api}/${deliveredCommand.resourceId}`)
    );
    await command(salesPage, "capability-retry", `/${deliveredCommand.resourceId}`);
    expect((await retryRequest).postDataJSON()).toEqual(originalEdit);
    expect(await policy(deliveredCommand.resourceId)).toMatchObject({
      version: 2,
      evidenceRef: "CI:CAP:UNDELIVERED_EDIT",
    });
    expect(await receiptCount(deliveredCommand.resourceId, "EDIT")).toBe(1);
    expect(await auditCount(deliveredCommand.resourceId, "BRANCH_CAPABILITY_DRAFT_UPDATED")).toBe(
      1
    );

    // Two tabs deliberately queue old-version writes behind the provider lock.
    const otherSales = await salesContext.newPage();
    await otherSales.goto(workspace);
    await choose(otherSales, deliveredCommand.resourceId);
    await salesPage.locator("#capability-evidence").fill("CI:CAP:FIRST_WINNER");
    await salesPage.locator("#capability-policy").selectOption(first);
    await expect(salesPage.locator("#capability-policy")).toHaveValue(deliveredCommand.resourceId);
    await expect(salesPage.locator("#capability-evidence")).toHaveValue("CI:CAP:FIRST_WINNER");
    await expect(salesPage.getByTestId("capability-discard")).toBeVisible();
    await otherSales.locator("#capability-evidence").fill("CI:CAP:STALE_LOSER");
    const blocker = new pg.Client({ connectionString: databaseUrl });
    await blocker.connect();
    let firstResponse: Promise<Response>;
    let secondResponse: Promise<Response>;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM provider_organizations WHERE id = $1::uuid FOR UPDATE", [
        provider.id,
      ]);
      firstResponse = salesPage.waitForResponse(
        (r) =>
          r.request().method() === "PUT" &&
          r.url().endsWith(`${api}/${deliveredCommand.resourceId}`)
      );
      await salesPage.getByTestId("capability-save").click();
      await blockedBy(blocker, 1);
      secondResponse = otherSales.waitForResponse(
        (r) =>
          r.request().method() === "PUT" &&
          r.url().endsWith(`${api}/${deliveredCommand.resourceId}`)
      );
      await otherSales.getByTestId("capability-save").click();
      await blockedBy(blocker, 2);
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
    }
    expect((await firstResponse!).status()).toBe(200);
    expect((await secondResponse!).status()).toBe(409);
    expect(await policy(deliveredCommand.resourceId)).toMatchObject({
      version: 3,
      evidenceRef: "CI:CAP:FIRST_WINNER",
    });
    expect(await receiptCount(deliveredCommand.resourceId, "EDIT")).toBe(2);
    await expect(otherSales.locator('main [role="alert"]').first()).toBeVisible();
    await otherSales.close();

    // Actual audit insertion failure rolls the draft creation back. Same-key recovery succeeds.
    await salesPage.getByTestId("capability-new").click();
    await salesPage.locator("#capability-category").selectOption(category.id);
    await fill(salesPage, "CI:CAP:AUDIT_RETRY");
    const sql = new pg.Client({ connectionString: databaseUrl });
    const suffix = crypto.randomBytes(6).toString("hex");
    const trigger = `cap_ui_audit_${suffix}`;
    const fn = `cap_ui_audit_fn_${suffix}`;
    await sql.connect();
    temporarySql.push({ trigger, fn });
    const before = await prisma.branchCapabilityVersion.count({ where: { branchId: branch.id } });
    let failureBody: Record<string, unknown>;
    try {
      await sql.query(
        `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType" = 'BRANCH_CAPABILITY_DRAFT_CREATED' AND NEW."actorUserId" = '${sales.userId}'::uuid THEN RAISE EXCEPTION 'synthetic audit rejection' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$`
      );
      await sql.query(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION ${fn}()`
      );
      const failedRequest = salesPage.waitForRequest(
        (r) => r.method() === "POST" && r.url().endsWith(api)
      );
      const failedResponse = salesPage.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().endsWith(api)
      );
      await salesPage.getByTestId("capability-create").click();
      failureBody = (await failedRequest).postDataJSON() as Record<string, unknown>;
      expect((await failedResponse).status()).toBe(503);
      await expect(salesPage.getByTestId("capability-unknown")).toBeVisible();
      expect(await prisma.branchCapabilityVersion.count({ where: { branchId: branch.id } })).toBe(
        before
      );
      expect(
        await prisma.fitmentCommand.count({ where: { commandId: String(failureBody.commandId) } })
      ).toBe(0);
      expect(
        await prisma.securityAuditEvent.count({
          where: {
            actorUserId: sales.userId,
            metadata: { path: ["commandId"], equals: String(failureBody.commandId) },
          },
        })
      ).toBe(0);
    } finally {
      await sql.query(`DROP TRIGGER IF EXISTS ${trigger} ON security_audit_events`);
      await sql.query(`DROP FUNCTION IF EXISTS ${fn}()`);
      await sql.end();
      temporarySql.pop();
    }
    await salesPage.getByTestId("capability-recheck").click();
    const recovered = await command(salesPage, "capability-retry", "", 201);
    expect(recovered.command.commandId).toBe(String(failureBody!.commandId));
    expect(await prisma.branchCapabilityVersion.count({ where: { branchId: branch.id } })).toBe(
      before + 1
    );
    expect(await auditCount(recovered.command.policyId, "BRANCH_CAPABILITY_DRAFT_CREATED")).toBe(1);

    // Bounded provider-lock timeout is a real server failure, not an intercepted error response.
    await salesPage.locator("#capability-evidence").fill("CI:CAP:LOCK_RETRY");
    const lock = new pg.Client({ connectionString: databaseUrl });
    await lock.connect();
    let lockedBody: Record<string, unknown>;
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM provider_organizations WHERE id = $1::uuid FOR UPDATE", [
        provider.id,
      ]);
      const lockedRequest = salesPage.waitForRequest(
        (r) => r.method() === "PUT" && r.url().endsWith(`${api}/${recovered.command.policyId}`)
      );
      const lockedResponse = salesPage.waitForResponse(
        (r) =>
          r.request().method() === "PUT" && r.url().endsWith(`${api}/${recovered.command.policyId}`)
      );
      await salesPage.getByTestId("capability-save").click();
      lockedBody = (await lockedRequest).postDataJSON() as Record<string, unknown>;
      await blockedBy(lock, 1);
      expect((await lockedResponse).status()).toBe(503);
      expect(await policy(recovered.command.policyId)).toMatchObject({
        status: "DRAFT",
        version: 1,
        evidenceRef: "CI:CAP:AUDIT_RETRY",
      });
      expect(
        await prisma.fitmentCommand.count({ where: { commandId: String(lockedBody.commandId) } })
      ).toBe(0);
      expect(await auditCount(recovered.command.policyId, "BRANCH_CAPABILITY_DRAFT_UPDATED")).toBe(
        0
      );
    } finally {
      await lock.query("ROLLBACK");
      await lock.end();
    }
    await salesPage.getByTestId("capability-recheck").click();
    const lockRetryRequest = salesPage.waitForRequest(
      (r) => r.method() === "PUT" && r.url().endsWith(`${api}/${recovered.command.policyId}`)
    );
    await command(salesPage, "capability-retry", `/${recovered.command.policyId}`);
    expect((await lockRetryRequest).postDataJSON()).toEqual(lockedBody!);
    expect(await policy(recovered.command.policyId)).toMatchObject({
      version: 2,
      evidenceRef: "CI:CAP:LOCK_RETRY",
    });

    // Approval commits with a lost response. A second Ops tab withdraws it before
    // the first tab reconciles; the old receipt cannot resurrect current state.
    await submit(salesPage, recovered.command.policyId);
    await choose(opsPage, recovered.command.policyId);
    let lostApproval: Record<string, unknown> | undefined;
    const approvalDelivered = deferred();
    await opsPage.route(`**${api}/${recovered.command.policyId}/approve`, async (route) => {
      lostApproval = route.request().postDataJSON() as Record<string, unknown>;
      expect((await route.fetch()).status()).toBe(200);
      approvalDelivered.resolve();
      await route.abort("failed");
    });
    await opsPage.getByRole("checkbox").check();
    await opsPage.getByTestId("capability-approve").click();
    await opsPage.getByTestId("capability-confirm").click();
    await approvalDelivered.promise;
    await expect(opsPage.getByTestId("capability-unknown")).toBeVisible();
    const otherOps = await opsContext.newPage();
    await otherOps.goto(workspace);
    await choose(otherOps, recovered.command.policyId);
    await decide(otherOps, recovered.command.policyId, "withdraw");
    await opsPage.unroute(`**${api}/${recovered.command.policyId}/approve`);
    await opsPage.reload();
    await opsPage.getByTestId("capability-recheck").click();
    await expect(opsPage.getByTestId("capability-unknown")).toHaveCount(0);
    await expect(opsPage.getByTestId("capability-withdraw")).toHaveCount(0);
    expect(await policy(recovered.command.policyId)).toMatchObject({
      status: "WITHDRAWN",
      version: 5,
    });
    expect((await current()).activeVersionId).toBeNull();
    expect(
      await prisma.fitmentCommand.count({ where: { commandId: String(lostApproval!.commandId) } })
    ).toBe(1);
    expect(await auditCount(recovered.command.policyId, "BRANCH_CAPABILITY_APPROVED")).toBe(1);
    expect(await auditCount(recovered.command.policyId, "BRANCH_CAPABILITY_WITHDRAWN")).toBe(1);
    await otherOps.close();

    // A foreign actor cannot consume/clear another actor's journal or hydrate its evidence.
    const foreignJournalPage = await opsContext.newPage();
    await foreignJournalPage.goto(workspace);
    await foreignJournalPage.evaluate(({ key, value }) => sessionStorage.setItem(key, value), {
      key: journalKey,
      value: journal!,
    });
    await foreignJournalPage.reload();
    await expect(foreignJournalPage.locator('main [role="alert"]').first()).toBeVisible();
    expect(
      await foreignJournalPage.evaluate((key) => sessionStorage.getItem(key), journalKey)
    ).toBe(journal);
    expect(journal).not.toContain("evidenceRef");
    expect(await receiptCount(deliveredCommand.resourceId, "CREATE")).toBe(1);
    await foreignJournalPage.close();

    // A hung client transport reaches the bounded deadline without domain delivery.
    // Receipt absence permits only the original in-memory body/key to be retried.
    await salesPage.getByTestId("capability-new").click();
    await salesPage.locator("#capability-category").selectOption(category.id);
    await fill(salesPage, "CI:CAP:HUNG");
    const releaseHung = deferred();
    releaseBarriers.push(releaseHung.resolve);
    let hungBody: Record<string, unknown> | undefined;
    await salesPage.route(`**${api}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      hungBody = route.request().postDataJSON() as Record<string, unknown>;
      await releaseHung.promise;
      await route.abort("failed").catch(() => {});
    });
    const beforeHung = await prisma.branchCapabilityVersion.count({
      where: { branchId: branch.id },
    });
    await salesPage.getByTestId("capability-create").click();
    await expect(salesPage.getByTestId("capability-unknown")).toBeVisible({ timeout: 16000 });
    await expect(salesPage.getByTestId("capability-recheck")).toBeEnabled({ timeout: 16000 });
    expect(await prisma.branchCapabilityVersion.count({ where: { branchId: branch.id } })).toBe(
      beforeHung
    );
    expect(
      await prisma.fitmentCommand.count({ where: { commandId: String(hungBody!.commandId) } })
    ).toBe(0);
    releaseHung.resolve();
    await salesPage.unroute(`**${api}`);
    await salesPage.reload();
    await salesPage.getByTestId("capability-recheck").click();
    await salesPage.getByTestId("capability-restore").click();
    await fill(salesPage, "CI:CAP:HUNG");
    const hungRetryRequest = salesPage.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith(api)
    );
    const hungRetry = await command(salesPage, "capability-retry", "", 201);
    expect((await hungRetryRequest).postDataJSON()).toEqual(hungBody);
    expect(hungRetry.command.commandId).toBe(String(hungBody!.commandId));
    expect(await auditCount(hungRetry.command.policyId, "BRANCH_CAPABILITY_DRAFT_CREATED")).toBe(1);

    // Payload-free recovery after reload must preserve the original version/key,
    // not manufacture a new submission intent when no receipt exists.
    let interruptedSubmit: Record<string, unknown> | undefined;
    const submitPath = `${api}/${hungRetry.command.policyId}/submit`;
    await salesPage.route(`**${submitPath}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      interruptedSubmit = route.request().postDataJSON() as Record<string, unknown>;
      await route.abort("failed");
    });
    await salesPage.getByTestId("capability-submit").click();
    await expect(salesPage.getByTestId("capability-recheck")).toBeEnabled();
    expect(await policy(hungRetry.command.policyId)).toMatchObject({ status: "DRAFT", version: 1 });
    expect(await receiptCount(hungRetry.command.policyId, "SUBMIT")).toBe(0);
    await salesPage.unroute(`**${submitPath}`);
    await salesPage.reload();
    await salesPage.getByTestId("capability-recheck").click();
    await expect(salesPage.getByTestId("capability-restore")).toHaveCount(0);
    const retrySubmission = salesPage.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith(submitPath)
    );
    await command(salesPage, "capability-retry", `/${hungRetry.command.policyId}/submit`);
    expect((await retrySubmission).postDataJSON()).toEqual(interruptedSubmit);
    expect(await policy(hungRetry.command.policyId)).toMatchObject({
      status: "PENDING_REVIEW",
      version: 2,
    });
    expect(await receiptCount(hungRetry.command.policyId, "SUBMIT")).toBe(1);
    expect(await auditCount(hungRetry.command.policyId, "BRANCH_CAPABILITY_SUBMITTED")).toBe(1);

    // Storage refusal occurs before dispatch. No unjournaled command may reach the server.
    await salesPage.getByTestId("capability-new").click();
    await salesPage.locator("#capability-category").selectOption(category.id);
    await fill(salesPage, "CI:CAP:STORAGE_REFUSAL");
    await salesPage.evaluate((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException("Synthetic storage refusal", "QuotaExceededError");
        return original.call(this, name, value);
      };
    }, journalKey);
    let storageRequests = 0;
    const countStorage = (request: import("@playwright/test").Request) => {
      if (request.method() === "POST" && request.url().endsWith(api)) storageRequests++;
    };
    salesPage.on("request", countStorage);
    const beforeStorage = await prisma.branchCapabilityVersion.count({
      where: { branchId: branch.id },
    });
    await salesPage.getByTestId("capability-create").click();
    await expect(salesPage.locator('main [role="alert"]').first()).toBeVisible();
    expect(storageRequests).toBe(0);
    expect(await prisma.branchCapabilityVersion.count({ where: { branchId: branch.id } })).toBe(
      beforeStorage
    );
    salesPage.off("request", countStorage);
    await salesPage.reload();

    // Arabic mobile is the same authenticated workflow and real domain mutation.
    await salesPage
      .getByRole("button", { name: "Toggle language between Arabic and English" })
      .click();
    await expect(salesPage.locator("html")).toHaveAttribute("dir", "rtl");
    const arabic = await create(salesPage, "CI:CAP:ARABIC");
    await submit(salesPage, arabic);
    await opsPage.setViewportSize({ width: 390, height: 844 });
    await opsPage
      .getByRole("button", { name: "Toggle language between Arabic and English" })
      .click();
    await choose(opsPage, arabic);
    await expect(opsPage.locator("html")).toHaveAttribute("dir", "rtl");
    await decide(opsPage, arabic, "approve");
    expect(await policy(arabic)).toMatchObject({
      status: "ACTIVE",
      version: 3,
      decidedByUserId: ops.userId,
    });
    expect((await current()).activeVersionId).toBe(arabic);
    await salesPage.screenshot({
      path: testInfo.outputPath("capability-sales-ar-mobile.png"),
      fullPage: true,
    });
    await opsPage.screenshot({
      path: testInfo.outputPath("capability-ops-ar-mobile.png"),
      fullPage: true,
    });

    // Changing the real authenticated account in another tab cannot let an old
    // page use its journal under the new actor, even before that page rerenders.
    await choose(salesPage, deliveredCommand.resourceId);
    await salesPage.locator("#capability-evidence").fill("CI:CAP:ACCOUNT_CHANGE");
    let accountBody: Record<string, unknown> | undefined;
    await salesPage.route(`**${api}/${deliveredCommand.resourceId}`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      accountBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.abort("failed");
    });
    await salesPage.getByTestId("capability-save").click();
    await expect(salesPage.getByTestId("capability-unknown")).toBeVisible();
    await expect(salesPage.getByTestId("capability-recheck")).toBeEnabled();
    const accountJournal = await salesPage.evaluate(
      (key) => sessionStorage.getItem(key),
      journalKey
    );
    expect(accountJournal).not.toBeNull();
    expect(accountBody).toBeDefined();
    const accountCommandId = String(accountBody!.commandId);
    const accountReceiptsBefore = await receiptCount(deliveredCommand.resourceId, "EDIT");
    const accountAuditsBefore = await auditCount(
      deliveredCommand.resourceId,
      "BRANCH_CAPABILITY_DRAFT_UPDATED"
    );
    await salesPage.unroute(`**${api}/${deliveredCommand.resourceId}`);
    await salesContext.clearCookies();
    const accountTab = await salesContext.newPage();
    await login(accountTab, ops.email);
    let foreignReceiptRequests = 0;
    const countForeignReceipt = (request: import("@playwright/test").Request) => {
      if (request.url().includes(`${api}/commands/`)) foreignReceiptRequests++;
    };
    salesPage.on("request", countForeignReceipt);
    // Hold a genuine authorized workspace response: the foreign-owner alert
    // appears before the refresh's final session check and is not a readiness signal.
    const releaseForeignWorkspace = deferred();
    releaseBarriers.push(releaseForeignWorkspace.resolve);
    let foreignWorkspaceHeld = false;
    await salesPage.route(`**${api}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      foreignWorkspaceHeld = true;
      await releaseForeignWorkspace.promise;
      await route.fulfill({ response });
    });
    await salesPage.getByTestId("capability-recheck").click();
    await expect.poll(() => foreignWorkspaceHeld).toBe(true);
    const foreignOwnerAlert = salesPage.getByRole("alert").filter({
      hasText: ar.capabilities.otherOwner,
    });
    await expect(foreignOwnerAlert).toBeVisible();
    await expect(salesPage.getByTestId("capability-refresh")).toBeDisabled();
    await expect(salesPage.getByTestId("capability-policy")).toHaveCount(0);
    const finalForeignAuth = salesPage.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/staff/auth/status"
    );
    releaseForeignWorkspace.resolve();
    const foreignAuthResponse = await finalForeignAuth;
    expect(foreignAuthResponse.status()).toBe(200);
    expect(await foreignAuthResponse.json()).toMatchObject({
      state: "ACTIVE",
      userId: ops.userId,
    });
    await expect(salesPage.getByTestId("capability-refresh")).toBeEnabled();
    await expect(foreignOwnerAlert).toBeVisible();
    await expect(salesPage.getByTestId("capability-policy")).toBeVisible();
    await salesPage.unroute(`**${api}`);
    expect(foreignReceiptRequests).toBe(0);
    expect(await salesPage.evaluate((key) => sessionStorage.getItem(key), journalKey)).toBe(
      accountJournal
    );
    expect(await policy(deliveredCommand.resourceId)).toMatchObject({
      version: 3,
      evidenceRef: "CI:CAP:FIRST_WINNER",
    });
    expect(await prisma.fitmentCommand.count({ where: { commandId: accountCommandId } })).toBe(0);
    expect(await receiptCount(deliveredCommand.resourceId, "EDIT")).toBe(accountReceiptsBefore);
    expect(await auditCount(deliveredCommand.resourceId, "BRANCH_CAPABILITY_DRAFT_UPDATED")).toBe(
      accountAuditsBefore
    );
    salesPage.off("request", countForeignReceipt);
    await salesContext.clearCookies();
    await login(accountTab, sales.email);
    const restoredAuth = await salesContext.request.get(
      new URL("/api/v1/staff/auth/status", accountTab.url()).href
    );
    expect(restoredAuth.status()).toBe(200);
    expect(await restoredAuth.json()).toMatchObject({ state: "ACTIVE", userId: sales.userId });
    await accountTab.close();
    // Return to the intended resource, not whichever URL an auth redirect left behind.
    await salesPage.goto(workspace);
    await expect(salesPage.getByTestId("capability-refresh")).toBeEnabled();
    expect(await salesPage.evaluate((key) => sessionStorage.getItem(key), journalKey)).toBe(
      accountJournal
    );
    await salesPage.getByTestId("capability-recheck").click();
    await salesPage.getByTestId("capability-restore").click();
    await fill(salesPage, "CI:CAP:ACCOUNT_CHANGE");
    const accountRetryRequest = salesPage.waitForRequest(
      (request) =>
        request.url().endsWith(`${api}/${deliveredCommand.resourceId}`) &&
        request.method() === "PUT"
    );
    const accountRecovery = await command(
      salesPage,
      "capability-retry",
      `/${deliveredCommand.resourceId}`
    );
    expect((await accountRetryRequest).postDataJSON()).toEqual(accountBody);
    expect(accountRecovery.command.commandId).toBe(accountCommandId);
    expect(await policy(deliveredCommand.resourceId)).toMatchObject({
      version: 4,
      evidenceRef: "CI:CAP:ACCOUNT_CHANGE",
    });
    expect(await prisma.fitmentCommand.count({ where: { commandId: accountCommandId } })).toBe(1);
    expect(await receiptCount(deliveredCommand.resourceId, "EDIT")).toBe(accountReceiptsBefore + 1);
    expect(await auditCount(deliveredCommand.resourceId, "BRANCH_CAPABILITY_DRAFT_UPDATED")).toBe(
      accountAuditsBefore + 1
    );

    // Storage can change while a real response is in flight. A late callback
    // must not clear a newer identity, even if it belongs to the same actor.
    const latePage = await salesContext.newPage();
    await latePage.goto(workspace);
    await choose(latePage, deliveredCommand.resourceId);
    await latePage.locator("#capability-evidence").fill("CI:CAP:LATE_RESPONSE");
    const responseHeld = deferred();
    const releaseResponse = deferred();
    releaseBarriers.push(releaseResponse.resolve);
    let lateCommandId: string | undefined;
    await latePage.route(`**${api}/${deliveredCommand.resourceId}`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      lateCommandId = String((route.request().postDataJSON() as Record<string, unknown>).commandId);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      responseHeld.resolve();
      await releaseResponse.promise;
      await route.fulfill({ response });
    });
    await latePage.getByTestId("capability-save").click();
    await responseHeld.promise;
    const futureId = crypto.randomUUID();
    const futureBody = {
      commandId: futureId,
      expectedVersion: 5,
      evidenceRef: "CI:CAP:FUTURE_INTENT",
      coverage: [{ makeId: make.id, modelId: model.id, yearFrom: 2020, yearTo: 2024 }],
    };
    const futureJournal = JSON.stringify({
      schema: 1,
      actorId: sales.userId,
      branchId: branch.id,
      commandId: futureId,
      action: "EDIT",
      policyId: deliveredCommand.resourceId,
      expectedVersion: 5,
      fingerprint: crypto
        .createHash("sha256")
        .update(
          JSON.stringify([
            "capability-ui-intent-v1",
            sales.userId,
            branch.id,
            deliveredCommand.resourceId,
            "EDIT",
            futureBody,
          ])
        )
        .digest("hex"),
    });
    await latePage.evaluate(({ key, value }) => sessionStorage.setItem(key, value), {
      key: journalKey,
      value: futureJournal,
    });
    releaseResponse.resolve();
    await expect(latePage.getByTestId("capability-recheck")).toBeEnabled();
    expect(await latePage.evaluate((key) => sessionStorage.getItem(key), journalKey)).toBe(
      futureJournal
    );
    expect(await prisma.fitmentCommand.count({ where: { commandId: lateCommandId } })).toBe(1);
    expect(await prisma.fitmentCommand.count({ where: { commandId: futureId } })).toBe(0);
    expect(await policy(deliveredCommand.resourceId)).toMatchObject({
      version: 5,
      evidenceRef: "CI:CAP:LATE_RESPONSE",
    });
    await latePage.close();

    // Historical selected canonical entries stay recognisable after deactivation.
    await prisma.vehicleModel.update({ where: { id: model.id }, data: { isActive: false } });
    await choose(salesPage, deliveredCommand.resourceId);
    const historicalOption = salesPage.locator(`#fitment-model-0 option[value="${model.id}"]`);
    await expect(historicalOption).toHaveCount(1);
    await expect(historicalOption).toHaveText(/طراز تجريبي/);
    await expect(historicalOption).toBeDisabled();
    await expect(salesPage.locator("#fitment-model-0")).toHaveValue(model.id);
    expect(await policy(deliveredCommand.resourceId)).toMatchObject({
      version: 5,
      evidenceRef: "CI:CAP:LATE_RESPONSE",
    });

    const unrelatedProvider = await prisma.providerOrganization.create({
      data: {
        nameEn: `Unrelated parent ${uid}`,
        nameAr: "مقدم خدمة آخر للاختبار",
        legalName: `Unrelated parent ${uid}`,
        taxRegistrationNumber: String(crypto.randomInt(100000000, 999999999)),
        commercialRegistrationNumber: `CAP-OTHER-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        status: "ACTIVE",
        contactPersonName: "Synthetic Contact",
        contactEmail: `cap-other-${uid}@test.eg`,
        contactPhone: "+201011112222",
        createdByUserId: sales.userId,
      },
    });
    const mismatchedBranchPage = await opsContext.newPage();
    let mismatchedCapabilityReads = 0;
    mismatchedBranchPage.on("request", (request) => {
      if (request.url().endsWith(api)) mismatchedCapabilityReads++;
    });
    await mismatchedBranchPage.goto(
      `/staff/providers/${unrelatedProvider.id}/branches/${branch.id}/capabilities`
    );
    await expect(mismatchedBranchPage.locator('main [role="alert"]').first()).toBeVisible();
    await expect(mismatchedBranchPage.getByTestId("capability-policy")).toHaveCount(0);
    expect(mismatchedCapabilityReads).toBe(0);
    expect((await current()).activeVersionId).toBe(arabic);
    await mismatchedBranchPage.close();

    // Real session resolution observes loss of verified MFA and of the explicit role.
    const deniedPage = await opsContext.newPage();
    try {
      await prisma.twoFactor.updateMany({
        where: { userId: ops.userId },
        data: { verified: false },
      });
      const authRead = deniedPage.waitForResponse((response) =>
        response.url().endsWith("/api/v1/staff/auth/status")
      );
      await deniedPage.goto(workspace);
      expect(await (await authRead).json()).toMatchObject({
        state: "MFA_ENROLLMENT_PENDING",
        canAccessStaffApp: false,
      });
      await expect(deniedPage.locator('main [role="alert"]').first()).toBeVisible();
      await expect(deniedPage.getByTestId("capability-policy")).toHaveCount(0);
    } finally {
      await prisma.twoFactor.updateMany({
        where: { userId: ops.userId },
        data: { verified: true },
      });
    }
    const opsRoles = await prisma.internalRoleAssignment.findMany({
      where: { staffMembership: { userId: ops.userId }, isActive: true },
      select: { id: true },
    });
    try {
      await prisma.internalRoleAssignment.updateMany({
        where: { id: { in: opsRoles.map((role) => role.id) } },
        data: { isActive: false },
      });
      await deniedPage.reload();
      await expect(deniedPage.locator('main [role="alert"]').first()).toBeVisible();
      await expect(deniedPage.getByTestId("capability-policy")).toHaveCount(0);
      expect((await current()).activeVersionId).toBe(arabic);
    } finally {
      await prisma.internalRoleAssignment.updateMany({
        where: { id: { in: opsRoles.map((role) => role.id) } },
        data: { isActive: true },
      });
      await deniedPage.close();
    }
  } finally {
    for (const release of releaseBarriers) release();
    if (temporarySql.length) {
      const cleanup = new pg.Client({ connectionString: databaseUrl });
      await cleanup.connect();
      try {
        for (const { trigger, fn } of temporarySql) {
          await cleanup.query(`DROP TRIGGER IF EXISTS ${trigger} ON security_audit_events`);
          await cleanup.query(`DROP FUNCTION IF EXISTS ${fn}()`);
        }
      } finally {
        await cleanup.end();
      }
    }
    const results = await Promise.allSettled(contexts.map((context) => context.close()));
    // Submitted history is immutable. These uniquely named synthetic fixtures
    // live only in the disposable test database; cleanup never bypasses guards.
    await disconnectDb();
    if (testInfo.status === "passed" && results.some((result) => result.status === "rejected"))
      throw new Error("Capability browser context cleanup failed");
  }
});
