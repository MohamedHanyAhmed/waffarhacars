import { expect, test, type Page, type Response } from "@playwright/test";
import { deferred, fillDraft, fixture, journalKey } from "./helpers/capability-settlement-fixtures";

type Receipt = { command: { commandId: string; policyId: string; resultVersion: number } };

async function mutation(page: Page, api: string, action: string, control: string, status = 200) {
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === api + action && r.request().method() !== "GET"
  );
  await page.getByTestId(control).click();
  const actual = await response;
  expect(actual.status()).toBe(status);
  return (await actual.json()) as Receipt;
}

async function ready(page: Page, policyId: string, version: number) {
  const state = page.getByTestId("capability-form-state");
  await expect(state).toHaveAttribute("data-policy-id", policyId);
  await expect(state).toHaveAttribute("data-version", String(version));
  await expect(state).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("capability-policy")).toHaveValue(policyId);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), journalKey)).toBeNull();
}

test("CREATE settlement holds earliest edit until matching form hydration; edited request persists through distinct Operations approval", async ({
  browser,
}, info) => {
  const f = await fixture(browser, info.testId);
  try {
    const page = await f.pageFor("sales");
    await page.goto(f.workspace);
    await fillDraft(page, f, "CI:SETTLEMENT:INITIAL");
    const held = deferred();
    const release = deferred();
    f.releases.push(release.resolve);
    let interceptRead = true;
    await page.route(`**${f.api}`, async (route) => {
      if (route.request().method() !== "GET" || !interceptRead) return route.continue();
      interceptRead = false;
      // Fetch the actual authenticated response, then hold only delivery. No
      // policy, session or success response is fabricated by this barrier.
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      held.resolve();
      await release.promise;
      await route.fulfill({ response });
    });
    let mutations = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith(f.api) && request.method() !== "GET")
        mutations++;
    });
    const created = await mutation(page, f.api, "", "capability-create", 201);
    const policyId = created.command.policyId;
    await held.promise;
    const evidence = page.locator("#capability-evidence");
    await expect(evidence).toBeDisabled();
    await expect(page.getByTestId("capability-policy")).toBeDisabled();
    await expect(page.getByTestId("capability-new")).toBeDisabled();
    expect(
      await page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(key) ?? "null")?.commandId,
        journalKey
      )
    ).toBe(created.command.commandId);
    // Start a real next edit at the earliest boundary, while the real current
    // read remains held. It must wait for coherent form readiness, not lose the
    // entered value to a later queued authoritative reset.
    const editAttempt = evidence.fill("CI:SETTLEMENT:EDITED");
    // Synthetic click events deliberately exercise handler guards even where
    // controls are disabled/absent. They must not dispatch competing commands.
    await page.evaluate(() => {
      for (const id of [
        "capability-create",
        "capability-save",
        "capability-submit",
        "capability-new",
      ])
        document
          .querySelector(`[data-testid="${id}"]`)
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mutations).toBe(1);
    expect(
      await f.prisma.branchCapabilityVersion.findUniqueOrThrow({ where: { id: policyId } })
    ).toMatchObject({ version: 1, evidenceRef: "CI:SETTLEMENT:INITIAL", status: "DRAFT" });
    release.resolve();
    await editAttempt;
    await ready(page, policyId, 1);
    await expect(evidence).toHaveValue("CI:SETTLEMENT:EDITED");
    await expect(page.getByTestId("capability-submit")).toBeDisabled();

    // An ordinary authoritative refresh taken before a later local keystroke
    // cannot replace that dirty value or silently rebase its version.
    await evidence.fill("CI:SETTLEMENT:DIRTY");
    const lateHeld = deferred();
    const lateRelease = deferred();
    f.releases.push(lateRelease.resolve);
    interceptRead = true;
    await page.unroute(`**${f.api}`);
    await page.route(`**${f.api}`, async (route) => {
      if (route.request().method() !== "GET" || !interceptRead) return route.continue();
      interceptRead = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      lateHeld.resolve();
      await lateRelease.promise;
      await route.fulfill({ response });
    });
    await page.getByTestId("capability-refresh").click();
    await lateHeld.promise;
    await expect(evidence).toBeDisabled();
    const latestEdit = evidence.fill("CI:SETTLEMENT:EDITED");
    lateRelease.resolve();
    await latestEdit;
    await expect(evidence).toHaveValue("CI:SETTLEMENT:EDITED");
    await ready(page, policyId, 1);
    const put = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === `${f.api}/${policyId}` && request.method() === "PUT"
    );
    const updated = await mutation(page, f.api, `/${policyId}`, "capability-save");
    expect((await put).postDataJSON()).toMatchObject({
      expectedVersion: 1,
      evidenceRef: "CI:SETTLEMENT:EDITED",
    });
    expect(updated.command.resultVersion).toBe(2);
    await ready(page, policyId, 2);
    await expect(evidence).toHaveValue("CI:SETTLEMENT:EDITED");
    expect(
      await f.prisma.branchCapabilityVersion.findUniqueOrThrow({ where: { id: policyId } })
    ).toMatchObject({ evidenceRef: "CI:SETTLEMENT:EDITED", version: 2, status: "DRAFT" });
    const submitted = await mutation(page, f.api, `/${policyId}/submit`, "capability-submit");
    expect(submitted.command.resultVersion).toBe(3);
    await ready(page, policyId, 3);
    expect(
      await f.prisma.branchCapabilityVersion.findUniqueOrThrow({ where: { id: policyId } })
    ).toMatchObject({
      evidenceRef: "CI:SETTLEMENT:EDITED",
      version: 3,
      status: "PENDING_REVIEW",
      submittedByUserId: f.sales.userId,
    });
    const opsPage = await f.pageFor("ops");
    await opsPage.goto(f.workspace);
    await expect(opsPage.locator(`#capability-policy option[value="${policyId}"]`)).toHaveCount(1);
    await opsPage.getByTestId("capability-policy").selectOption(policyId);
    await ready(opsPage, policyId, 3);
    await expect(opsPage.getByTestId("capability-form-state")).toContainText(
      "CI:SETTLEMENT:EDITED"
    );
    await expect(opsPage.getByTestId("capability-form-state")).not.toContainText(
      "CI:SETTLEMENT:INITIAL"
    );
    await expect(opsPage.getByTestId("capability-approve")).toBeDisabled();
    await opsPage.getByRole("checkbox").check();
    await opsPage.getByTestId("capability-approve").click();
    const approved = await mutation(opsPage, f.api, `/${policyId}/approve`, "capability-confirm");
    expect(approved.command.resultVersion).toBe(4);
    await ready(opsPage, policyId, 4);
    expect(
      await f.prisma.branchCapabilityVersion.findUniqueOrThrow({ where: { id: policyId } })
    ).toMatchObject({
      evidenceRef: "CI:SETTLEMENT:EDITED",
      version: 4,
      status: "ACTIVE",
      decidedByUserId: f.ops.userId,
    });
    expect(
      await f.prisma.branchCapabilityCurrent.findUniqueOrThrow({
        where: { branchId_categoryId: { branchId: f.branch.id, categoryId: f.category.id } },
      })
    ).toMatchObject({ activeVersionId: policyId });
    const receipts = await f.prisma.fitmentCommand.findMany({
      where: { domain: "CAPABILITY", resourceId: policyId },
      orderBy: { resultVersion: "asc" },
    });
    expect(
      receipts.map(({ action, resultVersion, actorUserId, outcome }) => ({
        action,
        resultVersion,
        actorUserId,
        outcome,
      }))
    ).toEqual([
      { action: "CREATE", resultVersion: 1, actorUserId: f.sales.userId, outcome: "APPLIED" },
      { action: "EDIT", resultVersion: 2, actorUserId: f.sales.userId, outcome: "APPLIED" },
      { action: "SUBMIT", resultVersion: 3, actorUserId: f.sales.userId, outcome: "APPLIED" },
      { action: "APPROVE", resultVersion: 4, actorUserId: f.ops.userId, outcome: "APPLIED" },
    ]);
    const audits = await f.prisma.securityAuditEvent.findMany({
      where: { targetEntity: `branch_capability:${policyId}` },
    });
    expect(audits.map(({ eventType }) => eventType).sort()).toEqual(
      [
        "BRANCH_CAPABILITY_DRAFT_CREATED",
        "BRANCH_CAPABILITY_DRAFT_UPDATED",
        "BRANCH_CAPABILITY_SUBMITTED",
        "BRANCH_CAPABILITY_APPROVED",
      ].sort()
    );
  } finally {
    await f.cleanup();
  }
});

