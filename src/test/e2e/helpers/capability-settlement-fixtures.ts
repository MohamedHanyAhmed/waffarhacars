import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricEncrypt } from "better-auth/crypto";
import { getPrisma, disconnectDb } from "@/lib/db";
import { provisionStaffMember } from "@/lib/staff/provisioning";

const password = "ValidStaffPassword123!";
const secret = "JBSWY3DPEHPK3PXP";
export const journalKey = "waffarhacars_capability_pending_v1";

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Check before getPrisma/provisioning: this suite must never write to a remote or
// real customer database. Fixtures remain in the disposable database because
// capability history is immutable; cleanup does not bypass domain guards.
function assertDisposableDatabase() {
  if (
    process.env.APP_RUNTIME_PROFILE !== "showcase" ||
    process.env.APP_DATA_BACKEND !== "postgres" ||
    process.env.OTP_SMS_PROVIDER !== "test"
  )
    throw new Error("Capability settlement tests require the isolated PostgreSQL test profile");
  for (const name of ["DATABASE_URL", "DATABASE_DIRECT_URL"] as const) {
    const raw = process.env[name];
    if (!raw) throw new Error("Capability settlement test database is not configured");
    const url = new URL(raw);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/waffarhacars_test"
    )
      throw new Error("Capability settlement tests require a loopback disposable test database");
  }
}

async function login(page: Page, email: string) {
  await page.goto("/staff/login");
  await page.locator("input[type=email]").fill(email);
  await page.locator("input[type=password]").fill(password);
  const signIn = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/auth/sign-in/email"
  );
  await page.locator("button[type=submit]").click();
  expect((await signIn).status()).toBe(200);
  await page.waitForURL("**/staff/mfa/verify");
  await page
    .locator("input[type=text]")
    .fill(await createOTP(secret, { digits: 6, period: 30 }).totp());
  const verify = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/auth/two-factor/verify-totp"
  );
  await page.locator("button[type=submit]").click();
  expect((await verify).status()).toBe(200);
  await page.waitForURL(
    (url) => !url.pathname.includes("/mfa/") && !url.pathname.endsWith("/login")
  );
}

export async function fixture(browser: Browser, testId: string) {
  assertDisposableDatabase();
  const prisma = getPrisma();
  const contexts: BrowserContext[] = [];
  const releases: Array<() => void> = [];
  const uid = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const cleanup = async () => {
    for (const release of releases) release();
    try {
      await Promise.all(contexts.map((context) => context.close()));
    } finally {
      await disconnectDb();
    }
  };
  try {
    if ((await prisma.internalStaffMembership.count()) === 0)
      await provisionStaffMember({
        email: `settlement-bootstrap-${uid}@test.eg`,
        password,
        fullName: "Synthetic Bootstrap",
        employeeNumber: `CSB-${uid}`,
        department: "ADMIN",
        isBootstrap: true,
      });
    async function staff(
      department: "SALES" | "OPERATIONS",
      role: "SALES_AGENT" | "OPS_SUPERVISOR"
    ) {
      const email = `settlement-${department}-${uid}@test.eg`;
      const member = await provisionStaffMember({
        email,
        password,
        fullName: `Synthetic ${department}`,
        employeeNumber: `CS-${department}-${uid}`,
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
        nameEn: `Synthetic settlement ${uid}`,
        nameAr: `مركز تجريبي ${uid}`,
        legalName: `Synthetic ${uid}`,
        taxRegistrationNumber: String(Math.floor(100000000 + Math.random() * 900000000)),
        commercialRegistrationNumber: `CS-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        status: "ACTIVE",
        version: 1,
        contactPersonName: "Synthetic Contact",
        contactEmail: `settlement-provider-${uid}@test.eg`,
        contactPhone: "+201011112222",
        createdByUserId: sales.userId,
        activatedByUserId: ops.userId,
        activatedAt: new Date(),
      },
    });
    const branch = await prisma.providerBranch.create({
      data: {
        providerOrganizationId: provider.id,
        branchCode: `CS-${uid}`,
        nameEn: "Synthetic settlement branch",
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
        evidenceDocumentRef: `CI:CS:BRANCH:${uid}`,
        vettedByUserId: ops.userId,
        vettedAt: new Date(),
      },
    });
    const category = await prisma.serviceCategory.findUniqueOrThrow({
      where: { code: "EXPRESS_MAINTENANCE" },
    });
    const make = await prisma.vehicleMake.create({
      data: {
        code: `CS_${uid}`,
        nameEn: "Synthetic settlement make",
        nameAr: "ماركة تجريبية",
        evidenceRef: "CI:CS:MAKE",
      },
    });
    const model = await prisma.vehicleModel.create({
      data: {
        code: `CS_${uid}`,
        makeId: make.id,
        nameEn: "Synthetic settlement model",
        nameAr: "طراز تجريبي",
        evidenceRef: "CI:CS:MODEL",
      },
    });
    async function pageFor(role: "sales" | "ops") {
      const digest = crypto.createHash("sha256").update(`${testId}:${role}`).digest();
      const context = await browser.newContext({
        extraHTTPHeaders: { "x-forwarded-for": `198.19.${digest[0]}.${digest[1]}` },
      });
      contexts.push(context);
      const page = await context.newPage();
      page.on("dialog", async (dialog) =>
        dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss()
      );
      await login(page, (role === "sales" ? sales : ops).email);
      return page;
    }
    return {
      prisma,
      sales,
      ops,
      branch,
      category,
      make,
      model,
      releases,
      cleanup,
      pageFor,
      workspace: `/staff/providers/${provider.id}/branches/${branch.id}/capabilities`,
      api: `/api/v1/staff/branches/${branch.id}/fitment-policies`,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

export async function fillDraft(page: Page, f: Fixture, evidence: string) {
  const category = page.locator("#capability-category");
  if (await category.isEnabled()) await category.selectOption(f.category.id);
  else await expect(category).toHaveValue(f.category.id);
  await page.locator("#capability-evidence").fill(evidence);
  const select = page.locator("#fitment-make-0");
  await expect
    .poll(async () => {
      if (await select.locator(`option[value="${f.make.id}"]`).count()) return true;
      const more = page.getByTestId("fitment-more-makes");
      if ((await more.isVisible()) && (await more.isEnabled())) {
        const response = page.waitForResponse(
          (r) => r.request().method() === "GET" && r.url().includes("/api/v1/vehicles/catalog?")
        );
        await more.click();
        expect((await response).status()).toBe(200);
      }
      return (await select.locator(`option[value="${f.make.id}"]`).count()) === 1;
    })
    .toBe(true);
  await select.selectOption(f.make.id);
  await expect(page.locator(`#fitment-model-0 option[value="${f.model.id}"]`)).toHaveCount(1);
  await page.locator("#fitment-model-0").selectOption(f.model.id);
  await page.locator("#fitment-yearFrom-0").fill("2020");
  await page.locator("#fitment-yearTo-0").fill("2024");
}
