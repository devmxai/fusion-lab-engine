import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Professional View projects the existing Standard graph without changing its data", async ({
  page,
}) => {
  const projectId = "gate-17-professional";
  const now = "2026-08-19T00:00:00.000Z";
  let version = 1;
  let document = {
    schemaVersion: 1,
    projectId,
    title: "Professional Graph",
    assets: {
      source: {
        id: "source",
        projectId,
        kind: "IMAGE",
        name: "source.png",
        mimeType: "image/png",
        bytes: 10,
        status: "READY",
        origin: "UPLOAD",
        createdAt: now,
      },
      output: {
        id: "output",
        projectId,
        kind: "IMAGE",
        name: "output.png",
        mimeType: "image/svg+xml",
        bytes: 0,
        status: "READY",
        origin: "GENERATED",
        operationId: "operation",
        resultUrl: "/v1/dev/mock/assets/operation",
        checksumSha256: "a".repeat(64),
        createdAt: now,
      },
    },
    operations: {
      operation: {
        id: "operation",
        projectId,
        quoteId: "quote-private",
        recipeId: "image.edit",
        modelId: "local/test-image-v1",
        provider: "provider-test",
        state: "SETTLED",
        customerCredits: 4,
        providerEstimateCredits: 2,
        outputAssetId: "output",
        createdAt: now,
        updatedAt: now,
      },
    },
    bindings: {
      binding: {
        id: "binding",
        operationId: "operation",
        assetId: "source",
        role: "SOURCE",
        ordinal: 0,
      },
    },
    canvasItems: {
      source: {
        id: "source",
        entityType: "ASSET",
        entityId: "source",
        position: { x: 0, y: 0 },
        size: { width: 248, height: 176 },
        zIndex: 1,
      },
      operation: {
        id: "operation",
        entityType: "OPERATION",
        entityId: "operation",
        position: { x: 330, y: 0 },
        size: { width: 248, height: 176 },
        zIndex: 2,
      },
      output: {
        id: "output",
        entityType: "ASSET",
        entityId: "output",
        position: { x: 660, y: 0 },
        size: { width: 248, height: 176 },
        zIndex: 3,
      },
    },
    viewport: { x: 0, y: 0, zoom: 1 },
    activity: [],
    updatedAt: now,
  };

  // The workspace is Engine-persisted now; seed the Engine boundary rather than
  // legacy browser storage so this test exercises the real persistence contract.
  await page.route("**/api/engine/v1/dev/session/bootstrap", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/engine/v2/catalog/offers", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/engine/v2/projects/${projectId}`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: { projectId, document, version, createdAt: now, updatedAt: now },
      });
      return;
    }
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        document: typeof document;
      };
      document = body.document;
      version += 1;
      await route.fulfill({
        json: { projectId, document, version, createdAt: now, updatedAt: now },
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/projects/${projectId}/studio`);
  await expect(page.getByRole("button", { name: "Canvas" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await expect(page.getByTestId("professional-graph-status")).toBeVisible();
  await expect(
    page.getByTestId("professional-operation-operation"),
  ).toContainText("IN · SOURCE");
  await expect(
    page.getByTestId("professional-operation-operation"),
  ).toContainText("OUT · OUTPUT");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  await page.getByRole("button", { name: "Graph tools" }).click();
  await expect(page.getByTestId("professional-graph-tools")).toBeVisible();
  await page.getByRole("button", { name: "Create group" }).click();
  await page.getByRole("button", { name: "Create subflow" }).click();
  await page.getByRole("button", { name: "Save template" }).click();
  await page.getByRole("button", { name: "Prepare batch" }).click();
  await expect(page.getByLabel("Group count")).toHaveText("1");
  await expect(page.getByLabel("Subflow count")).toHaveText("1");
  await expect(page.getByLabel("Template count")).toHaveText("1");
  await expect(page.getByLabel("Batch branch count")).toHaveText("1");
  await page.getByRole("button", { name: "Add advanced shot" }).click();
  await expect(page.getByLabel("Advanced shot count")).toHaveText("1");
  await expect(page.getByTestId("professional-timeline")).toContainText(
    "Shot 1",
  );
  await expect(page.getByTestId("professional-timeline")).toContainText(
    "DRAFT",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Debug view" }).click();
  await expect(page.getByTestId("professional-debug-view")).toContainText(
    "Engine-governed",
  );
  await expect(page.getByTestId("professional-debug-view")).toContainText(
    "PASS",
  );
  await expect(page.getByRole("dialog")).not.toContainText("provider-test");
  await expect(page.getByRole("dialog")).not.toContainText("quote-private");
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.waitForTimeout(650);
  await page.reload();
  await expect(page.getByRole("button", { name: "Graph", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Canvas" }).click();
  await expect(page.getByTestId("space-operation-operation")).toBeVisible();
});