test("committed CREATE with failed authoritative read remains locked until original receipt recheck hydrates current form", async ({
  browser,
}, info) => {
  const f = await fixture(browser, info.testId);
  try {
    const page = await f.pageFor("sales");
    await page.goto(f.workspace);
    await fillDraft(page, f, "CI:SETTLEMENT:READFAIL");
    const failed = deferred();
    let abortRead = true;
    await page.route(`**${f.api}`, async (route) => {
      if (route.request().method() !== "GET" || !abortRead) return route.continue();
      abortRead = false;
      // No fabricated failure/success payload: drop delivery of the actual read.
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      await route.abort("failed");
      failed.resolve();
    });
    const created = await mutation(page, f.api, "", "capability-create", 201);
    await failed.promise;
    const policyId = created.command.policyId;
    await expect(page.getByTestId("capability-recheck")).toBeEnabled();
    const journal = await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
      journalKey
    );
    expect(journal).toMatchObject({
      commandId: created.command.commandId,
      actorId: f.sales.userId,
      branchId: f.branch.id,
    });
    expect(JSON.stringify(journal)).not.toContain("READFAIL");
    await expect(page.getByTestId("capability-policy")).toBeDisabled();
    expect(await f.prisma.branchCapabilityVersion.count({ where: { branchId: f.branch.id } })).toBe(
      1
    );
    let replay: Response | null = null;
    const receiptRead = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" && response.url().includes(created.command.commandId)
    );
    await page.getByTestId("capability-recheck").click();
    replay = await receiptRead;
    expect(replay.status()).toBe(200);
    await ready(page, policyId, 1);
    await expect(page.locator("#capability-evidence")).toBeEnabled();
    await expect(page.locator("#capability-evidence")).toHaveValue("CI:SETTLEMENT:READFAIL");
    expect(
      await f.prisma.branchCapabilityVersion.findUniqueOrThrow({ where: { id: policyId } })
    ).toMatchObject({ version: 1, evidenceRef: "CI:SETTLEMENT:READFAIL", status: "DRAFT" });
    expect(
      await f.prisma.fitmentCommand.count({ where: { resourceId: policyId, domain: "CAPABILITY" } })
    ).toBe(1);
    expect(
      await f.prisma.securityAuditEvent.count({
        where: {
          targetEntity: `branch_capability:${policyId}`,
          eventType: "BRANCH_CAPABILITY_DRAFT_CREATED",
        },
      })
    ).toBe(1);
  } finally {
    await f.cleanup();
  }
});

