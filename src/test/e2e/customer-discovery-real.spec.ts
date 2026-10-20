import { expect, test, type Page, type Route } from "@playwright/test";
import pg from "pg";
import {
  customerDiscoveryFixture,
  withdrawDiscoveryFixtures,
  type DiscoveryFixture,
} from "./helpers/customer-discovery-fixtures";

let f: DiscoveryFixture;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cards = (page: Page) => page.getByTestId("discovery-offer-card");
const detail = (page: Page) => page.getByTestId("discovery-detail");
const coverage = (page: Page) => page.getByTestId("discovery-coverage");
// Next's route announcer also has role=alert, outside the application landmark.
const alert = (page: Page) => page.locator("main").getByRole("alert");
const offerPath = (id: string) => `/customer/offers/${id}`;
async function choose(page: Page, category: string) {
  await page.getByTestId("discovery-category").selectOption(category);
}
async function noDemoOrPrivateClaims(page: Page) {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator('a[href^="/reserve"],a[href^="/my-reservations"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Demo Scenarios", exact: true })).toHaveCount(0);
  await expect(page.locator("img")).toHaveCount(0);
  const html = await page.content();
  for (const privateValue of [
    f.provider.contactEmail,
    f.provider.contactPhone,
    `CI:PRIVATE:BRANCH:${f.uid}`,
    `CI:PRIVATE:FITMENT:${f.uid}`,
    `PRIVATE_PRICE_${f.uid}`,
    `PRIVATE_TERMS_${f.uid}`,
    f.maker.email,
    f.checker.email,
  ])
    expect(html).not.toContain(privateValue);
  expect(await page.locator("body").innerText()).not.toMatch(
    /\b(?:4\.9|reviews|slots left|in stock|open now)\b/i
  );
  expect(await page.context().cookies()).toEqual([]);
}
async function unchangedReadState() {
  return {
    revisions: await f.db.offerRevision.findMany({
      where: { offerId: { in: f.offerIds } },
      orderBy: { id: "asc" },
    }),
    publications: await f.db.offerPublication.findMany({
      where: { offerId: { in: f.offerIds } },
      orderBy: { offerId: "asc" },
    }),
    receipts: await f.db.offerPublicationCommand.count({ where: { offerId: { in: f.offerIds } } }),
    audit: await f.db.securityAuditEvent.count({
      where: { actorUserId: { in: [f.maker.id, f.checker.id] } },
    }),
  };
}
test.beforeAll(async () => {
  f = await customerDiscoveryFixture();
});
test.afterAll(async () => {
  if (f) await withdrawDiscoveryFixtures(f);
});

test("anonymous English and Arabic mobile and desktop show actual published prices, scope, hours and finite coverage without demo controls", async ({
  page,
}) => {
  const before = await unchangedReadState();
  const target = f.offers[0];
  for (const variant of [
    { locale: "en", width: 390, label: "english-mobile" },
    { locale: "ar", width: 390, label: "arabic-mobile" },
    { locale: "en", width: 1440, label: "english-desktop" },
    { locale: "ar", width: 1440, label: "arabic-desktop" },
  ]) {
    await page.setViewportSize({ width: variant.width, height: 844 });
    await page.goto("/customer/offers");
    await expect(cards(page).first()).toBeVisible();
    const desiredDir = variant.locale === "ar" ? "rtl" : "ltr";
    if ((await page.locator("html").getAttribute("dir")) !== desiredDir)
      await page.getByTestId("discovery-locale").click();
    await expect(page.locator("html")).toHaveAttribute("dir", desiredDir);
    await choose(page, "CAR_WASH");
    await expect(cards(page)).toHaveCount(10);
    const title = variant.locale === "ar" ? target.titleAr : target.titleEn;
    await expect(cards(page).filter({ hasText: title })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", variant.locale);
    await noDemoOrPrivateClaims(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`customer-discovery-${variant.label}-list.png`),
      fullPage: true,
    });
    await cards(page).filter({ hasText: title }).getByRole("link").click();
    await expect(detail(page)).toContainText(title);
    await expect(detail(page)).toContainText(
      variant.locale === "ar" ? "خدمة تنظيف واحدة محددة" : "One fixed cleaning service"
    );
    await expect(detail(page)).toContainText(
      variant.locale === "ar" ? "مواد التنظيف المذكورة" : "Listed cleaning materials"
    );
    await expect(detail(page)).toContainText(
      variant.locale === "ar" ? "الإصلاح والفحص" : "Repairs and diagnosis"
    );
    await expect(detail(page)).toContainText(
      variant.locale === "ar" ? f.branch.streetAddressAr : f.branch.streetAddressEn
    );
    await expect(detail(page)).toContainText("09:00");
    await expect(detail(page)).toContainText("18:00");
    await expect(coverage(page)).toContainText(
      variant.locale === "ar" ? f.make.nameAr : f.make.nameEn
    );
    await expect(coverage(page)).toContainText(
      variant.locale === "ar" ? f.model.nameAr : f.model.nameEn
    );
    await expect(coverage(page)).toContainText("2020");
    await expect(coverage(page)).toContainText("2024");
    const offerResponse = await page.request.get(`/api/v1/offers/${target.offerId}`);
    expect(offerResponse.status()).toBe(200);
    expect(offerResponse.headers()["cache-control"]).toContain("no-store");
    expect(await offerResponse.json()).toMatchObject({
      offerId: target.offerId,
      revisionId: target.revisionId,
      normalPriceMinor: "100000",
      customerPriceMinor: "80000",
      savingsMinor: "20000",
      discountRateBps: "2000",
    });
    // Numeric formatting is localized; the actual API remains the authority.
    await expect(detail(page)).toContainText(variant.locale === "ar" ? "٨٠٠" : "800");
    await expect(
      page.getByText(variant.locale === "ar" ? /لم يتم التحقق/ : /not.*checked/i).first()
    ).toBeVisible();
    await expect(
      page
        .getByText(variant.locale === "ar" ? /الحجز.*غير متاح/ : /reservations.*not available/i)
        .first()
    ).toBeVisible();
    await noDemoOrPrivateClaims(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.getByTestId("discovery-back").focus();
    await expect(page.getByTestId("discovery-back")).toBeFocused();
    await page.screenshot({
      path: test.info().outputPath(`customer-discovery-${variant.label}-detail.png`),
      fullPage: true,
    });
    await page.getByTestId("discovery-back").click();
    await expect(page).toHaveURL(/\/customer\/offers(?:\?|$)/);
    await expect(page.locator("html")).toHaveAttribute("lang", variant.locale);
  }
  expect(await unchangedReadState()).toEqual(before);
});

test("real category and cluster filters plus cursor continuation remain bounded and deduplicate a double load-more click", async ({
  page,
}) => {
  await page.goto("/customer/offers");
  await choose(page, "CAR_WASH");
  await expect(cards(page)).toHaveCount(10);
  const started = deferred(),
    release = deferred(),
    settled = deferred();
  let pageRequests = 0;
  await page.route("**/api/v1/offers?*", async (route) => {
    if (!new URL(route.request().url()).searchParams.has("cursor")) return route.continue();
    pageRequests += 1;
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    started.resolve();
    await release.promise;
    try {
      await route.fulfill({ response: actual });
    } finally {
      settled.resolve();
    }
  });
  try {
    await page.getByTestId("discovery-load-more").evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await started.promise;
    await expect(page.getByTestId("discovery-load-more")).toBeDisabled();
    release.resolve();
    await settled.promise;
    await expect(cards(page)).toHaveCount(12);
    expect(pageRequests).toBe(1);
    const hrefs = await cards(page)
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(new Set(hrefs).size).toBe(12);
    expect(hrefs.sort()).toEqual(
      f.offers
        .filter((offer) => offer.code === "CAR_WASH")
        .map((offer) => offerPath(offer.offerId))
        .sort()
    );
    await choose(page, "ACCESSORIES");
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toContainText(f.offers[12].titleEn);
    await page.getByTestId("discovery-cluster").selectOption("MAADI");
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByRole("status")).not.toBeEmpty();
    await expect(page.getByTestId("discovery-retry")).toHaveCount(0);
    await page.getByTestId("discovery-cluster").selectOption("NASR_CITY_HELIOPOLIS");
    await expect(cards(page)).toHaveCount(1);
  } finally {
    release.resolve();
    await page.unroute("**/api/v1/offers?*");
  }
});

