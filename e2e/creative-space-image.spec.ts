import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Creative Space completes Image-first with accessible controls and refresh recovery", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await request.post("/api/engine/v1/dev/mock/reset");
  await page.goto("/projects/gate-10-e2e/studio");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.getByRole("main")).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.getByText("Quick Add", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create Image", exact: true }).click();

  const prompt = page.getByRole("textbox", { name: "Prompt" });
  await expect(prompt).toBeFocused();
  await prompt.fill("Professional white test card marked TEST");
  await page.getByRole("button", { name: "احسب السعر النهائي" }).click();
  await expect(page.getByText("4 كريديت", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("2 كريديت", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "تأكيد وحجز 4 كريديت", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "تأكيد السعر والحجز" })).toBeVisible();
  await page.getByRole("button", { name: "تأكيد وحجز 4", exact: true }).click();
  await expect(page.getByTestId(/space-operation-/)).toContainText("Ready");
  await expect(page.getByRole("img", { name: "TEST · image.create" })).toBeVisible();
  await expect(page.getByText("مدفوع: 4 · المزود: 2", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId(/space-operation-/)).toContainText("Ready");

  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByTestId("operation-timeline")).toContainText("image.create");
  await expect(page.getByTestId("operation-timeline")).toContainText("سعر العميل");
  await page.getByRole("button", { name: "Close" }).click();

  await expect(page.getByRole("img", { name: "TEST · image.create" })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  const unnamedInteractive = await page.locator("button, input, textarea, select, [role=button], [role=combobox]").evaluateAll((elements) => elements.filter((element) => {
    const html = element as HTMLElement;
    if (html.offsetParent === null) return false;
    const name = html.getAttribute("aria-label")
      || html.getAttribute("aria-labelledby")
      || html.getAttribute("title")
      || html.textContent?.trim()
      || (html as HTMLInputElement).placeholder;
    return !name;
  }).map((element) => element.outerHTML.slice(0, 160)));
  expect(unnamedInteractive).toEqual([]);

  expect(errors).toEqual([]);
});

test("Creative Space renders a 100-card project within the desktop budget", async ({ page }) => {
  await page.goto("/projects/gate-10-performance/studio");
  await page.evaluate(() => {
    const projectId = "gate-10-performance";
    const createdAt = "2026-08-12T00:00:00.000Z";
    const assets: Record<string, unknown> = {};
    const canvasItems: Record<string, unknown> = {};
    for (let index = 0; index < 100; index += 1) {
      const assetId = `perf-asset-${index}`;
      const itemId = `perf-item-${index}`;
      assets[assetId] = { id: assetId, projectId, kind: "IMAGE", name: `asset-${index}.png`, mimeType: "image/png", bytes: 1024, status: "READY", origin: "UPLOAD", createdAt };
      canvasItems[itemId] = { id: itemId, entityType: "ASSET", entityId: assetId, position: { x: (index % 10) * 280, y: Math.floor(index / 10) * 210 }, size: { width: 248, height: 176 }, zIndex: index + 1 };
    }
    localStorage.setItem(`fusionlab:creative-space:v1:${projectId}`, JSON.stringify({
      schemaVersion: 1, projectId, title: "Gate 10 Performance", assets, operations: {}, bindings: {}, canvasItems,
      viewport: { x: 120, y: 80, zoom: 0.25 }, activity: [], updatedAt: createdAt,
    }));
  });

  const startedAt = Date.now();
  await page.reload();
  await expect(page.getByText("Local autosave · 100 assets", { exact: true })).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(100);
  const readyMs = Date.now() - startedAt;
  expect(readyMs).toBeLessThan(3_000);

  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return { domContentLoadedMs: entry.domContentLoadedEventEnd, loadMs: entry.loadEventEnd };
  });
  expect(navigation.domContentLoadedMs).toBeLessThan(2_000);
});
