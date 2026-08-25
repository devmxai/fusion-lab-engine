import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("mobile Creative Space completes tap-only Avatar bindings and refresh recovery", async ({ page, request }) => {
  const projectId = "gate-11-mobile";
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await request.post("/api/engine/v1/dev/mock/reset");
  await page.goto(`/projects/${projectId}/studio`);
  await page.evaluate(({ projectId }) => {
    const createdAt = "2026-08-13T00:00:00.000Z";
    localStorage.clear();
    localStorage.setItem(`fusionlab:creative-space:v1:${projectId}`, JSON.stringify({
      schemaVersion: 1,
      projectId,
      title: "Gate 11 Mobile",
      assets: {
        face: { id: "face", projectId, kind: "IMAGE", name: "mobile-face.png", mimeType: "image/png", bytes: 1024, status: "READY", origin: "UPLOAD", createdAt },
        voice: { id: "voice", projectId, kind: "AUDIO", name: "mobile-voice.wav", mimeType: "audio/wav", bytes: 2048, status: "READY", origin: "UPLOAD", createdAt },
      },
      operations: {}, bindings: {},
      canvasItems: {
        "item-face": { id: "item-face", entityType: "ASSET", entityId: "face", position: { x: 60, y: 80 }, size: { width: 248, height: 176 }, zIndex: 1 },
        "item-voice": { id: "item-voice", entityType: "ASSET", entityId: "voice", position: { x: 60, y: 330 }, size: { width: 248, height: 176 }, zIndex: 2 },
      },
      viewport: { x: 0, y: 0, zoom: 1 }, activity: [], updatedAt: createdAt,
    }));
  }, { projectId });
  await page.reload();

  const dock = page.getByTestId("mobile-space-dock");
  await expect(dock).toBeVisible();
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeHidden();
  const dockTargets = await dock.getByRole("button").evaluateAll((buttons) => buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(dockTargets.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true);

  await page.locator("article").filter({ hasText: "mobile-face.png" }).click();
  const inspector = page.getByRole("dialog", { name: "Inspector مساحة الإبداع" });
  await expect(inspector).toBeVisible();
  await inspector.getByRole("button", { name: /Avatar \/ Lip-sync/ }).click();
  await expect(page.getByTestId("advanced-composer-validation")).toContainText("1 متطلبات");
  await expect(inspector.getByRole("button", { name: "أكمل المتطلبات" })).toBeDisabled();

  await inspector.getByRole("button", { name: "Close" }).click();
  await page.locator("article").filter({ hasText: "mobile-voice.wav" }).click();
  await expect(inspector).toBeVisible();
  await inspector.getByRole("button", { name: /ربط mobile-voice.wav كـVoice Audio/ }).click();
  await expect(page.getByTestId("advanced-composer-validation")).toContainText("صالحة للتسعير");

  await inspector.getByRole("button", { name: "احسب السعر النهائي" }).click();
  await expect(page.getByTestId("advanced-quote-summary")).toContainText("30 كريديت");
  await expect(page.getByTestId("advanced-quote-summary")).toContainText("15 كريديت");
  await inspector.getByRole("button", { name: "تأكيد وحجز 30 كريديت" }).click();
  const confirm = page.getByRole("dialog", { name: "تأكيد السعر والحجز" });
  await expect(confirm).toContainText("خصم المزوّد الآن");
  await expect(confirm).toContainText("صفر");
  await confirm.getByRole("button", { name: "تأكيد وحجز 30" }).click();
  await expect(page.getByTestId("advanced-operation-financials")).toContainText("الموقع: 30 · المزوّد: 15");

  await page.reload();
  const persistedVideoCard = page.locator("article").filter({ hasText: "TEST · video.avatar" });
  await expect(persistedVideoCard).toBeVisible();
  await dock.getByRole("button", { name: /Inspector/ }).click();
  await page.getByRole("button", { name: "العودة للوصفات" }).click();
  await inspector.getByRole("button", { name: "Close" }).click();
  await persistedVideoCard.click();
  await page.getByRole("button", { name: "عرض الأصل" }).click();
  const viewer = page.getByRole("dialog", { name: "TEST · video.avatar" });
  await expect(viewer.locator("video[controls]")).toBeVisible();
  await expect(viewer.locator("video")).not.toHaveAttribute("autoplay");
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toBeHidden();
  await inspector.getByRole("button", { name: "Close" }).click();
  await expect(inspector).toBeHidden();

  const viewportFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(viewportFits).toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("mobile Creative Space renders a 100-card project within budget", async ({ page }) => {
  const projectId = "gate-11-mobile-performance";
  await page.goto(`/projects/${projectId}/studio`);
  await page.evaluate(({ projectId }) => {
    const createdAt = "2026-08-13T00:00:00.000Z";
    const assets: Record<string, unknown> = {};
    const canvasItems: Record<string, unknown> = {};
    for (let index = 0; index < 100; index += 1) {
      const assetId = `mobile-perf-asset-${index}`;
      const itemId = `mobile-perf-item-${index}`;
      assets[assetId] = { id: assetId, projectId, kind: "IMAGE", name: `mobile-${index}.png`, mimeType: "image/png", bytes: 1024, status: "READY", origin: "UPLOAD", createdAt };
      canvasItems[itemId] = { id: itemId, entityType: "ASSET", entityId: assetId, position: { x: (index % 10) * 280, y: Math.floor(index / 10) * 210 }, size: { width: 248, height: 176 }, zIndex: index + 1 };
    }
    localStorage.setItem(`fusionlab:creative-space:v1:${projectId}`, JSON.stringify({
      schemaVersion: 1, projectId, title: "Gate 11 Mobile Performance", assets, operations: {}, bindings: {}, canvasItems,
      viewport: { x: 120, y: 80, zoom: 0.25 }, activity: [], updatedAt: createdAt,
    }));
  }, { projectId });

  const startedAt = Date.now();
  await page.reload();
  await expect(page.getByText("Local autosave · 100 assets", { exact: true })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(100);
  expect(Date.now() - startedAt).toBeLessThan(3_500);
  await expect(page.getByTestId("mobile-space-dock")).toBeVisible();
  await page.getByTestId("mobile-space-dock").getByRole("button", { name: /ملاءمة/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
