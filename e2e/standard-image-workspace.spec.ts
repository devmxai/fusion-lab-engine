import { expect, test } from "@playwright/test";
import { applyImageOperationResult, createCreativeSpaceProject, placeReservedImageOperation } from "../src/features/creative-space/domain";
import { standardPrototypeImageOffer } from "../src/features/creative-space/standard-prototype-fixture";

test("Standard Image resumes a durable settled operation after refresh without a second dispatch", async ({ page }) => {
  const projectId = "standard-image-e2e";
  let document = createCreativeSpaceProject(projectId, new Date("2026-08-24T10:00:00.000Z"));
  let version = 1;
  let operationCreates = 0;
  const quote = { id: "quote-standard-e2e", projectId, recipeId: "image.create", modelId: standardPrototypeImageOffer.providerModelId, provider: standardPrototypeImageOffer.providerId, requestHash: "request-hash", customerCredits: 6, configuration: { recipeId: "image.create", settings: { resolution: "1K", aspectRatio: "9:16" }, bindingCount: 0, bindingRoles: [] }, createdAt: "2026-08-24T10:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", localOnly: false, durable: true };
  const operation = { id: "operation-standard-e2e", quoteId: quote.id, provider: quote.provider, modelId: quote.modelId, state: "SETTLED", financials: { customerQuotedCredits: 6, customerChargedCredits: 6, providerEstimatedCredits: 3, providerChargedCredits: 3 }, delivery: { assetId: "asset-standard-e2e", mediaType: "image", contentType: "image/svg+xml", byteLength: 150, checksumSha256: "a".repeat(64) }, resultUrl: null, assetChecksumSha256: "a".repeat(64), events: [{ sequence: 1, state: "RESERVED", at: "2026-08-24T10:00:01.000Z" }, { sequence: 2, state: "SETTLED", at: "2026-08-24T10:00:02.000Z" }], createdAt: "2026-08-24T10:00:01.000Z", updatedAt: "2026-08-24T10:00:02.000Z", localOnly: false };

  await page.route("**/api/engine/**", async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (path.endsWith("/v1/dev/session/bootstrap")) return route.fulfill({ status: 204 });
    if (path.endsWith("/v2/catalog/offers") && request.method() === "GET") return route.fulfill({ json: [standardPrototypeImageOffer] });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "GET") return route.fulfill({ json: { projectId, document, version, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "PUT") {
      document = JSON.parse(request.postData() ?? "{}").document; version += 1;
      return route.fulfill({ json: { projectId, document, version, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } });
    }
    if (path.endsWith("/v2/quotes") && request.method() === "POST") return route.fulfill({ json: quote });
    if (path.endsWith("/v2/operations") && request.method() === "POST") { operationCreates += 1; return route.fulfill({ json: { quote, operation: { ...operation, state: "RESERVED", delivery: null, resultUrl: null, assetChecksumSha256: null, events: [operation.events[0]] }, localOnly: false, durable: true } }); }
    if (path.endsWith(`/v2/operations/${operation.id}`) && request.method() === "GET") return route.fulfill({ json: { quote, operation, localOnly: false, durable: true } });
    if (path.endsWith(`/v2/assets/${operation.delivery.assetId}/access-grants`) && request.method() === "POST") return route.fulfill({ json: { token: "test-grant" } });
    if (path.endsWith(`/v2/assets/${operation.delivery.assetId}/content`) && request.method() === "GET") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="black"/><text x="8" y="36" fill="white">TEST</text></svg>' });
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected Engine route: ${request.method()} ${path}` } } });
  });

  await page.goto(`/projects/${projectId}/standard`);
  const prompt = page.getByRole("textbox", { name: "Prompt" });
  await expect(prompt).toBeVisible();
  await prompt.fill("A durable standard image result");
  await page.getByRole("button", { name: "Generate" }).click();
  // A settled result is now retained in the persistent asset grid instead of
  // replacing the workspace with a transient "Result ready" screen.
  await expect(page.getByRole("region", { name: "Project assets" }).getByLabel(/^View:/)).toBeVisible();
  expect(operationCreates).toBe(1);

  await page.reload();
  await expect(page.getByRole("region", { name: "Project assets" })).toBeVisible();
  await page.getByLabel(/^View:/).click();
  await expect(page.getByRole("img", { name: /Generated/ })).toBeVisible();
  expect(operationCreates).toBe(1);
});

test("Standard Image reports insufficient credit before creating an operation", async ({ page }) => {
  const projectId = "standard-image-insufficient";
  let document = createCreativeSpaceProject(projectId, new Date("2026-08-24T10:00:00.000Z"));
  let version = 1;
  let operationCreates = 0;
  await page.route("**/api/engine/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith("/v1/dev/session/bootstrap")) return route.fulfill({ status: 204 });
    if (path.endsWith("/v2/catalog/offers")) return route.fulfill({ json: [standardPrototypeImageOffer] });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "GET") return route.fulfill({ json: { projectId, document, version, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "PUT") { document = JSON.parse(request.postData() ?? "{}").document; version += 1; return route.fulfill({ json: { projectId, document, version, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } }); }
    if (path.endsWith("/v2/quotes")) return route.fulfill({ status: 409, json: { error: { code: "INSUFFICIENT_CREDITS", message: "internal" } } });
    if (path.endsWith("/v2/operations")) { operationCreates += 1; return route.fulfill({ status: 500 }); }
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected Engine route: ${path}` } } });
  });
  await page.goto(`/projects/${projectId}/standard`);
  await page.getByRole("textbox", { name: "Prompt" }).fill("Insufficient credit case");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByRole("alert")).toContainText("No generation was started.");
  expect(operationCreates).toBe(0);
});

