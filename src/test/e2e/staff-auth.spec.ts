import { test, expect } from "@playwright/test";

test.describe("Internal Staff Authentication & Mandatory TOTP E2E Journey", () => {
  test("1. Full Staff Provisioning Activation Flow (Login -> Activate Password -> MFA Enroll -> Staff Landing)", async ({
    page,
  }) => {
    let lifecycleState = "PASSWORD_CHANGE_REQUIRED";

    // Intercept Better Auth sign in
    await page.route("**/api/auth/sign-in/email", async (route) => {
      const body = route.request().postDataJSON();
      if (body.email === "engineer@waffarhacars.com" && body.password === "TemporaryPass123!") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "Set-Cookie":
              "better-auth.session_token=mock-staff-token; Path=/; HttpOnly; SameSite=Lax",
          },
          body: JSON.stringify({
            token: "mock-staff-token",
            user: { id: "user-uuid-1", email: body.email, name: "Tarek Mostafa" },
          }),
        });
      } else {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ message: "Invalid email or password" }),
        });
      }
    });

    // Intercept Staff Status
    await page.route("**/api/v1/staff/auth/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          state: lifecycleState,
          user: {
            id: "user-uuid-1",
            email: "engineer@waffarhacars.com",
            name: "Tarek Mostafa",
          },
          membership: {
            department: "OPERATIONS",
            employeeNumber: "EMP-100200",
            status: "ACTIVE",
          },
        }),
      });
    });

    // Intercept Password Change
    await page.route("**/api/v1/staff/auth/change-password", async (route) => {
      const body = route.request().postDataJSON();
      if (
        body.currentPassword === "TemporaryPass123!" &&
        body.newPassword === "NewSecurePassword123!"
      ) {
        lifecycleState = "MFA_ENROLLMENT_REQUIRED";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Invalid current password" }),
        });
      }
    });

    // Intercept Enable 2FA
    await page.route("**/api/auth/two-factor/enable", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          method: "totp",
          totpURI:
            "otpauth://totp/WaffarhaCars:engineer@waffarhacars.com?secret=JBSWY3DPEHPK3PXP&issuer=WaffarhaCars&digits=6&period=30",
          backupCodes: [
            "code-01",
            "code-02",
            "code-03",
            "code-04",
            "code-05",
            "code-06",
            "code-07",
            "code-08",
            "code-09",
            "code-10",
          ],
        }),
      });
    });

    // Intercept Verify TOTP
    await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
      const body = route.request().postDataJSON();
      if (body.code === "123456") {
        lifecycleState = "ACTIVE";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: true }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ message: "Invalid code" }),
        });
      }
    });

    // Step 1: Login
    await page.goto("/staff/login");
    await expect(page.getByRole("heading", { name: "Internal Staff Sign In" })).toBeVisible();

    await page.fill("input[type='email']", "engineer@waffarhacars.com");
    await page.fill("input[type='password']", "TemporaryPass123!");
    await page.click("button[type='submit']");

    // Step 2: Redirect to Activate Password
    await page.waitForURL("**/staff/activate-password");
    await expect(page.getByRole("heading", { name: "Change Temporary Password" })).toBeVisible();

    await page.fill("input[placeholder='Enter your temporary password']", "TemporaryPass123!");
    await page.fill("input[placeholder='At least 12 characters']", "NewSecurePassword123!");
    await page.fill("input[placeholder='Re-enter your new password']", "NewSecurePassword123!");
    await page.click("button[type='submit']");

    // Step 3: Redirect to MFA Enroll
    await page.waitForURL("**/staff/mfa/enroll");
    await expect(
      page.getByRole("heading", { name: "Setup Mandatory Two-Factor Authentication" })
    ).toBeVisible();

    // Step 3a: Confirm password to start MFA
    await page.fill("input[type='password']", "NewSecurePassword123!");
    await page.click("button[type='submit']");

    // Step 3b: QR Code and Secret Key are displayed
    await expect(page.locator("svg[aria-label='QR Code for TOTP Setup']")).toBeVisible();
    await expect(page.locator("code")).toContainText("JBSWY3DPEHPK3PXP");

    // Enter 6-digit TOTP code
    await page.fill("input[placeholder='000000']", "123456");
    await page.click("button[type='submit']");

    // Step 3c: Backup codes displayed with acknowledgement checkbox
    await expect(page.getByText("One-Time Recovery Backup Codes")).toBeVisible();
    await expect(page.locator("text=code-01")).toBeVisible();
    await expect(page.locator("text=code-10")).toBeVisible();

    // Check acknowledgement and continue to portal
    await page.check("input[type='checkbox']");
    await page.click("button:has-text('Continue to Staff Portal')");

    // Step 4: Staff Portal Landing
    await page.waitForURL("**/staff");
    await expect(
      page.getByRole("heading", { name: "WaffarhaCars Internal Staff Portal" })
    ).toBeVisible();
    await expect(page.getByText("Tarek Mostafa")).toBeVisible();
    await expect(page.getByText("EMP-100200")).toBeVisible();
    await expect(page.getByText("Mandatory TOTP Enforced")).toBeVisible();
    await expect(
      page.getByText("Zero-Bypass Policy: Re-verification required on every session")
    ).toBeVisible();
  });

  test("2. Staff Login with 2FA Challenge Redirect & Verification Flow", async ({ page }) => {
    // Intercept login returning 2FA redirect
    await page.route("**/api/auth/sign-in/email", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "Set-Cookie":
            "better-auth.two_factor=challenge-cookie-val; Path=/; HttpOnly; SameSite=Lax",
        },
        body: JSON.stringify({
          twoFactorRedirect: true,
          twoFactorMethods: ["totp"],
        }),
      });
    });

    // Intercept 2FA verify
    await page.route("**/api/auth/two-factor/verify-totp", async (route) => {
      const body = route.request().postDataJSON();
      if (body.code === "654321") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "Set-Cookie":
              "better-auth.session_token=mock-staff-active-session; Path=/; HttpOnly; SameSite=Lax",
          },
          body: JSON.stringify({ status: true }),
        });
      } else {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ message: "Invalid code" }),
        });
      }
    });

    // Intercept Staff Status as Active
    await page.route("**/api/v1/staff/auth/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          state: "ACTIVE",
          user: { id: "user-uuid-1", email: "admin@waffarhacars.com", name: "Staff Specialist" },
          membership: { department: "ADMIN", employeeNumber: "EMP-999888", status: "ACTIVE" },
        }),
      });
    });

    await page.goto("/staff/login");
    await page.fill("input[type='email']", "admin@waffarhacars.com");
    await page.fill("input[type='password']", "MySecurePassword123!");
    await page.click("button[type='submit']");

    // Redirected to MFA verify
    await page.waitForURL("**/staff/mfa/verify");
    await expect(page.getByRole("heading", { name: "Two-Factor Verification" })).toBeVisible();

    await page.fill("input[placeholder='000000']", "654321");
    await page.click("button[type='submit']");

    // Lands on /staff
    await page.waitForURL("**/staff");
    await expect(
      page.getByRole("heading", { name: "WaffarhaCars Internal Staff Portal" })
    ).toBeVisible();
    await expect(page.getByText("EMP-999888")).toBeVisible();
  });
});
