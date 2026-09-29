import { test, expect } from "@playwright/test";
import pg from "pg";
import crypto from "node:crypto";
import { getPrisma, disconnectDb } from "@/lib/db";
import { provisionStaffMember } from "@/lib/staff/provisioning";

const DEFAULT_TEST_DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";

const TEST_SECRET =
  process.env.BETTER_AUTH_SECRET || "ci-non-production-test-secret-at-least-32-chars-long";

function createSignedSessionCookie(token: string, secret: string = TEST_SECRET): string {
  const signature = crypto.createHmac("sha256", secret).update(token).digest("base64");
  return `${token}.${signature}`;
}

test.describe("Real PostgreSQL Staff Provider Onboarding & Operations Vetting E2E", () => {
  let isDbReachable = false;
  const createdUserEmails: string[] = [];
  const createdProviderIds: string[] = [];

  test.beforeAll(async () => {
    const probe = new pg.Client({
      connectionString: DEFAULT_TEST_DB_URL,
      connectionTimeoutMillis: 3000,
    });
    try {
      await probe.connect();
      const res = await probe.query("SELECT 1 AS probe");
      if (res.rows[0]?.probe === 1) {
        isDbReachable = true;
      }
    } catch {
      isDbReachable = false;
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

  async function createRealStaffSession(
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
        password: "ValidStaffPassword123!",
        fullName: "System Admin Bootstrap",
        employeeNumber: `BOOT-${uid}`,
        department: "ADMIN",
        isBootstrap: true,
      });
    }

    const provisionResult = await provisionStaffMember({
      email,
      password: "ValidStaffPassword123!",
      fullName: `Real Staff ${role}`,
      employeeNumber: `EMP-${uid}`,
      department: dept,
      role,
      isBootstrap: false,
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: provisionResult.userId },
      include: { internalStaffMembership: true },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true },
    });

    await prisma.twoFactor.create({
      data: {
        userId: user.id,
        secret: "JBSWY3DPEHPK3PXP",
        backupCodes: "[]",
        verified: true,
      },
    });

    await prisma.internalStaffMembership.update({
      where: { userId: user.id },
      data: { mustChangePassword: false, isActive: true },
    });

    const sessionToken = `test-session-${crypto.randomUUID()}`;
    await prisma.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(),
      },
    });

    return {
      user,
      cookieValue: createSignedSessionCookie(sessionToken),
    };
  }

  test("executes real PostgreSQL Sales onboarding, organization editing, Operations vetting/activation, and Arabic pass", async ({
    page,
    context,
  }) => {
    test.skip(
      !isDbReachable,
      "PostgreSQL test container is not reachable. Skipping real DB E2E test."
    );

    const prisma = getPrisma();
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    // Create real staff members
    const sales = await createRealStaffSession("SALES_AGENT", "SALES");
    const ops = await createRealStaffSession("OPS_SUPERVISOR", "OPERATIONS");

    // 1. Authenticate Sales in browser via real session cookie
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: encodeURIComponent(sales.cookieValue),
        domain: "localhost",
        path: "/",
      },
    ]);

    // 2. Sales visits provider directory
    await page.goto("/staff/providers");
    await expect(page.locator("text=Provider Organizations").first()).toBeVisible();

    // 3. Sales creates draft provider organization
    await page.locator("a[href='/staff/providers/new']:visible").first().click();
    await page.waitForURL("**/staff/providers/new");

    await page.fill("#legalName", `Real Automotive Services ${uid} S.A.E.`);
    await page.fill("#nameEn", `Real Auto Care ${uid}`);
    await page.fill("#nameAr", `مركز الصيانة الحقيقي ${uid}`);
    await page.fill("#taxId", taxId);
    await page.fill("#crNumber", `CR-REAL-${uid}`);
    await page.selectOption("#primaryCluster", "NASR_CITY_HELIOPOLIS");
    await page.fill("#contactPerson", "Youssef Zaki");
    await page.fill("#contactEmail", `youssef-${uid}@realauto.eg`);
    await page.fill("#contactPhone", "+201012345678");

    await page.click("button[type='submit']");
    await page.waitForURL(/\/staff\/providers\/[0-9a-f-]+$/);

    // Extract provider ID from URL
    const providerUrl = page.url();
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
    await page.locator("#edit-provider-details-link").click();
    await page.waitForURL(`**/staff/providers/${providerId}/edit`);

    // Update English name and legal entity name
    await page.fill("#nameEn", `Real Auto Care ${uid} Updated`);
    await page.fill("#legalName", `Real Automotive Services ${uid} Updated S.A.E.`);
    await page.click("#save-provider-edit-btn");
    await page.waitForURL(`**/staff/providers/${providerId}`);

    // Verify DB record was updated to version 2
    const dbProviderAfterEdit = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: providerId },
    });
    expect(dbProviderAfterEdit.nameEn).toBe(`Real Auto Care ${uid} Updated`);
    expect(dbProviderAfterEdit.version).toBe(2);

    // 5. Sales creates physical branch draft
    await page.locator(`a[href='/staff/providers/${providerId}/branches/new']`).click();
    await page.waitForURL(`**/staff/providers/${providerId}/branches/new`);

    await page.fill("#branchCode", `BR-REAL-${uid}`);
    await page.fill("#branchNameEn", `Nasr City Center ${uid}`);
    await page.fill("#branchNameAr", `فرع مدينة نصر ${uid}`);
    await page.fill("#streetEn", "10 Tayaran Street");
    await page.fill("#streetAr", "١٠ شارع الطيران");
    await page.fill("#branch-latitude", "30.0543");
    await page.fill("#branch-longitude", "31.3321");
    await page.fill("#branchContactPhone", "+201098765432");

    // Explicitly confirm actual operating hours
    await page.check("#confirm-operating-hours");

    await page.click("button[type='submit']");
    await page.waitForURL(`**/staff/providers/${providerId}`);

    // Verify branch was created in DB
    const dbBranch = await prisma.providerBranch.findFirstOrThrow({
      where: { providerOrganizationId: providerId },
    });
    expect(dbBranch.status).toBe("DRAFT");
    expect(dbBranch.branchCode).toBe(`BR-REAL-${uid}`);
    expect(Number(dbBranch.latitude)).toBeCloseTo(30.0543, 4);
    expect(Number(dbBranch.longitude)).toBeCloseTo(31.3321, 4);

    // 6. Sales submits provider for review
    await page.click("button:has-text('Submit for Review')");
    await page.waitForSelector("text=Submission Summary & Review");
    await page.click("button:has-text('Submit for Operations Review')");
    await page.waitForSelector("text=Confirm Submission for Operations Review");
    await page.click("button:has-text('Yes, Submit for Review')");

    await expect(page.locator("text=Pending Review").first()).toBeVisible();

    // Verify DB provider transitioned to PENDING_REVIEW (version 3)
    const dbProviderPending = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: providerId },
    });
    expect(dbProviderPending.status).toBe("PENDING_REVIEW");
    expect(dbProviderPending.version).toBe(3);

    // 7. Switch session to Operations Reviewer
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: encodeURIComponent(ops.cookieValue),
        domain: "localhost",
        path: "/",
      },
    ]);

    // 8. Operations visits pending queue
    await page.goto("/staff/ops/pending");
    await expect(page.locator(`text=Real Auto Care ${uid} Updated`).first()).toBeVisible();

    // Inspect provider
    await page.goto(`/staff/providers/${providerId}`);
    await expect(page.locator("text=Pending Review").first()).toBeVisible();

    // 9. Operations vets and activates branch
    await page.click("button:has-text('Vet & Activate')");
    await page.waitForSelector("text=Confirm Branch Activation");

    await page.check("#check-legal-identity");
    await page.check("#check-physical-location");
    await page.check("#check-contact-hours");
    await page.fill("#evidence-document-ref", `DOC-REAL-OPS-${uid}`);

    await page.locator("div[role='dialog'] button:has-text('Activate Branch')").click();
    await page.waitForTimeout(500);

    // Verify branch in DB is ACTIVE
    const dbBranchActive = await prisma.providerBranch.findUniqueOrThrow({
      where: { id: dbBranch.id },
    });
    expect(dbBranchActive.status).toBe("ACTIVE");
    expect(dbBranchActive.legalIdentityChecked).toBe(true);
    expect(dbBranchActive.physicalLocationChecked).toBe(true);
    expect(dbBranchActive.contactAndHoursChecked).toBe(true);
    expect(dbBranchActive.evidenceDocumentRef).toBe(`DOC-REAL-OPS-${uid}`);
    expect(dbBranchActive.vettedAt).not.toBeNull();

    // 10. Operations activates provider
    const activateProviderBtn = page.locator("button:has-text('Activate Provider')").first();
    await expect(activateProviderBtn).toBeEnabled();
    await activateProviderBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator("text=Active (Vetted)").first()).toBeVisible();
    await expect(page.locator("text=Offers not configured").first()).toBeVisible();

    // Verify DB provider is ACTIVE
    const dbProviderActive = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: providerId },
    });
    expect(dbProviderActive.status).toBe("ACTIVE");
    expect(dbProviderActive.activatedAt).not.toBeNull();

    // 11. Arabic Pass: switch to Arabic and verify RTL layout & LTR data fields
    await context.addCookies([
      {
        name: "NEXT_LOCALE",
        value: "ar",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.goto(`/staff/providers/${providerId}`);
    await page.waitForSelector("text=نشط (معتمد)");

    // Assert root dir is rtl
    const pageDir = await page.locator("div[dir='rtl']").first();
    await expect(pageDir).toBeVisible();

    // Assert sensitive fields maintain dir="ltr"
    const ltrTaxId = page.locator("p[dir='ltr']").filter({ hasText: taxId });
    await expect(ltrTaxId).toBeVisible();

    const ltrPhone = page.locator("p[dir='ltr']").filter({ hasText: "+201012345678" });
    await expect(ltrPhone).toBeVisible();
  });
});