test("Standard Image distinguishes reconciliation from a completed result", async ({ page }) => {
  const projectId = "standard-image-reconciliation";
  let document = createCreativeSpaceProject(projectId, new Date("2026-08-24T10:00:00.000Z"));
  const quote = { id: "quote-reconciliation", projectId, recipeId: "image.create", modelId: standardPrototypeImageOffer.providerModelId, provider: standardPrototypeImageOffer.providerId, requestHash: "reconciliation-hash", customerCredits: 6, createdAt: "2026-08-24T10:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", localOnly: false, durable: true };
  const operation = { id: "operation-reconciliation", quoteId: quote.id, provider: quote.provider, modelId: quote.modelId, state: "RECONCILIATION_REQUIRED", financials: { customerQuotedCredits: 6, customerChargedCredits: 0 }, events: [{ sequence: 1, state: "RECONCILIATION_REQUIRED", at: "2026-08-24T10:00:01.000Z" }], createdAt: "2026-08-24T10:00:00.000Z", updatedAt: "2026-08-24T10:00:01.000Z", localOnly: false };
  document = placeReservedImageOperation(document, { operation: { id: operation.id, quoteId: operation.quoteId, provider: operation.provider, modelId: operation.modelId, state: "RESERVED", financials: { customerQuotedCredits: 6 }, createdAt: operation.createdAt }, recipeId: "image.create", inputAssetId: null, inputRole: "SOURCE", anchor: { x: 0, y: 0 } });
  document = applyImageOperationResult(document, { operationId: operation.id, state: "RECONCILIATION_REQUIRED", resultUrl: null, checksumSha256: null, customerChargedCredits: 0, updatedAt: operation.updatedAt });
  await page.route("**/api/engine/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith("/v1/dev/session/bootstrap")) return route.fulfill({ status: 204 });
    if (path.endsWith("/v2/catalog/offers")) return route.fulfill({ json: [standardPrototypeImageOffer] });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "GET") return route.fulfill({ json: { projectId, document, version: 1, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "PUT") { const saved = JSON.parse(request.postData() ?? "{}").document; document = saved; return route.fulfill({ json: { projectId, document, version: 2, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } }); }
    if (path.endsWith(`/v2/operations/${operation.id}`)) return route.fulfill({ json: { quote, operation, localOnly: false, durable: true } });
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected Engine route: ${path}` } } });
  });
  await page.goto(`/projects/${projectId}/standard`);
  await expect(page.getByRole("heading", { name: "Financial reconciliation required" })).toBeVisible();
  await expect(page.getByText("Do not retry or assume a refund.")).toBeVisible();
  await expect(page.getByText("Result ready", { exact: true })).toHaveCount(0);
});

test("Standard Image reports an expired confirmation without creating a result", async ({ page }) => {
  const projectId = "standard-image-expired-confirmation";
  let document = createCreativeSpaceProject(projectId, new Date("2026-08-24T10:00:00.000Z"));
  let version = 1;
  let confirmationAttempts = 0;
  const quote = { id: "quote-expired-confirmation", projectId, recipeId: "image.create", modelId: standardPrototypeImageOffer.providerModelId, provider: standardPrototypeImageOffer.providerId, requestHash: "expired-hash", customerCredits: 6, configuration: { recipeId: "image.create", settings: { resolution: "1K" }, bindingCount: 0, bindingRoles: [] }, createdAt: "2026-08-24T10:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", localOnly: false, durable: true };

  await page.route("**/api/engine/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith("/v1/dev/session/bootstrap")) return route.fulfill({ status: 204 });
    if (path.endsWith("/v2/catalog/offers")) return route.fulfill({ json: [standardPrototypeImageOffer] });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "GET") return route.fulfill({ json: { projectId, document, version, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "PUT") { document = JSON.parse(request.postData() ?? "{}").document; version += 1; return route.fulfill({ json: { projectId, document, version, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } }); }
    if (path.endsWith("/v2/quotes")) return route.fulfill({ json: quote });
    if (path.endsWith("/v2/operations")) { confirmationAttempts += 1; return route.fulfill({ status: 409, json: { error: { code: "QUOTE_EXPIRED", message: "internal" } } }); }
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected Engine route: ${path}` } } });
  });

  await page.goto(`/projects/${projectId}/standard`);
  await page.getByRole("textbox", { name: "Prompt" }).fill("Expired price confirmation");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByRole("alert")).toContainText("This price has expired. Request a new price; no new operation was created.");
  await expect(page.getByText("Result ready", { exact: true })).toHaveCount(0);
  expect(confirmationAttempts).toBe(1);
});

