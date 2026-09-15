import { test, expect } from "@playwright/test";

test.describe("WaffarhaCars Acceptance Test Suite (Strict Deterministic Coverage)", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to baseline home before each test
    await page.goto("/");
  });

  test("1. Golden Path: Home search -> Results -> Detail -> Reserve free -> Confirm -> Pass Card", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("text=WaffarhaCars").first()).toBeVisible();

    // Interact with category on home to navigate to results
    const browseBtn = page.locator("a:has-text('Browse Maintenance Offers')").first();
    await browseBtn.click();
    await expect(page).toHaveURL(/.*results/);

    // Results page: Verify locked price EGP 960
    await expect(page.locator("text=EGP 960").first()).toBeVisible();

    // Click offer detail
    await page.click("text=View Details & Lock Price");
    await expect(page).toHaveURL(/.*offers\/offer-oil-change-sunny/);

    // Verify scope & locked price on detail page
    await expect(page.locator("text=EGP 960").first()).toBeVisible();

    // Click Reserve Free CTA
    await page.click("text=Reserve free");
    await expect(page).toHaveURL(/.*reserve\/offer-oil-change-sunny/);

    // Review reservation: Due now EGP 0, Pay center EGP 960
    await expect(page.locator("text=EGP 0").first()).toBeVisible();
    await expect(page.locator("text=EGP 960").first()).toBeVisible();

    // Accept terms and confirm reservation
    await page.check("input[type=checkbox]");
    await page.click("button:has-text('Confirm Free Reservation')");

    // Land on My Reservations: Pass code WC-7492, status confirmed
    await expect(page).toHaveURL(/.*my-reservations/);
    await expect(page.locator("text=WC-7492")).toBeVisible();
    await expect(page.locator("text=PIN Issued Upon Arrival")).toBeVisible();
    await expect(page.locator("text=EGP 960").first()).toBeVisible();
  });

  test("2. Price Parity & Scope Consistency across Offer, Customer Pass, and Provider Terminal", async ({
    page,
  }) => {
    // Ensure active reservation exists
    await page.goto("/results");
    await page.click("text=View Details & Lock Price");

    // Check offer inclusions and exclusions on offer detail page
    await expect(
      page.locator("text=4 Litres Standard Synthetic 5W-30 fully synthetic motor oil").first()
    ).toBeVisible();
    await expect(
      page.locator("text=Standard matching oil filter replacement").first()
    ).toBeVisible();
    await expect(
      page.locator("text=Engine air filter or cabin AC filter replacement").first()
    ).toBeVisible();

    // Complete reservation
    await page.click("text=Reserve free");
    await page.check("input[type=checkbox]");
    await page.click("button:has-text('Confirm Free Reservation')");
    await expect(page).toHaveURL(/.*my-reservations/);

    // 1. Customer pass shows locked price EGP 960 and identical inclusions/exclusions
    await expect(page.locator("text=EGP 960").first()).toBeVisible();
    await expect(
      page.locator("text=4 Litres Standard Synthetic 5W-30 fully synthetic motor oil").first()
    ).toBeVisible();
    await expect(
      page.locator("text=Engine air filter or cabin AC filter replacement").first()
    ).toBeVisible();

    // 2. Provider reception check-in shows locked price EGP 960 and full agreed scope (inclusions AND exclusions)
    await page.goto("/provider/check-in");
    await expect(page.locator("text=WC-7492")).toBeVisible();
    await expect(page.locator("text=EGP 960").first()).toBeVisible();
    const providerScope = page.locator("[data-testid='provider-agreed-scope']");
    await expect(providerScope).toBeVisible();
    await expect(
      providerScope.locator("text=4 Litres Standard Synthetic 5W-30 fully synthetic motor oil")
    ).toBeVisible();
    await expect(
      providerScope.locator("text=Engine air filter or cabin AC filter replacement")
    ).toBeVisible();
    await expect(
      providerScope.locator("text=Major mechanical repairs or engine oil flush")
    ).toBeVisible();

    // 3. Provider completion terminal shows locked price EGP 960
    await page.goto("/provider/complete");
    await expect(page.locator("text=EGP 960").first()).toBeVisible();
  });

  test("3. Incompatible Vehicle Blocks Reservation", async ({ page }) => {
    await page.goto("/");

    // Change vehicle selector to BMW 330i (incompatible with Sunny-only oil package)
    await page.click("text=Change Vehicle");
    await page.click("text=2023 BMW 330i M-Sport");

    // Navigate to Sunny offer detail
    await page.goto("/offers/offer-oil-change-sunny");

    // Verify incompatible alert banner appears
    await expect(page.locator("text=Incompatible with your").first()).toBeVisible();
    // Reservation button should be disabled
    const reserveBtn = page.locator("button:has-text('Incompatible Vehicle')").first();
    await expect(reserveBtn).toBeDisabled();
  });

  test("4. Missing Price Evidence Blocks Sales Submission (Segregation of Duties)", async ({
    page,
  }) => {
    await page.goto("/sales/new-offer");
    await expect(page.locator("text=Sales Partner Onboarding Wizard").first()).toBeVisible();

    // Attempt submit without uploading evidence
    await page.click("button:has-text('Submit for Operations Approval')");

    // Must show validation rejection
    await expect(
      page.locator(
        "text=Submission Blocked: You must attach valid normal price evidence before submitting."
      )
    ).toBeVisible();

    // Verify segregation of duties notice is visible
    await expect(
      page.locator("text=Sales representatives cannot publish offers directly")
    ).toBeVisible();
  });

  test("5. Operations Can Approve Draft into Customer-Facing Catalogue", async ({ page }) => {
    await page.goto("/sales/new-offer");

    // Simulate price evidence upload
    await page.click("button:has-text('Simulate Attaching Price Card (PDF)')");
    await expect(page.locator("text=orbit_heliopolis_official_price_card_2026.pdf")).toBeVisible();

    // Submit draft
    await page.click("button:has-text('Submit for Operations Approval')");
    await expect(
      page.locator("text=Draft successfully submitted! It is now pending Operations verification.")
    ).toBeVisible();

    // Navigate to Ops approvals
    await page.goto("/ops/approvals");
    await expect(page.locator("text=Sales Drafts Awaiting Verification")).toBeVisible();

    // Unconditional approval click using deterministic data-testid
    const approveBtn = page.locator("[data-testid='approve-draft-button']").first();
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // Verify newly approved offer is published into customer catalogue
    await page.goto("/results");
    await expect(page.locator("text=Standard Synthetic Oil Service (4L)").first()).toBeVisible();
  });

  test("6. Provider Check-in Creates Zero Commission", async ({ page }) => {
    // Pre-seed confirmed reservation
    await page.goto("/results");
    await page.click("text=View Details & Lock Price");
    await page.click("text=Reserve free");
    await page.check("input[type=checkbox]");
    await page.click("button:has-text('Confirm Free Reservation')");
    await page.waitForURL(/.*my-reservations/);

    // Go to provider reception
    await page.goto("/provider/check-in");
    await expect(page.locator("text=Participating Workshop — Reception Terminal")).toBeVisible();

    // Check in customer
    await page.click("button:has-text('Check In Customer')");
    await expect(page.locator("text=Customer Checked In").first()).toBeVisible();

    // Verify accrued commission remains exactly 0
    await page.goto("/ops/approvals");
    await expect(page.locator("text=Completed Services").first()).toBeVisible();
    await expect(page.locator("text=EGP 0").first()).toBeVisible();
    await expect(page.locator("text=No commission accruals recorded yet")).toBeVisible();
  });

  test("7. Wrong PIN Fails Safely (Ledger Unchanged); Expired PIN Fails Safely", async ({
    page,
  }) => {
    // Part A: Wrong PIN
    await page.goto("/results");
    await page.click("text=View Details & Lock Price");
    await page.click("text=Reserve free");
    await page.check("input[type=checkbox]");
    await page.click("button:has-text('Confirm Free Reservation')");
    await page.waitForURL(/.*my-reservations/);

    await page.goto("/provider/check-in");
    await page.click("button:has-text('Check In Customer')");

    await page.goto("/my-reservations");
    await page.click("button:has-text('Reveal PIN')");
    await expect(page.locator("text=4921")).toBeVisible();

    // Enter WRONG PIN in provider complete terminal
    await page.goto("/provider/complete");
    await page.fill("[data-testid='provider-pin-input']", "0000");
    await page.click("[data-testid='confirm-complete-button']");

    // Verify error rejection
    await expect(page.locator("[data-testid='completion-result-title']")).toHaveText(
      "PIN Verification / Completion Failed"
    );
    await expect(page.locator("[data-testid='completion-result-message']")).toContainText(
      "Incorrect completion PIN"
    );

    // Verify reservation remains checked_in at revision 3 and zero commission
    await expect(page.locator("[data-testid='provider-completion-status']")).toContainText(
      "checked_in (rev 3)"
    );
    await expect(page.locator("[data-testid='provider-completion-accruals']")).toContainText(
      "0 record (EGP 0)"
    );

    // Verify Ops ledger contains exactly zero rows and EGP 0
    await page.goto("/ops/approvals");
    await expect(page.locator("[data-testid='ops-kpi-accrued-commission']")).toHaveText("EGP 0");
    await expect(page.locator("[data-testid='ops-empty-ledger-row']")).toBeVisible();
    await expect(page.locator("[data-testid='ops-commission-row']")).toHaveCount(0);

    // Part B: Expired PIN Scenario
    await page.click("[data-testid='open-drawer-button']");
    await page.click("[data-testid='scenario-option-expired_pin']");
    await page.click("[data-testid='close-drawer-button']");

    await page.goto("/provider/complete");
    await page.fill("[data-testid='provider-pin-input']", "4921");
    await page.click("[data-testid='confirm-complete-button']");

    // Verify explicit expired PIN error
    await expect(page.locator("[data-testid='completion-result-title']")).toHaveText(
      "PIN Verification / Completion Failed"
    );
    await expect(page.locator("[data-testid='completion-result-message']")).toContainText(
      "Completion PIN has expired"
    );

    // Invariants: Reservation remains checked_in, revision is 3 (unchanged), zero commission
    await expect(page.locator("[data-testid='provider-completion-status']")).toContainText(
      "checked_in (rev 3)"
    );
    await expect(page.locator("[data-testid='provider-completion-accruals']")).toContainText(
      "0 record (EGP 0)"
    );

    // Verify Ops ledger remains zero rows and EGP 0
    await page.goto("/ops/approvals");
    await expect(page.locator("[data-testid='ops-kpi-accrued-commission']")).toHaveText("EGP 0");
    await expect(page.locator("[data-testid='ops-empty-ledger-row']")).toBeVisible();
    await expect(page.locator("[data-testid='ops-commission-row']")).toHaveCount(0);
  });

  test("8. Valid PIN Creates Exactly One EGP 96 Accrual; Competing Command Rejected", async ({
    page,
  }) => {
    // Complete normal flow
    await page.goto("/results");
    await page.click("text=View Details & Lock Price");
    await page.click("text=Reserve free");
    await page.check("input[type=checkbox]");
    await page.click("button:has-text('Confirm Free Reservation')");
    await page.waitForURL(/.*my-reservations/);

    await page.goto("/provider/check-in");
    await page.click("button:has-text('Check In Customer')");

    await page.goto("/my-reservations");
    await page.click("button:has-text('Reveal PIN')");

    await page.goto("/provider/complete");
    await page.fill("[data-testid='provider-pin-input']", "4921");
    await page.click("[data-testid='confirm-complete-button']");

    // Success banner appears with EGP 96 accrual
    await expect(page.locator("[data-testid='completion-result-title']")).toHaveText(
      "Completion Successfully Recorded!"
    );
    await expect(page.locator("text=EGP 96").first()).toBeVisible();

    // Attempt competing duplicate completion
    await page.click("[data-testid='simulate-duplicate-button']");
    await expect(page.locator("text=was already completed")).toBeVisible();

    // Verify on Ops page that exactly 1 completion and EGP 96 accrual exists
    await page.goto("/ops/approvals");
    await expect(page.locator("text=Completed Services").first()).toBeVisible();
    await expect(page.locator("[data-testid='ops-kpi-accrued-commission']")).toHaveText("EGP 96");
    // Exactly 1 row in the ledger table
    await expect(page.locator("[data-testid='ops-commission-row']")).toHaveCount(1);
  });

  test("9. Uncompleted Reservation Route Guard & Accessible Support Ticket Simulation", async ({
    page,
  }) => {
    // 1. Test route guard when uncompleted
    await page.goto("/my-reservations/res-uncompleted-fake/completed");
    await expect(page.locator("[data-testid='completed-page-guard']")).toBeVisible();
    await expect(page.locator("text=Service Not Completed Yet")).toBeVisible();

    // 2. Set up completed reservation via drawer
    await page.click("[data-testid='open-drawer-button']");
    await page.click("[data-testid='scenario-option-already_completed']");
    await page.click("[data-testid='close-drawer-button']");

    // Navigate to completed page for the completed reservation
    await page.goto("/my-reservations/res-sunny-7492/completed");
    await expect(page.locator("text=Service Completed & Verified")).toBeVisible();

    // Submit verified review
    await page.fill(
      "textarea",
      "Quick and professional service at Orbit Heliopolis. Paid exact locked price."
    );
    await page.click("button:has-text('Submit Verified Review')");
    await expect(
      page.locator("text=Thank you! Your verified review has been recorded.")
    ).toBeVisible();

    // Trigger simulated support escalation modal/banner
    await page.click("[data-testid='report-issue-button']");
    const supportBanner = page.locator("[data-testid='support-ticket-banner']");
    await expect(supportBanner).toBeVisible();
    await expect(supportBanner).toHaveAttribute("role", "status");
    await expect(supportBanner).toContainText("WC-SUPP-9021");

    // Dismiss support notice
    await page.click("button[aria-label='Dismiss notice']");
    await expect(supportBanner).not.toBeVisible();
  });

  test("10. Complete Arabic Critical Path Journey (Full RTL) & Touch Targets", async ({ page }) => {
    await page.goto("/");

    // Switch to Arabic
    await page.click("button:has-text('العربية')");

    // Verify HTML attributes
    const html = page.locator("html");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "ar");

    // Check Arabic branding and translations
    await expect(page.locator("text=وفّرها كارز").first()).toBeVisible();
    await expect(page.locator("text=احجز مجاناً").first()).toBeVisible();

    // Verify localized Arabic footer & disclaimer
    await expect(page.locator("[data-testid='footer-copyright']")).toHaveText(
      "© ٢٠٢٦ عرض وفّرها كارز التوضيحي. إطلاق مجمعات القاهرة."
    );
    await expect(page.locator("[data-testid='footer-disclaimer']")).toHaveText(
      "نسخة تجريبية تفاعلية — لا توجد حسابات حقيقية للعملاء أو مراكز الصيانة."
    );

    // Verify touch target sizes (minimum 44px height on interactive button)
    const reserveButton = page.locator("a:has-text('ابدأ بحجز صيانة مجاناً')").first();
    const box = await reserveButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    // Complete booking flow in Arabic
    await reserveButton.click();
    await expect(page).toHaveURL(/.*results/);
    await expect(page.locator("text=٩٦٠ ج.م").first()).toBeVisible();

    await page.click("[data-testid='view-details-button']");
    await page.click("[data-testid='reserve-cta-button']");
    await page.check("input[type=checkbox]");
    await page.click("button:has-text('تأكيد الحجز المجاني')");

    // My Reservations in Arabic
    await expect(page).toHaveURL(/.*my-reservations/);
    await expect(page.locator("text=WC-7492")).toBeVisible();
    await expect(page.locator("text=بطاقة الخصم الخاصة بك").first()).toBeVisible();

    // Check in customer on provider terminal in Arabic
    await page.goto("/provider/check-in");
    await expect(page.locator("text=محطة المركز المشارك — شاشة الاستقبال")).toBeVisible();
    await page.click("button:has-text('تسجيل وصول العميل')");
    await expect(page.locator("text=تم تسجيل الوصول").first()).toBeVisible();

    // Customer reveals PIN in Arabic
    await page.goto("/my-reservations");
    await page.click("[data-testid='reveal-pin-button']");
    await expect(page.locator("text=4921")).toBeVisible();

    // Provider completes service in Arabic
    await page.goto("/provider/complete");
    await expect(page.locator("text=إتمام الخدمة وتأكيد التحصيل").first()).toBeVisible();
    await expect(
      page.locator("text=أدخل رمز PIN المكون من ٤ أرقام من بطاقة العميل:").first()
    ).toBeVisible();
    await page.fill("[data-testid='provider-pin-input']", "4921");
    await page.click("[data-testid='confirm-complete-button']");

    // Success banner in Arabic
    await expect(page.locator("[data-testid='completion-result-title']")).toHaveText(
      "تم تسجيل الإتمام بنجاح!"
    );
    await expect(
      page.locator(
        "text=تم تأكيد الإتمام! تم قيد ٩٦ ج.م كعمولة مستحقة لوفّرها كارز في دفتر الحسابات."
      )
    ).toBeVisible();
  });
});