test("a delayed genuine old-filter result cannot overwrite the newer category", async ({
  page,
}) => {
  await page.goto("/customer/offers");
  await expect(cards(page).first()).toBeVisible();
  const started = deferred(),
    release = deferred(),
    settled = deferred();
  await page.route("**/api/v1/offers?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("category") !== "ACCESSORIES")
      return route.continue();
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    started.resolve();
    await release.promise;
    try {
      await route.fulfill({ response: actual });
    } catch {
      /* Obsolete fetch may already be aborted. */
    } finally {
      settled.resolve();
    }
  });
  try {
    await choose(page, "ACCESSORIES");
    await started.promise;
    await choose(page, "CAR_WASH");
    await expect(cards(page)).toHaveCount(10);
    release.resolve();
    await settled.promise;
    await expect(cards(page)).toHaveCount(10);
    await expect(cards(page).filter({ hasText: f.offers[12].titleEn })).toHaveCount(0);
    await expect(page.getByTestId("discovery-category")).toHaveValue("CAR_WASH");
  } finally {
    release.resolve();
    await page.unroute("**/api/v1/offers?*");
  }
});

test("a delayed genuine cursor page cannot append after a filter reset", async ({ page }) => {
  await page.goto("/customer/offers");
  await choose(page, "CAR_WASH");
  await expect(cards(page)).toHaveCount(10);
  const started = deferred(),
    release = deferred(),
    settled = deferred();
  await page.route("**/api/v1/offers?*", async (route) => {
    if (!new URL(route.request().url()).searchParams.has("cursor")) return route.continue();
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    started.resolve();
    await release.promise;
    try {
      await route.fulfill({ response: actual });
    } catch {
      /* Cancellation is expected. */
    } finally {
      settled.resolve();
    }
  });
  try {
    await page.getByTestId("discovery-load-more").click();
    await started.promise;
    await choose(page, "ACCESSORIES");
    await expect(cards(page)).toHaveCount(1);
    release.resolve();
    await settled.promise;
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toContainText(f.offers[12].titleEn);
  } finally {
    release.resolve();
    await page.unroute("**/api/v1/offers?*");
  }
});

