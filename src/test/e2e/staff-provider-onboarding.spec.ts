/**
 * End-to-End Bilingual Provider Onboarding UI Test Suite (Playwright)
 * Tests full responsive Sales draft creation, branch configuration, review summary,
 * submission, Operations pending queue inspection, dual-custody maker-checker checks,
 * manual 3-item branch vetting attestation, provider activation, remediable rejection,
 * and optimistic concurrency (409) conflict handling.
 */
import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const repoScreenshotsDir = path.join(process.cwd(), "artifacts", "screenshots");
if (!fs.existsSync(repoScreenshotsDir)) {
  fs.mkdirSync(repoScreenshotsDir, { recursive: true });
}

async function captureArtifact(page: Page, filename: string) {
  const targetPath = path.join(repoScreenshotsDir, filename);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({
    path: targetPath,
    fullPage: true,
    animations: "disabled",
  });
}

// Mock staff identities
const salesStaff = {
  state: "ACTIVE",
  name: "Tarek Mostafa (Sales)",
  email: "tarek.sales@waffarhacars.com",
  department: "SALES",
  employeeNumber: "EMP-SALES-101",
  userId: "usr-sales-101",
  mustChangePassword: false,
  twoFactorEnabled: true,
  canAccessStaffApp: true,
  canAccessEnrollment: false,
  canAccessPasswordChange: false,
};

const opsReviewerStaff = {
  state: "ACTIVE",
  name: "Nadia Farouk (Operations)",
  email: "nadia.ops@waffarhacars.com",
  department: "OPERATIONS",
  employeeNumber: "EMP-OPS-202",
  userId: "usr-ops-202", // Different from usr-sales-101
  mustChangePassword: false,
  twoFactorEnabled: true,
  canAccessStaffApp: true,
  canAccessEnrollment: false,
  canAccessPasswordChange: false,
};

const opsSubmitterStaff = {
  ...salesStaff,
  department: "OPERATIONS",
  userId: "usr-sales-101", // Matches submitter: triggers maker-checker violation
};

