import { test, expect } from "@playwright/test";

test.describe("Customer Mobile Phone OTP Authentication Flow", () => {
  test("1. English LTR: Validates Egyptian phone, requests OTP, enters 6-digit code, and authenticates", async ({
    page,
  }) => {
    // Intercept backend auth requests for deterministic E2E flow
    await page.route("**/api/v1/auth/phone/request", async (route) => {
      const body = route.request().postDataJSON();
      if (body.phone.includes("01012345678") || body.phone.includes("+201012345678")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ accepted: true }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: "application/problem+json",
          body: JSON.stringify({
            status: 400,
            title: "Invalid Phone Number",
            detail: "Please provide a valid Egyptian mobile phone number",
          }),
        });
      }
    });

    await page.route("**/api/v1/auth/phone/verify", async (route) => {
      const body = route.request().postDataJSON();
      if (body.code === "123456") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "Set-Cookie":
              "better-auth.session_token=mock-session-token; Path=/; HttpOnly; SameSite=Lax",
          },
          body: JSON.stringify({
            authenticated: true,
            isNewCustomer: true,
          }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: "application/problem+json",
          body: JSON.stringify({
            status: 400,
            title: "Invalid Verification Code",
            detail: "The verification code is incorrect, expired, or has already been used.",
          }),
        });
      }
    });

    await page.goto("/auth/login");
    await expect(page.locator("[data-testid='customer-login-card']")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Customer Sign In" })).toBeVisible();

    // 1. Enter invalid phone number and assert validation
    const phoneInput = page.locator("[data-testid='phone-input']");
    await phoneInput.fill("0223456789"); // Landline
    await page.click("[data-testid='send-otp-button']");
    await expect(page.locator("[data-testid='phone-error']")).toBeVisible();

    // 2. Enter valid Egyptian mobile number
    await phoneInput.fill("01012345678");
    await page.click("[data-testid='send-otp-button']");

    // 3. Verify transition to Step 2 (OTP Entry)
    await expect(page.getByRole("heading", { name: "Enter Verification Code" })).toBeVisible();
    await expect(page.locator("[data-testid='masked-phone']")).toHaveText("+20 10 **** 5678");
    await expect(page.locator("[data-testid='countdown-timer']")).toBeVisible();

    // 4. Enter invalid code and assert error
    await page.locator("[data-testid='otp-box-0']").fill("0");
    await page.locator("[data-testid='otp-box-1']").fill("0");
    await page.locator("[data-testid='otp-box-2']").fill("0");
    await page.locator("[data-testid='otp-box-3']").fill("0");
    await page.locator("[data-testid='otp-box-4']").fill("0");
    await page.locator("[data-testid='otp-box-5']").fill("0");
    await page.click("[data-testid='verify-otp-button']");
    await expect(page.locator("[data-testid='otp-error']")).toBeVisible();

    // 5. Paste valid code (123456) and verify authentication success
    await page.locator("[data-testid='otp-box-0']").focus();
    await page.evaluate(() => {
      const input = document.querySelector("[data-testid='otp-box-0']") as HTMLInputElement;
      const event = new ClipboardEvent("paste", {
        clipboardData: new DataTransfer(),
        bubbles: true,
      });
      event.clipboardData?.setData("text", "123456");
      input?.dispatchEvent(event);
    });

    await page.click("[data-testid='verify-otp-button']");
    await expect(page.locator("[data-testid='auth-success-message']")).toBeVisible();
  });

  test("2. Arabic RTL: Normalizes Arabic numerals, provides edit number flow, and supports RTL layout", async ({
    page,
  }) => {
    await page.route("**/api/v1/auth/phone/request", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ accepted: true }),
      });
    });

    await page.goto("/auth/login");

    // Switch to Arabic via toggle if currently in English
    const arToggle = page.locator("button:has-text('عربي')");
    if (await arToggle.isVisible()) {
      await arToggle.click();
    }

    // Verify RTL direction on login card
    const card = page.locator("[data-testid='customer-login-card']");
    await expect(card).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "تسجيل دخول العملاء" })).toBeVisible();

    // Fill phone using Arabic-Indic digits: ٠١٠١٢٣٤٥٦٧٨
    const phoneInput = page.locator("[data-testid='phone-input']");
    await phoneInput.fill("٠١٠١٢٣٤٥٦٧٨");
    await page.click("[data-testid='send-otp-button']");

    // Verify step 2 loaded in Arabic
    await expect(page.getByRole("heading", { name: "أدخل رمز التحقق" })).toBeVisible();
    await expect(page.locator("[data-testid='masked-phone']")).toHaveText("+20 10 **** 5678");

    // Test "Edit number" button returns to Step 1 with preserved phone
    await page.click("[data-testid='edit-phone-button']");
    await expect(page.getByRole("heading", { name: "تسجيل دخول العملاء" })).toBeVisible();
    await expect(page.locator("[data-testid='phone-input']")).toHaveValue("01012345678");
  });
});