test("publication replacement between actual detail and coverage reads rejects mixed revisions until an explicit fresh retry", async ({
  page,
}) => {
  const target = f.offers[1];
  const actualDetailReady = deferred(),
    releaseCoverage = deferred();
  let held = true;
  const detailPath = `/api/v1/offers/${target.offerId}`;
  await page.route(`**${detailPath}`, async (route) => {
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    if (held) actualDetailReady.resolve();
    await route.fulfill({ response: actual });
  });
  await page.route(`**${detailPath}/fitment`, async (route) => {
    if (held) await releaseCoverage.promise;
    await route.fulfill({ response: await route.fetch() });
  });
  try {
    await page.goto(offerPath(target.offerId));
    await actualDetailReady.promise;
    const successor = await f.revision(target.offerId, target.code, 2);
    await f.db.offerPublication.update({
      where: { offerId: target.offerId },
      data: { pinnedRevisionId: successor.id, version: { increment: 1 } },
    });
    releaseCoverage.resolve();
    await expect(alert(page)).toBeVisible();
    await expect(detail(page)).toHaveCount(0);
    await expect(coverage(page)).toHaveCount(0);
    held = false;
    await page.getByTestId("discovery-retry").click();
    await expect(detail(page)).toContainText(successor.titleEn);
    await expect(coverage(page)).toContainText(f.model.nameEn);
    expect(
      await f.db.offerPublication.findUniqueOrThrow({ where: { offerId: target.offerId } })
    ).toMatchObject({ pinnedRevisionId: successor.id, version: 2 });
  } finally {
    releaseCoverage.resolve();
    await page.unroute(`**${detailPath}`);
    await page.unroute(`**${detailPath}/fitment`);
  }
});

test("late actual detail bytes cannot hydrate a different offer after navigation", async ({
  page,
}) => {
  const old = f.offers[2],
    current = f.offers[3];
  const started = deferred(),
    release = deferred(),
    settled = deferred();
  await page.route(`**/api/v1/offers/${old.offerId}`, async (route: Route) => {
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    started.resolve();
    await release.promise;
    try {
      await route.fulfill({ response: actual });
    } catch {
      /* Navigation cancels the old request. */
    } finally {
      settled.resolve();
    }
  });
  try {
    await page.goto(offerPath(old.offerId));
    await started.promise;
    await page.getByTestId("discovery-back").click();
    await choose(page, "CAR_WASH");
    await expect(cards(page).filter({ hasText: current.titleEn })).toBeVisible();
    await cards(page).filter({ hasText: current.titleEn }).getByRole("link").click();
    await expect(detail(page)).toContainText(current.titleEn);
    release.resolve();
    await settled.promise;
    await expect(detail(page)).toContainText(current.titleEn);
    await expect(detail(page)).not.toContainText(old.titleEn);
  } finally {
    release.resolve();
    await page.unroute(`**/api/v1/offers/${old.offerId}`);
  }
});