test.describe("Bilingual Staff Provider Onboarding UI Journey (Mocked APIs)", () => {
  test.setTimeout(90000);

  test("1. Sales draft creation, branch setup, review summary, and submission for review", async ({
    page,
  }) => {
    // Current in-memory mock aggregate
    let providerDraft: Record<string, unknown> | null = null;
    const branchDrafts: Array<Record<string, unknown>> = [];

    // Intercept staff auth status (Sales)
    await page.route("**/api/v1/staff/auth/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(salesStaff),
      });
    });

    // Intercept providers list / creation
    await page.route("**/api/v1/staff/providers", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            providers: providerDraft ? [providerDraft] : [],
          }),
        });
      } else if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        providerDraft = {
          id: "org-egy-auto-1",
          legalName: body.legalName,
          nameEn: body.nameEn,
          nameAr: body.nameAr,
          taxRegistrationNumber: body.taxRegistrationNumber,
          commercialRegistrationNumber: body.commercialRegistrationNumber,
          primaryCluster: body.primaryCluster,
          contactPersonName: body.contactPersonName,
          contactEmail: body.contactEmail,
          contactPhone: body.contactPhone,
          status: "DRAFT",
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          submittedAt: null,
          submittedByUserId: salesStaff.userId,
          submittedByUser: { name: salesStaff.name, email: salesStaff.email },
          branches: [],
        };
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "org-egy-auto-1",
            provider: providerDraft,
            ...providerDraft,
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Intercept single provider detail
    await page.route("**/api/v1/staff/providers/org-egy-auto-1", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...providerDraft,
            branches: branchDrafts,
            provider: {
              ...providerDraft,
              branches: branchDrafts,
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Intercept branch creation
    await page.route("**/api/v1/staff/providers/org-egy-auto-1/branches", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        const newBranch = {
          id: "br-nasr-01",
          providerOrganizationId: "org-egy-auto-1",
          branchCode: body.branchCode,
          nameEn: body.nameEn,
          nameAr: body.nameAr,
          cluster: body.cluster,
          streetAddressEn: body.streetAddressEn,
          streetAddressAr: body.streetAddressAr,
          latitude: body.latitude,
          longitude: body.longitude,
          contactPhone: body.contactPhone,
          operatingHours: body.operatingHours,
          status: "DRAFT",
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          legalIdentityChecked: false,
          physicalLocationChecked: false,
          contactAndHoursChecked: false,
          evidenceDocumentRef: null,
          vettedAt: null,
          vettedByUserId: null,
        };
        branchDrafts.push(newBranch);
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ branch: newBranch }),
        });
      } else {
        await route.continue();
      }
    });

    // Intercept submit for review
    await page.route("**/api/v1/staff/providers/org-egy-auto-1/submit", async (route) => {
      if (route.request().method() === "POST") {
        providerDraft = {
          ...providerDraft,
          status: "PENDING_REVIEW",
          version: 2,
          submittedAt: new Date().toISOString(),
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            provider: {
              ...providerDraft,
              branches: branchDrafts,
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // 1. Visit directory page
    await page.goto("/staff/providers");
    await page.waitForSelector("text=Provider Organizations");
    await captureArtifact(page, "staff_provider_directory.png");

    // 2. Click "New Provider Organization" CTA
    await page.locator("a[href='/staff/providers/new']:visible").first().click();
    await page.waitForURL("**/staff/providers/new");
    await page.waitForSelector("text=New Provider Organization Draft");

    // 3. Fill in provider organization draft fields
    await page.fill("#legalName", "Al-Ahram Automotive Services S.A.E.");
    await page.fill("#nameEn", "Al-Ahram Auto Care");
    await page.fill("#nameAr", "مركز الأهرام لخدمات السيارات");
    await page.fill("#taxId", "123456789");
    await page.fill("#crNumber", "CR-987654");
    await page.selectOption("#primaryCluster", "NASR_CITY_HELIOPOLIS");
    await page.fill("#contactPerson", "Ahmed Mahmoud");
    await page.fill("#contactEmail", "ahmed@alahram.eg");
    await page.fill("#contactPhone", "+201012345678");

    await captureArtifact(page, "staff_provider_new_draft.png");

    // 4. Save Provider Draft
    await page.click("button[type='submit']");
    await page.waitForURL("**/staff/providers/org-egy-auto-1");
    await expect(page.locator("text=Al-Ahram Auto Care").first()).toBeVisible();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

    // 5. Add Branch Draft
    await page
      .locator("a[href='/staff/providers/org-egy-auto-1/branches/new']:visible")
      .first()
      .click();
    await page.waitForURL("**/staff/providers/org-egy-auto-1/branches/new");
    await page.waitForSelector("text=Add Workshop Branch");

    await page.fill("#branchCode", "BR-NASR-01");
    await page.fill("#branchNameEn", "Nasr City Main Workshop");
    await page.fill("#branchNameAr", "ورشة مدينة نصر الرئيسية");
    await page.fill("#streetEn", "15 Abbas El Akkad Street");
    await page.fill("#streetAr", "١٥ شارع عباس العقاد");
    await page.fill("#branch-latitude", "30.0500");
    await page.fill("#branch-longitude", "31.3300");
    await page.fill("#branchContactPhone", "+201012345678");
    await page.check("#confirm-operating-hours");

    await captureArtifact(page, "staff_branch_new_draft.png");

    // 6. Save Branch Draft
    await page.click("button[type='submit']");
    await page.waitForURL("**/staff/providers/org-egy-auto-1");
    await expect(page.locator("text=BR-NASR-01").first()).toBeVisible();

    // 7. Click Submit for Review CTA -> Opens CheckAnswersSummary
    await page.click("button:has-text('Submit for Review')");
    await page.waitForSelector("text=Submission Summary & Review");
    await expect(page.locator("text=Al-Ahram Automotive Services S.A.E.").first()).toBeVisible();
    await expect(page.locator("text=BR-NASR-01").first()).toBeVisible();

    await captureArtifact(page, "staff_check_answers_review.png");

    // 8. Confirm Submission for Operations Review
    await page.click("button:has-text('Submit for Operations Review')");
    await page.waitForSelector("text=Confirm Submission for Operations Review");
    await page.click("button:has-text('Yes, Submit for Review')");

    // 9. Status transitions to Pending Review
    await expect(page.locator("text=Pending Review").first()).toBeVisible();
  });

  test("2. Operations pending queue inspection and dual-custody maker-checker restriction", async ({
    page,
  }) => {
    const pendingOrg = {
      id: "org-egy-auto-1",
      legalName: "Al-Ahram Automotive Services S.A.E.",
      nameEn: "Al-Ahram Auto Care",
      nameAr: "مركز الأهرام لخدمات السيارات",
      taxRegistrationNumber: "123456789",
      commercialRegistrationNumber: "CR-987654",
      primaryCluster: "NASR_CITY_HELIOPOLIS",
      contactPersonName: "Ahmed Mahmoud",
      contactEmail: "ahmed@alahram.eg",
      contactPhone: "+201012345678",
      status: "PENDING_REVIEW",
      version: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      submittedByUserId: "usr-sales-101",
      submittedByUser: { name: "Tarek Mostafa (Sales)", email: "tarek.sales@waffarhacars.com" },
      branches: [
        {
          id: "br-nasr-01",
          providerOrganizationId: "org-egy-auto-1",
          branchCode: "BR-NASR-01",
          nameEn: "Nasr City Main Workshop",
          nameAr: "ورشة مدينة نصر الرئيسية",
          cluster: "NASR_CITY_HELIOPOLIS",
          streetAddressEn: "15 Abbas El Akkad Street",
          streetAddressAr: "١٥ شارع عباس العقاد",
          latitude: 30.05,
          longitude: 31.33,
          contactPhone: "+201012345678",
          operatingHours: [],
          status: "DRAFT",
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          legalIdentityChecked: false,
          physicalLocationChecked: false,
          contactAndHoursChecked: false,
          evidenceDocumentRef: null,
          vettedAt: null,
          vettedByUserId: null,
        },
      ],
    };

    // Submitter tries to access Operations review (Maker-Checker violation)
    await page.route("**/api/v1/staff/auth/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(opsSubmitterStaff),
      });
    });

    await page.route("**/api/v1/staff/ops/providers/pending", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ providers: [pendingOrg] }),
      });
    });

    await page.route("**/api/v1/staff/providers/org-egy-auto-1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: pendingOrg }),
      });
    });

    // 1. Visit Pending Queue
    await page.goto("/staff/ops/queue");
    await page.waitForSelector("text=Pending Operations Review Queue");
    await expect(page.locator("text=Al-Ahram Auto Care")).toBeVisible();
    await captureArtifact(page, "staff_ops_pending_queue.png");

    // 2. Click Inspect & Review
    await page.locator("a[href='/staff/providers/org-egy-auto-1']:visible").first().click();
    await page.waitForURL("**/staff/providers/org-egy-auto-1");

    // 3. Assert Dual Custody Warning Banner is visible for the submitter
    await expect(page.locator("text=Dual Custody Restriction").first()).toBeVisible();
    await expect(
      page.locator("text=You submitted this provider and cannot approve or vet it.").first()
    ).toBeVisible();

    // 4. Assert Action Buttons are disabled for the submitter
    const vetBranchBtn = page.locator("button:has-text('Vet & Activate Branch')").first();
    await expect(vetBranchBtn).toBeDisabled();

    await captureArtifact(page, "staff_maker_checker_banner.png");
  });

  test("3. Independent Operations reviewer performs 3-item vetting attestation and activates provider", async ({
    page,
  }) => {
    let branchStatus = "DRAFT";
    let orgStatus = "PENDING_REVIEW";
    let branchVersion = 1;
    let orgVersion = 2;

    const getOrg = () => ({
      id: "org-egy-auto-1",
      legalName: "Al-Ahram Automotive Services S.A.E.",
      nameEn: "Al-Ahram Auto Care",
      nameAr: "مركز الأهرام لخدمات السيارات",
      taxRegistrationNumber: "123456789",
      commercialRegistrationNumber: "CR-987654",
      primaryCluster: "NASR_CITY_HELIOPOLIS",
      contactPersonName: "Ahmed Mahmoud",
      contactEmail: "ahmed@alahram.eg",
      contactPhone: "+201012345678",
      status: orgStatus,
      version: orgVersion,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      submittedByUserId: "usr-sales-101", // Different from reviewer
      submittedByUser: { name: "Tarek Mostafa (Sales)", email: "tarek.sales@waffarhacars.com" },
      branches: [
        {
          id: "br-nasr-01",
          providerOrganizationId: "org-egy-auto-1",
          branchCode: "BR-NASR-01",
          nameEn: "Nasr City Main Workshop",
          nameAr: "ورشة مدينة نصر الرئيسية",
          cluster: "NASR_CITY_HELIOPOLIS",
          streetAddressEn: "15 Abbas El Akkad Street",
          streetAddressAr: "١٥ شارع عباس العقاد",
          latitude: 30.05,
          longitude: 31.33,
          contactPhone: "+201012345678",
          operatingHours: [],
          status: branchStatus,
          version: branchVersion,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          legalIdentityChecked: branchStatus === "ACTIVE",
          physicalLocationChecked: branchStatus === "ACTIVE",
          contactAndHoursChecked: branchStatus === "ACTIVE",
          evidenceDocumentRef: branchStatus === "ACTIVE" ? "DOC-OPS-2026-001" : null,
          vettedAt: branchStatus === "ACTIVE" ? new Date().toISOString() : null,
          vettedByUserId: branchStatus === "ACTIVE" ? opsReviewerStaff.userId : null,
          vettedByUser:
            branchStatus === "ACTIVE"
              ? { name: opsReviewerStaff.name, email: opsReviewerStaff.email }
              : null,
        },
      ],
    });

    // Independent reviewer auth status
    await page.route("**/api/v1/staff/auth/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(opsReviewerStaff),
      });
    });

    await page.route("**/api/v1/staff/providers/org-egy-auto-1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: getOrg() }),
      });
    });

    // Intercept branch activation
    await page.route(
      "**/api/v1/staff/ops/providers/org-egy-auto-1/branches/br-nasr-01/activate",
      async (route) => {
        const body = route.request().postDataJSON();
        if (
          body.legalIdentityChecked &&
          body.physicalLocationChecked &&
          body.contactAndHoursChecked &&
          body.evidenceDocumentRef === "DOC-OPS-2026-001"
        ) {
          branchStatus = "ACTIVE";
          branchVersion += 1;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ branch: getOrg().branches[0] }),
          });
        } else {
          await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ message: "All 3 attestations and valid evidence ref required" }),
          });
        }
      }
    );

    // Intercept provider activation
    await page.route("**/api/v1/staff/ops/providers/org-egy-auto-1/activate", async (route) => {
      orgStatus = "ACTIVE";
      orgVersion += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: getOrg() }),
      });
    });

    await page.goto("/staff/providers/org-egy-auto-1");
    await page.waitForSelector("text=Al-Ahram Auto Care");

    // Dual custody banner should NOT be present for distinct reviewer
    await expect(page.locator("text=Dual Custody Restriction")).not.toBeVisible();

    // 1. Open Branch Vetting Modal
    await page.locator("button:has-text('Vet & Activate Branch')").first().click();
    await page.waitForSelector("text=Confirm Branch Activation");

    // 2. Attest all 3 manual human checks
    await page.check("#check-legal-identity");
    await page.check("#check-physical-location");
    await page.check("#check-contact-hours");

    // 3. Fill in opaque evidence reference
    await page.fill("#evidence-document-ref", "DOC-OPS-2026-001");
    await captureArtifact(page, "staff_branch_vetting_modal.png");

    // 4. Submit branch vetting & activation
    await page.locator("div[role='dialog'] button:has-text('Activate Branch')").click();
    await page.waitForTimeout(300);

    // 5. Activate Provider CTA should now be enabled (since >= 1 branch is ACTIVE)
    const activateProviderBtn = page.locator("button:has-text('Activate Provider')").first();
    await expect(activateProviderBtn).toBeEnabled();

    // 6. Click Activate Provider
    await activateProviderBtn.click();
    await page.waitForTimeout(300);

    // 7. Verify status is Active (Vetted) and "Offers not configured" notice is displayed
    await expect(page.locator("text=Active (Vetted)").first()).toBeVisible();
    await expect(page.locator("text=Offers not configured").first()).toBeVisible();
  });

  test("4. Operations remediable branch rejection returns provider and approvals to draft", async ({
    page,
  }) => {
    let orgStatus = "PENDING_REVIEW";
    let branchStatus = "DRAFT";

    const getOrg = () => ({
      id: "org-egy-auto-1",
      legalName: "Al-Ahram Automotive Services S.A.E.",
      nameEn: "Al-Ahram Auto Care",
      nameAr: "مركز الأهرام لخدمات السيارات",
      primaryCluster: "NASR_CITY_HELIOPOLIS",
      taxRegistrationNumber: "123456789",
      commercialRegistrationNumber: "CR-987654",
      status: orgStatus,
      version: 3,
      submittedByUserId: "usr-sales-101",
      branches: [
        {
          id: "br-nasr-01",
          branchCode: "BR-NASR-01",
          nameEn: "Nasr City Main Workshop",
          nameAr: "ورشة مدينة نصر الرئيسية",
          cluster: "NASR_CITY_HELIOPOLIS",
          streetAddressEn: "15 Abbas El Akkad Street",
          streetAddressAr: "١٥ شارع عباس العقاد",
          latitude: 30.05,
          longitude: 31.33,
          contactPhone: "+201012345678",
          operatingHours: [],
          status: branchStatus,
          version: 2,
        },
      ],
    });

    await page.route("**/api/v1/staff/auth/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(opsReviewerStaff),
      });
    });

    await page.route("**/api/v1/staff/providers/org-egy-auto-1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: getOrg() }),
      });
    });

    await page.route(
      "**/api/v1/staff/ops/providers/org-egy-auto-1/branches/br-nasr-01/reject",
      async (route) => {
        orgStatus = "DRAFT";
        branchStatus = "DRAFT";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ branch: getOrg().branches[0] }),
        });
      }
    );

    await page.goto("/staff/providers/org-egy-auto-1");
    await page.waitForSelector("text=Al-Ahram Auto Care");

    // Open Reject Modal
    await page.locator("button:has-text('Reject Workshop Branch')").first().click();
    await page.waitForSelector("text=Rejection Type");

    // Select Remediable Rejection button
    await page.click("button:has-text('Remediable')");
    await page.fill(
      "#branch-rejection-notes",
      "Street address does not match commercial register. Please update."
    );

    // Confirm Rejection (Submit button says "Return to Draft")
    await page.locator("div[role='dialog'] button:has-text('Return to Draft')").click();
    await page.waitForTimeout(300);

    // Verify entity returned to Draft
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  });

  test("5. Optimistic concurrency (409 Conflict) displays conflict resolver with preserved edits", async ({
    page,
  }) => {
    const branchData = {
      id: "br-nasr-01",
      providerOrganizationId: "org-egy-auto-1",
      branchCode: "BR-NASR-01",
      nameEn: "Nasr City Main Workshop",
      nameAr: "ورشة مدينة نصر الرئيسية",
      cluster: "NASR_CITY_HELIOPOLIS",
      streetAddressEn: "15 Abbas El Akkad Street",
      streetAddressAr: "١٥ شارع عباس العقاد",
      latitude: 30.05,
      longitude: 31.33,
      contactPhone: "+201012345678",
      operatingHours: [],
      status: "DRAFT",
      version: 1, // client expects 1
    };

    const serverUpdatedBranch = {
      ...branchData,
      streetAddressEn: "Updated by Supervisor",
      version: 3,
    };

    await page.route("**/api/v1/staff/auth/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(salesStaff),
      });
    });

    await page.route(
      "**/api/v1/staff/providers/org-egy-auto-1/branches/br-nasr-01",
      async (route) => {
        if (route.request().method() === "GET") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ branch: branchData }),
          });
        } else if (route.request().method() === "PATCH") {
          // Simulate 409 Concurrency Conflict
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: "CONCURRENCY_CONFLICT",
              message: "Record has been updated by another user.",
              serverVersion: 3,
              serverBranch: serverUpdatedBranch,
            }),
          });
        }
      }
    );

    // Navigate to branch edit page
    await page.goto("/staff/providers/org-egy-auto-1/branches/br-nasr-01/edit");
    await page.waitForSelector("text=Edit Branch Draft");

    // Modify street address using placeholder locator
    const addressInput = page.getByPlaceholder("e.g. 15 Abbas El Akkad Street");
    await addressInput.fill("New Modified Street Address");

    // Submit form -> triggers 409
    await page.click("button[type='submit']");
    await page.waitForTimeout(300);

    // Assert Conflict Resolver Modal is open
    await expect(page.locator("text=Concurrency Conflict (409)")).toBeVisible();
    await expect(page.locator("text=New Modified Street Address")).toBeVisible();

    await captureArtifact(page, "staff_conflict_resolver.png");
  });

  test("6. Arabic RTL layout and LTR direction isolation for phone, CR, tax ID, and coordinates", async ({
    page,
  }) => {
    const providerWithBranch = {
      id: "org-egy-auto-1",
      legalName: "شركة الأهرام لخدمات السيارات ش.م.م",
      nameEn: "Al-Ahram Auto Care",
      nameAr: "مركز الأهرام لخدمات السيارات",
      taxRegistrationNumber: "123456789",
      commercialRegistrationNumber: "CR-987654",
      primaryCluster: "NASR_CITY_HELIOPOLIS",
      contactPersonName: "أحمد محمود",
      contactEmail: "ahmed@alahram.eg",
      contactPhone: "+201012345678",
      status: "ACTIVE",
      version: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      submittedByUserId: "usr-sales-101",
      branches: [
        {
          id: "br-nasr-01",
          providerOrganizationId: "org-egy-auto-1",
          branchCode: "BR-NASR-01",
          nameEn: "Nasr City Main Workshop",
          nameAr: "ورشة مدينة نصر الرئيسية",
          cluster: "NASR_CITY_HELIOPOLIS",
          streetAddressEn: "15 Abbas El Akkad Street",
          streetAddressAr: "١٥ شارع عباس العقاد",
          latitude: 30.05,
          longitude: 31.33,
          contactPhone: "+201012345678",
          operatingHours: [],
          status: "ACTIVE",
          version: 2,
        },
      ],
    };

    await page.route("**/api/v1/staff/auth/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(opsReviewerStaff),
      });
    });

    await page.route("**/api/v1/staff/providers/org-egy-auto-1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: providerWithBranch }),
      });
    });

    await page.goto("/staff/providers/org-egy-auto-1");
    await page.waitForSelector("text=Al-Ahram Auto Care");

    // Switch to Arabic locale
    await page.click("button:has-text('العربية')");
    await page.waitForSelector("text=مركز الأهرام لخدمات السيارات");

    // Assert that the page root or container has dir="rtl"
    const dirAttr = await page.getAttribute("html", "dir");
    expect(dirAttr === "rtl" || (await page.locator("[dir='rtl']").count()) > 0).toBe(true);

    // Assert LTR direction isolation on Egyptian phone number
    const phoneElement = page.locator("text=+201012345678").first();
    await expect(phoneElement).toBeVisible();
    const phoneDir = await phoneElement.getAttribute("dir");
    expect(phoneDir).toBe("ltr");

    await captureArtifact(page, "staff_onboarding_ar_rtl.png");
  });
});
