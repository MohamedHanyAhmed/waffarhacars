import { test, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const repoScreenshotsDir = path.join(process.cwd(), "artifacts", "screenshots");

if (!fs.existsSync(repoScreenshotsDir)) {
  fs.mkdirSync(repoScreenshotsDir, { recursive: true });
}

async function captureScreenshot(page: Page, filename: string) {
  const repoPath = path.join(repoScreenshotsDir, filename);
  // Ensure scroll position zero
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: repoPath,
    fullPage: true,
    animations: "disabled",
  });
}

test.describe("WaffarhaCars Visual Inspection & Screenshot Capture", () => {
  test.setTimeout(90000);

  test("Capture all 8 required review surfaces", async ({ browser }) => {
    // 1. Mobile English Home (390x844)
    const mobileEnContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "en-US",
    });
    const page1 = await mobileEnContext.newPage();
    await page1.goto("/");
    await page1.waitForSelector("text=WaffarhaCars");
    await captureScreenshot(page1, "mobile_en_home.png");
    await mobileEnContext.close();

    // 2. Mobile Arabic RTL Home (390x844)
    const mobileArContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "ar-EG",
    });
    const page2 = await mobileArContext.newPage();
    await page2.goto("/");
    await page2.click("button:has-text('العربية')");
    await page2.waitForSelector("text=وفّرها كارز");
    await page2.waitForSelector("text=٢٠٢٦");
    await captureScreenshot(page2, "mobile_ar_rtl.png");
    await mobileArContext.close();

    // 3. Desktop English Home (1440x900)
    const desktopEnContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
    const page3 = await desktopEnContext.newPage();
    await page3.goto("/");
    await page3.waitForSelector("text=WaffarhaCars");
    await captureScreenshot(page3, "desktop_en_home.png");

    // 4. Desktop Arabic RTL Home (1440x900)
    await page3.click("button:has-text('العربية')");
    await page3.waitForSelector("text=وفّرها كارز");
    await page3.waitForSelector("text=٢٠٢٦");
    await captureScreenshot(page3, "desktop_ar_rtl.png");

    // Switch back to English for remaining flows
    await page3.click("button:has-text('English')");
    await page3.waitForTimeout(200);

    // 5. Provider Checked-In Surface
    // First, reserve a service
    await page3.goto("/results");
    await page3.click("text=View Details & Lock Price");
    await page3.click("text=Reserve free");
    await page3.check("input[type=checkbox]");
    await page3.click("button:has-text('Confirm Free Reservation')");
    await page3.waitForURL(/.*my-reservations/);
    await page3.waitForSelector("text=WC-7492");

    // Check in arrival on provider terminal
    await page3.goto("/provider/check-in");
    await page3.waitForSelector("button:has-text('Check In Customer')");
    await page3.click("button:has-text('Check In Customer')");
    await page3.waitForSelector("text=Customer Checked In");
    await captureScreenshot(page3, "provider_checked_in.png");

    // 6. Provider Complete Success Surface
    // Reveal PIN on customer side
    await page3.goto("/my-reservations");
    await page3.waitForSelector("button:has-text('Reveal PIN')");
    await page3.click("button:has-text('Reveal PIN')");
    await page3.waitForSelector("text=4921");

    // Enter PIN on provider terminal and confirm completion
    await page3.goto("/provider/complete");
    await page3.waitForSelector("[data-testid='provider-pin-input']");
    await page3.fill("[data-testid='provider-pin-input']", "4921");
    await page3.click("[data-testid='confirm-complete-button']");
    await page3.waitForSelector("[data-testid='completion-result-title']");
    await captureScreenshot(page3, "provider_complete_success.png");

    // 7. Operations Commission Ledger Surface
    await page3.goto("/ops/approvals");
    await page3.waitForSelector("[data-testid='ops-kpi-accrued-commission']");
    await captureScreenshot(page3, "ops_commission_ledger.png");

    // 8. Sales Missing Evidence Error Surface
    await page3.goto("/sales/new-offer");
    await page3.waitForSelector("button:has-text('Submit for Operations Approval')");
    await page3.click("button:has-text('Submit for Operations Approval')");
    await page3.waitForSelector(
      "text=Submission Blocked: You must attach valid normal price evidence before submitting."
    );
    await captureScreenshot(page3, "sales_missing_evidence_error.png");

    await desktopEnContext.close();
  });
});