test("a genuine database read timeout is unavailable rather than empty, releases its bounded lock and recovers without data writes", async ({
  page,
}) => {
  const databaseUrl = process.env.DATABASE_URL;
  expect(process.env.CI).toBe("true");
  expect(process.env.APP_RUNTIME_PROFILE).toBe("showcase");
  expect(process.env.APP_DATA_BACKEND).toBe("postgres");
  expect(databaseUrl).toBeTruthy();
  const blocker = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  const observer = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  const detailPage = await page.context().newPage();
  const coverageObserved = deferred();
  let locked = false;
  let blockerDisconnected = false;
  blocker.on("error", () => {
    blockerDisconnected = true;
    coverageObserved.resolve();
  });
  await blocker.connect();
  try {
    await observer.connect();
    const identity = await blocker.query<{ name: string; pid: number }>(
      "SELECT current_database() AS name, pg_backend_pid() AS pid"
    );
    expect(identity.rows[0].name).toBe("waffarhacars_test");
    await detailPage.goto(offerPath(f.offers[0].offerId));
    await expect(coverage(detailPage)).toContainText(f.model.nameEn);
    // Both reads are genuine. Delay the detail error's delivery so the
    // coverage error is observable before Promise.all cancels its sibling.
    await detailPage.route(`**/api/v1/offers/${f.offers[0].offerId}`, async (route) => {
      const actual = await route.fetch();
      await coverageObserved.promise;
      try {
        await route.fulfill({ response: actual });
      } catch {
        /* Sibling failure cancels this request. */
      }
    });
    const before = await unchangedReadState();
    await blocker.query("BEGIN");
    locked = true;
    await blocker.query("SET LOCAL idle_in_transaction_session_timeout = '12s'");
    await blocker.query("SET LOCAL lock_timeout = '2s'");
    await blocker.query("LOCK TABLE offer_publications IN ACCESS EXCLUSIVE MODE");
    const response = page.waitForResponse(
      (item) => new URL(item.url()).pathname === "/api/v1/offers"
    );
    const coverageFailure = detailPage.waitForResponse(
      (item) => new URL(item.url()).pathname === `/api/v1/offers/${f.offers[0].offerId}/fitment`
    );
    await detailPage.getByTestId("discovery-refresh").click();
    await page.goto("/customer/offers");
    await expect
      .poll(
        async () =>
          (
            await observer.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))",
              [identity.rows[0].pid]
            )
          ).rows[0].count
      )
      .toBeGreaterThanOrEqual(1);
    const failed = await response;
    expect(failed.status()).toBe(503);
    expect((await coverageFailure).status()).toBe(503);
    // Release the real sibling response before reading browser response bodies.
    // Holding a routing callback while awaiting a different response body can
    // stall Playwright's shared protocol; it is not an application DB timeout.
    coverageObserved.resolve();
    expect(await failed.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
    expect(failed.headers()["cache-control"]).toContain("no-store");
    await expect(alert(detailPage)).toBeVisible();
    await expect(detail(detailPage)).toHaveCount(0);
    await expect(coverage(detailPage)).toHaveCount(0);
    await expect(alert(page)).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByTestId("discovery-retry")).toBeEnabled();
    await blocker.query("ROLLBACK");
    locked = false;
    expect(blockerDisconnected).toBe(false);
    expect(await unchangedReadState()).toEqual(before);
    await page.getByTestId("discovery-retry").click();
    await expect(cards(page).first()).toBeVisible();
    await detailPage.getByTestId("discovery-retry").click();
    await expect(coverage(detailPage)).toContainText(f.model.nameEn);
    expect(await unchangedReadState()).toEqual(before);
    await noDemoOrPrivateClaims(page);
  } finally {
    coverageObserved.resolve();
    try {
      if (locked && !blockerDisconnected) await blocker.query("ROLLBACK");
    } finally {
      await Promise.all([blocker.end(), observer.end()]);
      await detailPage.close();
    }
  }
});