test("Standard Image exposes a provider failure as a review state, not a result or refund", async ({ page }) => {
  const projectId = "standard-image-provider-failed";
  let document = createCreativeSpaceProject(projectId, new Date("2026-08-24T10:00:00.000Z"));
  let version = 1;
  const quote = { id: "quote-provider-failed", projectId, recipeId: "image.create", modelId: standardPrototypeImageOffer.providerModelId, provider: standardPrototypeImageOffer.providerId, requestHash: "provider-failed-hash", customerCredits: 6, createdAt: "2026-08-24T10:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", localOnly: false, durable: true };
  const operation = { id: "operation-provider-failed", quoteId: quote.id, provider: quote.provider, modelId: quote.modelId, state: "PROVIDER_FAILED", financials: { customerQuotedCredits: 6, customerChargedCredits: 0 }, events: [{ sequence: 1, state: "RESERVED", at: "2026-08-24T10:00:01.000Z" }, { sequence: 2, state: "PROVIDER_FAILED", at: "2026-08-24T10:00:02.000Z" }], createdAt: "2026-08-24T10:00:01.000Z", updatedAt: "2026-08-24T10:00:02.000Z", localOnly: false };

  await page.route("**/api/engine/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith("/v1/dev/session/bootstrap")) return route.fulfill({ status: 204 });
    if (path.endsWith("/v2/catalog/offers")) return route.fulfill({ json: [standardPrototypeImageOffer] });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "GET") return route.fulfill({ json: { projectId, document, version, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "PUT") { document = JSON.parse(request.postData() ?? "{}").document; version += 1; return route.fulfill({ json: { projectId, document, version, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } }); }
    if (path.endsWith("/v2/quotes")) return route.fulfill({ json: quote });
    if (path.endsWith("/v2/operations") && request.method() === "POST") return route.fulfill({ json: { quote, operation: { ...operation, state: "RESERVED", financials: { customerQuotedCredits: 6, customerChargedCredits: 0 }, events: [operation.events[0]] }, localOnly: false, durable: true } });
    if (path.endsWith(`/v2/operations/${operation.id}`) && request.method() === "GET") return route.fulfill({ json: { quote, operation, localOnly: false, durable: true } });
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected Engine route: ${path}` } } });
  });

  await page.goto(`/projects/${projectId}/standard`);
  await page.getByRole("textbox", { name: "Prompt" }).fill("Provider failure case");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByRole("heading", { name: "Provider generation failed" })).toBeVisible();
  await expect(page.getByText("Recorded final customer charge: 0 credits.")).toBeVisible();
  await expect(page.getByText("Result ready", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Review the operation history before taking any action.")).toBeVisible();
});

test("Standard Image reports an expired private delivery grant without treating it as another generation", async ({ page }) => {
  const projectId = "standard-image-delivery-expired";
  const operationId = "operation-delivery-expired";
  let document = createCreativeSpaceProject(projectId, new Date("2026-08-24T10:00:00.000Z"));
  document = placeReservedImageOperation(document, {
    operation: { id: operationId, quoteId: "quote-delivery-expired", provider: standardPrototypeImageOffer.providerId, modelId: standardPrototypeImageOffer.providerModelId, state: "RESERVED", financials: { customerQuotedCredits: 6 }, createdAt: "2026-08-24T10:00:00.000Z" },
    recipeId: "image.create", inputAssetId: null, inputRole: "SOURCE", anchor: { x: 0, y: 0 },
  });
  document = applyImageOperationResult(document, {
    operationId, state: "SETTLED", resultUrl: "https://private.example.invalid/result", deliveryAssetId: "asset-delivery-expired", contentType: "image/png", byteLength: 10, checksumSha256: "b".repeat(64), customerChargedCredits: 6, updatedAt: "2026-08-24T10:00:02.000Z",
  });

  await page.route("**/api/engine/**", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path.endsWith("/v1/dev/session/bootstrap")) return route.fulfill({ status: 204 });
    if (path.endsWith("/v2/catalog/offers")) return route.fulfill({ json: [standardPrototypeImageOffer] });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "GET") return route.fulfill({ json: { projectId, document, version: 1, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } });
    if (path.endsWith(`/v2/projects/${projectId}`) && request.method() === "PUT") { document = JSON.parse(request.postData() ?? "{}").document; return route.fulfill({ json: { projectId, document, version: 2, createdAt: "2026-08-24T10:00:00.000Z", updatedAt: document.updatedAt } }); }
    if (path.endsWith("/v2/assets/asset-delivery-expired/access-grants")) return route.fulfill({ status: 410, json: { error: { code: "ASSET_GRANT_EXPIRED", message: "internal" } } });
    return route.fulfill({ status: 404, json: { error: { message: `Unexpected Engine route: ${path}` } } });
  });

  await page.goto(`/projects/${projectId}/standard`);
  await expect(page.getByRole("region", { name: "Project assets" })).toBeVisible();
  await page.getByLabel(/^View:/).click();
  await expect(page.getByRole("alert")).toContainText("The secure download link expired. Try the download again; no new generation was started.");
  await expect(page.getByText("Generation in progress", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Result ready", { exact: true })).toHaveCount(0);
});
