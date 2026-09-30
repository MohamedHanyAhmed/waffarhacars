import { test, expect, Page } from "@playwright/test";
import pg from "pg";
import crypto from "node:crypto";
import { createOTP } from "@better-auth/utils/otp";
import { symmetricEncrypt } from "better-auth/crypto";
import { getPrisma, disconnectDb } from "@/lib/db";
import { provisionStaffMember } from "@/lib/staff/provisioning";

const DEFAULT_TEST_DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";

const TEST_PASSWORD = "ValidStaffPassword123!";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

/**
 * Performs actual staff authentication in the browser via the UI form:
 * 1. POST /api/auth/sign-in/email via /staff/login
 * 2. Redirect to /staff/mfa/verify
 * 3. Fill 6-digit TOTP code and submit via POST /api/auth/two-factor/verify-totp
 * 4. Resolves authenticated session with zero handmade cookies.
 */
async function performRealStaffLogin(
  page: Page,
  email: string,
  password: string,
  totpSecret: string
) {
  await page.goto("/staff/login");
  await page.waitForSelector("input[type='email']");
  await page.fill("input[type='email']", email);
  await page.fill("input[type='password']", password);
  await page.click("button[type='submit']");

  // Better Auth TOTP flow triggers redirect to /staff/mfa/verify
  await page.waitForURL("**/staff/mfa/verify", { timeout: 15000 });

  // Generate authentic time-based 6-digit OTP code using standard TOTP secret
  const totpCode = await createOTP(totpSecret, { digits: 6, period: 30 }).totp();

  await page.waitForSelector("input[type='text']");
  await page.fill("input[type='text']", totpCode);
  await page.click("button[type='submit']");

  // Wait for redirect to staff landing page
  await page.waitForURL(
    (url) => !url.pathname.includes("/staff/mfa/verify") && !url.pathname.includes("/staff/login"),
    { timeout: 15000 }
  );
}