test("invalid query and missing detail have safe deliberate recovery without demo fallback", async ({
  page,
}) => {
  await page.goto("/customer/offers?category=not-a-category&cursor=invalid");
  await expect(alert(page)).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByTestId("discovery-retry")).toBeEnabled();
  await page.getByTestId("discovery-retry").click();
  await expect(cards(page).first()).toBeVisible();
  await page.goto("/customer/offers/00000000-0000-4000-8000-000000000000");
  await expect(alert(page)).toBeVisible();
  await expect(detail(page)).toHaveCount(0);
  await expect(coverage(page)).toHaveCount(0);
  await noDemoOrPrivateClaims(page);
});

test("explicit and focus refresh remove stale success after actual withdrawal, provider pause, expired replacement and capability withdrawal", async ({
  page,
}) => {
  const target = f.offers[4];
  await page.goto(offerPath(target.offerId));
  await expect(coverage(page)).toContainText(f.model.nameEn);
  await f.db.offerPublication.update({
    where: { offerId: target.offerId },
    data: { status: "UNPUBLISHED", unpublishedAt: new Date(), version: { increment: 1 } },
  });
  await page.getByTestId("discovery-refresh").click();
  await expect(alert(page)).toBeVisible();
  await expect(detail(page)).toHaveCount(0);
  await expect(coverage(page)).toHaveCount(0);
  expect((await page.request.get(`/api/v1/offers/${target.offerId}`)).status()).toBe(404);

  const paused = f.offers[5];
  await page.goto(offerPath(paused.offerId));
  await expect(detail(page)).toBeVisible();
  await f.db.providerOrganization.update({
    where: { id: f.provider.id },
    data: { status: "PAUSED", version: { increment: 1 } },
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(alert(page)).toBeVisible();
    await expect(detail(page)).toHaveCount(0);
    await expect(coverage(page)).toHaveCount(0);
  } finally {
    await f.db.providerOrganization.update({
      where: { id: f.provider.id },
      data: { status: "ACTIVE", version: { increment: 1 } },
    });
  }
  const expiring = f.offers[6];
  await page.goto(offerPath(expiring.offerId));
  await expect(detail(page)).toBeVisible();
  const expired = await f.revision(expiring.offerId, expiring.code, 2, true);
  await f.db.offerPublication.update({
    where: { offerId: expiring.offerId },
    data: { pinnedRevisionId: expired.id, version: { increment: 1 } },
  });
  await page.getByTestId("discovery-refresh").click();
  await expect(alert(page)).toBeVisible();
  await expect(coverage(page)).toHaveCount(0);
  expect((await page.request.get(`/api/v1/offers/${expiring.offerId}`)).status()).toBe(404);

  const capabilityTarget = f.offers[12];
  await page.goto(offerPath(capabilityTarget.offerId));
  await expect(coverage(page)).toContainText(f.model.nameEn);
  const definition = await f.db.serviceDefinition.findUniqueOrThrow({
    where: { code: `DISC_ACCESSORIES_${f.uid}` },
  });
  const current = await f.db.branchCapabilityCurrent.findUniqueOrThrow({
    where: { branchId_categoryId: { branchId: f.branch.id, categoryId: definition.categoryId } },
  });
  await f.db.$transaction(async (tx) => {
    await tx.branchCapabilityVersion.update({
      where: { id: current.activeVersionId! },
      data: { status: "WITHDRAWN", withdrawnAt: new Date(), version: { increment: 1 } },
    });
    await tx.branchCapabilityCurrent.update({
      where: { branchId_categoryId: { branchId: f.branch.id, categoryId: definition.categoryId } },
      data: { activeVersionId: null, version: { increment: 1 } },
    });
  });
  await page.getByTestId("discovery-refresh").click();
  await expect(alert(page)).toBeVisible();
  await expect(detail(page)).toHaveCount(0);
  await expect(coverage(page)).toHaveCount(0);
  expect(
    (await page.request.get(`/api/v1/offers/${capabilityTarget.offerId}/fitment`)).status()
  ).toBe(404);
  expect(
    await f.db.branchCapabilityVersion.findUniqueOrThrow({
      where: { id: current.activeVersionId! },
    })
  ).toMatchObject({ status: "WITHDRAWN", version: 4 });
  expect(
    await f.db.branchCapabilityCurrent.findUniqueOrThrow({
      where: { branchId_categoryId: { branchId: f.branch.id, categoryId: definition.categoryId } },
    })
  ).toMatchObject({ activeVersionId: null, version: 2 });
});