test("reconstructed CREATE retry relocks evidence and coverage until its actual receipt and current form settle", async ({
  browser,
}, info) => {
  const f = await fixture(browser, info.testId);
  try {
    const page = await f.pageFor("sales");
    await page.goto(f.workspace);
    await fillDraft(page, f, "CI:SETTLEMENT:RECONSTRUCT");
    const undelivered = deferred();
    let original: Record<string, unknown> | undefined;
    await page.route(`**${f.api}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      original = route.request().postDataJSON() as Record<string, unknown>;
      await route.abort("failed");
      undelivered.resolve();
    });
    await page.getByTestId("capability-create").click();
    await undelivered.promise;
    await expect(page.getByTestId("capability-recheck")).toBeEnabled();
    expect(await f.prisma.branchCapabilityVersion.count({ where: { branchId: f.branch.id } })).toBe(
      0
    );
    expect(
      await f.prisma.fitmentCommand.count({ where: { commandId: String(original!.commandId) } })
    ).toBe(0);
    const originalJournal = await page.evaluate((key) => sessionStorage.getItem(key), journalKey);
    expect(originalJournal).not.toContain("RECONSTRUCT");
    await page.unroute(`**${f.api}`);
    await page.reload();
    const missing = page.waitForResponse(
      (r) => r.request().method() === "GET" && r.url().includes(String(original!.commandId))
    );
    await page.getByTestId("capability-recheck").click();
    expect((await missing).status()).toBe(404);
    await page.getByTestId("capability-restore").click();
    await fillDraft(page, f, "CI:SETTLEMENT:RECONSTRUCT");
    const failedRead = deferred();
    const held = deferred();
    const release = deferred();
    f.releases.push(release.resolve);
    let readNumber = 0;
    await page.route(`**${f.api}`, async (route) => {
      if (route.request().method() !== "GET" || readNumber >= 2) return route.continue();
      readNumber++;
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      if (readNumber === 1) {
        await route.abort("failed");
        failedRead.resolve();
        return;
      }
      held.resolve();
      await release.promise;
      await route.fulfill({ response: actual });
    });
    const retryRequest = page.waitForRequest(
      (r) => r.method() === "POST" && new URL(r.url()).pathname === f.api
    );
    let writes = 0;
    page.on("request", (r) => {
      if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith(f.api)) writes++;
    });
    const retried = await mutation(page, f.api, "", "capability-retry", 201);
    expect((await retryRequest).postDataJSON()).toEqual(original);
    expect(retried.command.commandId).toBe(original!.commandId);
    await failedRead.promise;
    // Pending is now false: the real retry committed and its receipt is known,
    // but its current read failed while restore/needsContent still apply. This
    // is the decisive reconstruction escape, not merely the pending lock.
    await expect(page.getByTestId("capability-recheck")).toBeEnabled();
    await expect(page.getByTestId("capability-form-state")).toContainText(
      retried.command.commandId
    );
    await expect(page.locator("#capability-evidence")).toBeDisabled();
    for (const id of [
      "fitment-make-0",
      "fitment-model-0",
      "fitment-yearFrom-0",
      "fitment-yearTo-0",
    ])
      await expect(page.locator(`#${id}`)).toBeDisabled();
    await expect(page.locator("#capability-evidence")).toHaveValue("CI:SETTLEMENT:RECONSTRUCT");
    expect(await page.evaluate((key) => sessionStorage.getItem(key), journalKey)).toBe(
      originalJournal
    );
    await page.evaluate(() => {
      for (const id of [
        "capability-create",
        "capability-save",
        "capability-submit",
        "capability-retry",
        "capability-new",
      ])
        document
          .querySelector(`[data-testid="${id}"]`)
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(writes).toBe(1);
    const policyId = retried.command.policyId;
    expect(
      await f.prisma.branchCapabilityVersion.findUniqueOrThrow({ where: { id: policyId } })
    ).toMatchObject({ version: 1, status: "DRAFT", evidenceRef: "CI:SETTLEMENT:RECONSTRUCT" });
    const receiptRead = page.waitForResponse(
      (r) => r.request().method() === "GET" && r.url().includes(retried.command.commandId)
    );
    await page.getByTestId("capability-recheck").click();
    expect((await receiptRead).status()).toBe(200);
    await held.promise;
    await expect(page.locator("#capability-evidence")).toBeDisabled();
    release.resolve();
    await ready(page, policyId, 1);
    await expect(page.locator("#capability-evidence")).toBeEnabled();
    await expect(page.locator("#capability-evidence")).toHaveValue("CI:SETTLEMENT:RECONSTRUCT");
    expect(await f.prisma.branchCapabilityVersion.count({ where: { branchId: f.branch.id } })).toBe(
      1
    );
    expect(
      await f.prisma.fitmentCommand.count({ where: { domain: "CAPABILITY", resourceId: policyId } })
    ).toBe(1);
    expect(
      await f.prisma.securityAuditEvent.count({
        where: {
          eventType: "BRANCH_CAPABILITY_DRAFT_CREATED",
          targetEntity: `branch_capability:${policyId}`,
        },
      })
    ).toBe(1);
  } finally {
    await f.cleanup();
  }
});
