import { expect, test } from "@playwright/test";

test("Video recipes validate bindings and show explicit compatibility diffs", async ({ page }) => {
  await page.goto("/projects/gate-11-validation/studio");
  await page.evaluate(() => {
    const projectId = "gate-11-validation";
    const createdAt = "2026-08-12T00:00:00.000Z";
    localStorage.clear();
    localStorage.setItem(`fusionlab:creative-space:v1:${projectId}`, JSON.stringify({
      schemaVersion: 1,
      projectId,
      title: "Gate 11 Validation",
      assets: {
        first: { id: "first", projectId, kind: "IMAGE", name: "first.png", mimeType: "image/png", bytes: 10, status: "READY", origin: "UPLOAD", createdAt },
        last: { id: "last", projectId, kind: "IMAGE", name: "last.png", mimeType: "image/png", bytes: 10, status: "READY", origin: "UPLOAD", createdAt },
      },
      operations: {}, bindings: {},
      canvasItems: {
        "item-first": { id: "item-first", entityType: "ASSET", entityId: "first", position: { x: 520, y: 180 }, size: { width: 248, height: 176 }, zIndex: 1 },
        "item-last": { id: "item-last", entityType: "ASSET", entityId: "last", position: { x: 840, y: 180 }, size: { width: 248, height: 176 }, zIndex: 2 },
      },
      viewport: { x: 0, y: 0, zoom: 1 }, activity: [], updatedAt: createdAt,
    }));
  });
  await page.reload();

  await page.locator("article").filter({ hasText: "first.png" }).click();
  await page.getByRole("button", { name: /تحريك الصورة/ }).click();
  await page.getByRole("textbox", { name: "Prompt" }).fill("Move from the first frame to the last frame");
  await expect(page.getByTestId("video-composer-validation")).toContainText("صالحة");

  await page.getByRole("combobox", { name: "تغيير وصفة الفيديو" }).click();
  await page.getByRole("option", { name: "الإطار الأول والأخير" }).click();
  await expect(page.getByRole("dialog", { name: "Video Compatibility Diff" })).toContainText("تحتاج 2 صورة");
  await expect(page.getByRole("button", { name: "تطبيق التغيير بوضوح" })).toHaveCount(0);
  await page.getByRole("button", { name: "إلغاء" }).click();

  await page.locator("article").filter({ hasText: "last.png" }).click();
  await page.getByRole("combobox", { name: "تغيير وصفة الفيديو" }).click();
  await page.getByRole("option", { name: "الإطار الأول والأخير" }).click();
  await expect(page.getByRole("dialog", { name: "Video Compatibility Diff" })).toContainText("الدور 2");
  await page.getByRole("button", { name: "تطبيق التغيير بوضوح" }).click();
  await expect(page.getByText("2/2", { exact: true })).toBeVisible();
  await expect(page.getByText("الإطار الأخير", { exact: true })).toBeVisible();
  await expect(page.getByTestId("video-composer-validation")).toContainText("صالحة");

  await page.getByRole("combobox", { name: "تغيير وصفة الفيديو" }).click();
  await page.getByRole("option", { name: "مراجع متعددة" }).click();
  const roleDiff = page.getByRole("dialog", { name: "Video Compatibility Diff" });
  await expect(roleDiff).toContainText("FIRST_FRAME إلى REFERENCE");
  await expect(roleDiff).toContainText("LAST_FRAME إلى REFERENCE");
  await page.getByRole("button", { name: "تطبيق التغيير بوضوح" }).click();
  await expect(page.getByText("مرجع · @image1", { exact: true })).toBeVisible();
  await expect(page.getByText("مرجع · @image2", { exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "تغيير وصفة الفيديو" }).click();
  await page.getByRole("option", { name: "نص إلى فيديو" }).click();
  const dropDiff = page.getByRole("dialog", { name: "Video Compatibility Diff" });
  await expect(dropDiff).toContainText("سيُزال Binding", { useInnerText: true });
  await page.getByRole("button", { name: "تطبيق التغيير بوضوح" }).click();
  await expect(page.getByTestId("video-composer-validation")).toContainText("صالحة");

  await page.request.post("/api/engine/v1/dev/mock/reset");
  await page.getByRole("button", { name: "احسب السعر النهائي" }).click();
  const quote = page.getByTestId("video-quote-summary");
  await expect(quote).toContainText("20 كريديت");
  await expect(quote).toContainText("10 كريديت");
  await expect(quote).toContainText("الربح المتوقع");

  await page.getByRole("button", { name: "تأكيد وحجز 20 كريديت" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "تأكيد سعر الفيديو والحجز" });
  await expect(confirmDialog).toContainText("الخصم الحالي من المزوّد");
  await expect(confirmDialog).toContainText("صفر");
  await confirmDialog.getByRole("button", { name: "تأكيد وحجز 20" }).click();
  await expect(page.getByTestId("video-operation-financials")).toContainText("الموقع: 20 · المزوّد: 10");
  await expect(page.locator("article").filter({ hasText: "TEST · video.text-to-video" })).toBeVisible();

  const wallet = await page.request.get("/api/engine/v1/dev/mock/wallets/local-user");
  expect(await wallet.json()).toMatchObject({
    customerCredits: { available: 980, held: 0, spent: 20 },
    providerTreasury: { localProvider: { availableAtomic: "990", heldAtomic: "0", spentAtomic: "10" } },
  });
  const resultUrl = await page.evaluate(() => {
    const project = JSON.parse(localStorage.getItem("fusionlab:creative-space:v1:gate-11-validation") ?? "null");
    return Object.values(project.assets).find((asset: { kind?: string; origin?: string }) => asset.kind === "VIDEO" && asset.origin === "GENERATED")?.resultUrl;
  });
  expect(resultUrl).toBeTruthy();
  const output = await page.request.get(`/api/engine${resultUrl}`);
  expect(output.ok()).toBe(true);
  expect(output.headers()["content-type"]).toContain("video/mp4");

  await page.reload();
  await expect(page.locator("article").filter({ hasText: "TEST · video.text-to-video" })).toBeVisible();
});