test.describe("Real PostgreSQL Staff Provider Onboarding & Operations Vetting E2E", () => {
  let isDbReachable = false;
  const createdUserEmails: string[] = [];
  const createdProviderIds: string[] = [];

  test.beforeAll(async () => {
    const probe = new pg.Client({
      connectionString: DEFAULT_TEST_DB_URL,
      connectionTimeoutMillis: 5000,
    });
    try {
      await probe.connect();
      const res = await probe.query("SELECT 1 AS probe");
      if (res.rows[0]?.probe === 1) {
        isDbReachable = true;
      }
    } catch (err) {
      isDbReachable = false;
      console.error("PostgreSQL probe failed:", err);
    } finally {
      await probe.end().catch(() => {});
    }
  });

  test.afterAll(async () => {
    if (isDbReachable) {
      const prisma = getPrisma();
      try {
        if (createdProviderIds.length > 0) {
          await prisma.providerBranch.deleteMany({
            where: { providerOrganizationId: { in: createdProviderIds } },
          });
          await prisma.providerOrganization.deleteMany({
            where: { id: { in: createdProviderIds } },
          });
        }
        if (createdUserEmails.length > 0) {
          const users = await prisma.user.findMany({
            where: { email: { in: createdUserEmails } },
            select: { id: true },
          });
          const userIds = users.map((u) => u.id);
          if (userIds.length > 0) {
            await prisma.securityAuditEvent.deleteMany({
              where: { actorUserId: { in: userIds } },
            });
            await prisma.internalRoleAssignment.deleteMany({
              where: { staffMembership: { userId: { in: userIds } } },
            });
            await prisma.internalStaffMembership.deleteMany({
              where: { userId: { in: userIds } },
            });
            await prisma.twoFactor.deleteMany({
              where: { userId: { in: userIds } },
            });
            await prisma.session.deleteMany({
              where: { userId: { in: userIds } },
            });
            await prisma.account.deleteMany({
              where: { userId: { in: userIds } },
            });
            await prisma.user.deleteMany({
              where: { id: { in: userIds } },
            });
          }
        }
      } catch (err) {
        console.error("Cleanup error in staff-provider-onboarding-real:", err);
      }
      await disconnectDb();
    }
  });

  async function createRealStaffUser(
    role: "SALES_AGENT" | "OPS_SUPERVISOR",
    dept: "SALES" | "OPERATIONS"
  ) {
    const prisma = getPrisma();
    const uid = crypto.randomUUID().slice(0, 8);
    const email = `e2e-${role.toLowerCase()}-${uid}@test.eg`;
    createdUserEmails.push(email);

    // Bootstrap first admin if zero staff exist to ensure provisioning succeeds
    const staffCount = await prisma.internalStaffMembership.count();
    if (staffCount === 0) {
      const adminEmail = `admin-e2e-boot-${uid}@test.eg`;
      createdUserEmails.push(adminEmail);
      await provisionStaffMember({
        email: adminEmail,
        password: TEST_PASSWORD,
        fullName: "System Admin Bootstrap",
        employeeNumber: `BOOT-${uid}`,
        department: "ADMIN",
        isBootstrap: true,
      });
    }

    const provisionResult = await provisionStaffMember({
      email,
      password: TEST_PASSWORD,
      fullName: `Real Staff ${role}`,
      employeeNumber: `EMP-${uid}`,
      department: dept,
      isBootstrap: false,
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: provisionResult.userId },
      include: { internalStaffMembership: true },
    });

    // Encrypt the TOTP secret using Better Auth's symmetricEncrypt.
    // Better Auth's verify-totp endpoint decrypts twoFactor.secret with symmetricDecrypt
    // using BETTER_AUTH_SECRET. Storing the properly encrypted secret ensures authentic
    // time-based OTP codes verify successfully during browser login.
    const secretKey =
      process.env.BETTER_AUTH_SECRET || "ci-non-production-test-secret-at-least-32-chars-long";
    const encryptedSecret = await symmetricEncrypt({
      key: secretKey,
      data: TOTP_SECRET,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true },
    });

    await prisma.twoFactor.create({
      data: {
        userId: user.id,
        secret: encryptedSecret,
        backupCodes: "[]",
        verified: true,
      },
    });

    await prisma.internalStaffMembership.update({
      where: { userId: user.id },
      data: { mustChangePassword: false, isActive: true },
    });

    // Invariant: ZERO handmade session cookies injected into browser or DB.
    // The browser performs actual staff authentication through /staff/login and /staff/mfa/verify.
    return {
      user,
      email,
      password: TEST_PASSWORD,
      totpSecret: TOTP_SECRET,
    };
  }

  test("executes non-skippable real PostgreSQL Sales onboarding, organization editing, Operations vetting/activation, and bilingual RTL/LTR verification", async ({
    browser,
  }) => {
    // Non-skippable gate invariant: fail rather than skip if DB setup is missing
    if (!isDbReachable) {
      throw new Error(
        `PostgreSQL test container is not reachable at ${DEFAULT_TEST_DB_URL}. Gate failed: real DB E2E test is mandatory.`
      );
    }

    const prisma = getPrisma();
    const uid = crypto.randomUUID().slice(0, 6).toUpperCase();
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    // Create real staff members in PostgreSQL
    const salesUser = await createRealStaffUser("SALES_AGENT", "SALES");
    const opsUser = await createRealStaffUser("OPS_SUPERVISOR", "OPERATIONS");

    // Separate browser contexts for Sales and Operations users
    const salesContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const salesPage = await salesContext.newPage();

    const opsContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const opsPage = await opsContext.newPage();

    try {
      // 1. Authenticate Sales in browser via real UI login and TOTP MFA form
      await performRealStaffLogin(
        salesPage,
        salesUser.email,
        salesUser.password,
        salesUser.totpSecret
      );

      // 2. Sales visits provider directory
      await salesPage.goto("/staff/providers");
      await expect(salesPage.locator("text=Provider Organizations").first()).toBeVisible();

      // 3. Sales creates draft provider organization
      await salesPage.locator("a[href='/staff/providers/new']:visible").first().click();
      await salesPage.waitForURL("**/staff/providers/new");

      await salesPage.fill("#legalName", `Real Automotive Services ${uid} S.A.E.`);
      await salesPage.fill("#nameEn", `Real Auto Care ${uid}`);
      await salesPage.fill("#nameAr", `مركز الصيانة الحقيقي ${uid}`);
      await salesPage.fill("#taxId", taxId);
      await salesPage.fill("#crNumber", `CR-REAL-${uid}`);
      await salesPage.selectOption("#primaryCluster", "NASR_CITY_HELIOPOLIS");
      await salesPage.fill("#contactPerson", "Youssef Zaki");
      await salesPage.fill("#contactEmail", `youssef-${uid}@realauto.eg`);
      await salesPage.fill("#contactPhone", "+201012345678");

      await salesPage.click("button[type='submit']");
      await salesPage.waitForURL(/\/staff\/providers\/[0-9a-f-]+$/);

      // Extract provider ID from URL
      const providerUrl = salesPage.url();
      const providerId = providerUrl.split("/").pop()!;
      createdProviderIds.push(providerId);

      // Verify DB record was created with status DRAFT
      const dbProviderAfterCreate = await prisma.providerOrganization.findUniqueOrThrow({
        where: { id: providerId },
      });
      expect(dbProviderAfterCreate.status).toBe("DRAFT");
      expect(dbProviderAfterCreate.version).toBe(1);
      expect(dbProviderAfterCreate.taxRegistrationNumber).toBe(taxId);

      // 4. Sales tests Organization Editing (/staff/providers/[id]/edit)
      await salesPage.locator("#edit-provider-details-link").click();
      await salesPage.waitForURL(`**/staff/providers/${providerId}/edit`);

      // Update English name and legal entity name
      await salesPage.fill("#nameEn", `Real Auto Care ${uid} Updated`);
      await salesPage.fill("#legalName", `Real Automotive Services ${uid} Updated S.A.E.`);
      await salesPage.click("#save-provider-edit-btn");
      await salesPage.waitForURL(`**/staff/providers/${providerId}`);

      // Verify DB record was updated to version 2
      const dbProviderAfterEdit = await prisma.providerOrganization.findUniqueOrThrow({
        where: { id: providerId },
      });
      expect(dbProviderAfterEdit.nameEn).toBe(`Real Auto Care ${uid} Updated`);
      expect(dbProviderAfterEdit.version).toBe(2);

      // 5. Sales creates physical branch draft with explicit coordinates & confirmed operating hours
      await salesPage
        .locator(`a[href='/staff/providers/${providerId}/branches/new']`)
        .first()
        .click();
      await salesPage.waitForURL(`**/staff/providers/${providerId}/branches/new`);

      await salesPage.fill("#branchCode", `BR-REAL-${uid}`);
      await salesPage.fill("#branchNameEn", `Nasr City Center ${uid}`);
      await salesPage.fill("#branchNameAr", `فرع مدينة نصر ${uid}`);
      await salesPage.fill("#streetEn", "10 Tayaran Street");
      await salesPage.fill("#streetAr", "١٠ شارع الطيران");
      await salesPage.fill("#branch-latitude", "30.0543");
      await salesPage.fill("#branch-longitude", "31.3321");
      await salesPage.fill("#branchContactPhone", "+201098765432");

      // Explicitly confirm actual operating hours
      await salesPage.check("#confirm-operating-hours");

      await salesPage.click("button[type='submit']");
      await salesPage.waitForURL(`**/staff/providers/${providerId}`);

      // Verify branch was created in DB
      const dbBranch = await prisma.providerBranch.findFirstOrThrow({
        where: { providerOrganizationId: providerId },
      });
      expect(dbBranch.status).toBe("DRAFT");
      expect(dbBranch.branchCode).toBe(`BR-REAL-${uid}`);
      expect(Number(dbBranch.latitude)).toBeCloseTo(30.0543, 4);
      expect(Number(dbBranch.longitude)).toBeCloseTo(31.3321, 4);

      // 6. Sales submits provider for review
      await salesPage.locator("button:has-text('Submit for Review')").first().click();
      await salesPage.waitForSelector("text=Submission Summary & Review");
      await salesPage.locator("button:has-text('Submit for Operations Review')").first().click();
      await salesPage.waitForSelector("text=Confirm Submission for Operations Review");
      await salesPage.locator("button:has-text('Yes, Submit for Review')").first().click();

      await expect(salesPage.locator("text=Pending Review").first()).toBeVisible();

      // Verify DB provider transitioned to PENDING_REVIEW (version 3)
      const dbProviderPending = await prisma.providerOrganization.findUniqueOrThrow({
        where: { id: providerId },
      });
      expect(dbProviderPending.status).toBe("PENDING_REVIEW");
      expect(dbProviderPending.version).toBe(3);

      // 7. Operations user logs in through the browser via login form and MFA
      await performRealStaffLogin(opsPage, opsUser.email, opsUser.password, opsUser.totpSecret);

      // 8. Operations visits the Operations pending queue at /staff/ops/queue
      await opsPage.goto("/staff/ops/queue");
      await expect(opsPage.locator(`text=Real Auto Care ${uid} Updated`).first()).toBeVisible();

      // Inspect provider via queue link
      const inspectLink = opsPage.locator(`a[href='/staff/providers/${providerId}']`).first();
      await inspectLink.click();
      await opsPage.waitForURL(`**/staff/providers/${providerId}`);
      await expect(opsPage.locator("text=Pending Review").first()).toBeVisible();

      // 9. Operations vets and activates branch
      await opsPage.locator("button:has-text('Vet & Activate')").first().click();
      await opsPage.waitForSelector("text=Confirm Branch Activation");

      await opsPage.check("#check-legal-identity");
      await opsPage.check("#check-physical-location");
      await opsPage.check("#check-contact-hours");
      await opsPage.fill("#evidence-document-ref", `DOC-REAL-OPS-${uid}`);

      await opsPage
        .locator("div[role='dialog'] button:has-text('Activate Branch')")
        .first()
        .click();
      await opsPage.waitForTimeout(500);

      // Verify branch in DB is ACTIVE with complete vetting attestation
      const dbBranchActive = await prisma.providerBranch.findUniqueOrThrow({
        where: { id: dbBranch.id },
      });
      expect(dbBranchActive.status).toBe("ACTIVE");
      expect(dbBranchActive.legalIdentityChecked).toBe(true);
      expect(dbBranchActive.physicalLocationChecked).toBe(true);
      expect(dbBranchActive.contactAndHoursChecked).toBe(true);
      expect(dbBranchActive.evidenceDocumentRef).toBe(`DOC-REAL-OPS-${uid}`);
      expect(dbBranchActive.vettedAt).not.toBeNull();

      // 10. Operations activates provider organization
      const activateProviderBtn = opsPage.locator("button:has-text('Activate Provider')").first();
      await expect(activateProviderBtn).toBeEnabled();
      await activateProviderBtn.click();
      await opsPage.waitForTimeout(500);

      await expect(opsPage.locator("text=Active (Vetted)").first()).toBeVisible();
      await expect(opsPage.locator("text=Offers not configured").first()).toBeVisible();

      // Verify DB provider is ACTIVE
      const dbProviderActive = await prisma.providerOrganization.findUniqueOrThrow({
        where: { id: providerId },
      });
      expect(dbProviderActive.status).toBe("ACTIVE");
      expect(dbProviderActive.activatedAt).not.toBeNull();

      // 11. Verify rendering in English on salesPage
      await salesPage.goto(`/staff/providers/${providerId}`);
      await expect(salesPage.locator("text=Active (Vetted)").first()).toBeVisible();
      await expect(salesPage.locator(`text=Real Auto Care ${uid} Updated`).first()).toBeVisible();

      // 12. Bilingual Arabic Pass: switch to Arabic and verify RTL layout & LTR data fields
      await opsContext.addCookies([
        {
          name: "NEXT_LOCALE",
          value: "ar",
          domain: "localhost",
          path: "/",
        },
      ]);

      await opsPage.goto(`/staff/providers/${providerId}`);
      await opsPage.waitForSelector("text=نشط (معتمد)");

      // Assert root dir is rtl
      const pageDir = await opsPage.locator("div[dir='rtl']").first();
      await expect(pageDir).toBeVisible();

      // Assert sensitive numeric fields maintain dir="ltr"
      const ltrTaxId = opsPage.locator("p[dir='ltr']").filter({ hasText: taxId });
      await expect(ltrTaxId).toBeVisible();

      const ltrPhone = opsPage.locator("p[dir='ltr']").filter({ hasText: "+201012345678" });
      await expect(ltrPhone).toBeVisible();

      // 13. Audit trail verification in persistent PostgreSQL database
      const auditEvents = await prisma.securityAuditEvent.findMany({
        where: {
          targetEntity: { contains: providerId },
        },
      });
      // Verify audit entries exist for provider lifecycle
      expect(auditEvents.length).toBeGreaterThanOrEqual(1);
    } finally {
      await salesContext.close().catch(() => {});
      await opsContext.close().catch(() => {});
    }
  });
});
