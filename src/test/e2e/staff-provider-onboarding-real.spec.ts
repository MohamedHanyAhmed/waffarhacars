import { test, expect, Page } from "@playwright/test";
import pg from "pg";
import crypto from "node:crypto";
import { createOTP } from "@better-auth/utils/otp";
import { getPrisma, disconnectDb } from "@/lib/db";
import { provisionStaffMember } from "@/lib/staff/provisioning";

const DEFAULT_TEST_DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";

const TEST_PASSWORD = "ValidStaffPassword123!";

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

    // --- Complete the staff lifecycle using Better Auth's actual API ---
    // We use the server's HTTP API (via fetch) but carry cookies properly across steps.
    // This ensures TOTP secret is stored encrypted by Better Auth and verifiable at login.
    const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

    // Helper: build a cookie jar string from Set-Cookie headers
    function mergeCookies(previous: string, newSetCookies: string[]): string {
      const jar = new Map<string, string>();
      // Parse existing jar
      for (const pair of previous.split(";")) {
        const trimmed = pair.trim();
        if (trimmed && trimmed.includes("=")) {
          const eq = trimmed.indexOf("=");
          jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
        }
      }
      // Overwrite with new Set-Cookie values
      for (const raw of newSetCookies) {
        const nameVal = raw.split(";")[0].trim();
        if (nameVal && nameVal.includes("=")) {
          const eq = nameVal.indexOf("=");
          jar.set(nameVal.slice(0, eq), nameVal.slice(eq + 1));
        }
      }
      return Array.from(jar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }

    // Step 1: Sign in with the temporary password to get a session cookie.
    const signInRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    let cookieJar = mergeCookies("", signInRes.headers.getSetCookie?.() ?? []);
    if (!cookieJar) {
      const raw = signInRes.headers.get("set-cookie");
      if (raw) cookieJar = raw.split(";")[0].trim();
    }

    // Step 2: Change password — clears mustChangePassword in Better Auth and rotates session.
    const ENROLLED_PASSWORD = `${TEST_PASSWORD}Enrolled!`;
    const changePwRes = await fetch(`${baseUrl}/api/v1/staff/auth/change-password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieJar },
      body: JSON.stringify({ currentPassword: TEST_PASSWORD, newPassword: ENROLLED_PASSWORD }),
    });
    if (changePwRes.status !== 200) {
      const body = await changePwRes.text();
      throw new Error(`change-password failed (${changePwRes.status}): ${body}`);
    }
    // Merge rotated session cookie into jar
    const changePwSetCookies = changePwRes.headers.getSetCookie?.() ?? [];
    if (changePwSetCookies.length > 0) {
      cookieJar = mergeCookies(cookieJar, changePwSetCookies);
    } else {
      const raw = changePwRes.headers.get("set-cookie");
      if (raw) cookieJar = mergeCookies(cookieJar, [raw]);
    }

    // Step 3: Enable TOTP via Better Auth — it encrypts and stores the secret.
    const enableRes = await fetch(`${baseUrl}/api/auth/two-factor/enable`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieJar },
      body: JSON.stringify({ password: ENROLLED_PASSWORD }),
    });
    const enableData = (await enableRes.json()) as { totpURI?: string; error?: string };
    if (!enableData.totpURI) {
      throw new Error(
        `Better Auth two-factor/enable failed (status ${enableRes.status}) for ${email}: ${JSON.stringify(enableData)}`
      );
    }

    // Step 4: Derive the TOTP secret from the URI for use during browser login.
    // Better Auth stores base32-encoded secret in the TOTP URI query param.
    const totpUriParsed = new URL(enableData.totpURI);
    const totpSecret = totpUriParsed.searchParams.get("secret")!;

    // Step 5: Verify one code to complete enrollment (marks verified=true in DB).
    const enrollCode = await createOTP(totpSecret, { digits: 6, period: 30 }).totp();
    const verifyRes = await fetch(`${baseUrl}/api/auth/two-factor/verify-totp`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieJar },
      body: JSON.stringify({ code: enrollCode }),
    });
    if (verifyRes.status !== 200) {
      const verifyBody = await verifyRes.text();
      throw new Error(
        `TOTP enrollment verification failed for ${email} (status ${verifyRes.status}): ${verifyBody}`
      );
    }

    // Step 6: Ensure mustChangePassword is cleared in the membership record.
    await prisma.internalStaffMembership.update({
      where: { userId: user.id },
      data: { mustChangePassword: false, isActive: true },
    });

    // Notice: ZERO handmade session cookies injected into the browser.
    // The browser authenticates through /staff/login and /staff/mfa/verify using
    // ENROLLED_PASSWORD and totpSecret (the base32 secret from the TOTP URI).
    return {
      user,
      email,
      password: ENROLLED_PASSWORD,
      totpSecret,
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
    const uid = crypto.randomUUID().slice(0, 6);
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
      await salesPage.locator(`a[href='/staff/providers/${providerId}/branches/new']`).click();
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
      await salesPage.click("button:has-text('Submit for Review')");
      await salesPage.waitForSelector("text=Submission Summary & Review");
      await salesPage.click("button:has-text('Submit for Operations Review')");
      await salesPage.waitForSelector("text=Confirm Submission for Operations Review");
      await salesPage.click("button:has-text('Yes, Submit for Review')");

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
      await opsPage.click("button:has-text('Vet & Activate')");
      await opsPage.waitForSelector("text=Confirm Branch Activation");

      await opsPage.check("#check-legal-identity");
      await opsPage.check("#check-physical-location");
      await opsPage.check("#check-contact-hours");
      await opsPage.fill("#evidence-document-ref", `DOC-REAL-OPS-${uid}`);

      await opsPage.locator("div[role='dialog'] button:has-text('Activate Branch')").click();
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
