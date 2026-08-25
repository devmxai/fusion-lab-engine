import { expect, test } from "@playwright/test";

test("Creative Space completes TTS then reuses its Audio Output for Avatar", async ({ page }) => {
  const projectId = "gate-11-advanced";
  await page.goto(`/projects/${projectId}/studio`);
  await page.evaluate(({ projectId }) => {
    const createdAt = "2026-08-13T00:00:00.000Z";
    localStorage.clear();
    localStorage.setItem(`fusionlab:creative-space:v1:${projectId}`, JSON.stringify({
      schemaVersion: 1,
      projectId,
      title: "Gate 11 Advanced",
      assets: {
        face: { id: "face", projectId, kind: "IMAGE", name: "face.png", mimeType: "image/png", bytes: 10, status: "READY", origin: "UPLOAD", createdAt },
      },
      operations: {}, bindings: {},
      canvasItems: {
        "item-face": { id: "item-face", entityType: "ASSET", entityId: "face", position: { x: 560, y: 180 }, size: { width: 248, height: 176 }, zIndex: 1 },
      },
      viewport: { x: 0, y: 0, zoom: 1 }, activity: [], updatedAt: createdAt,
    }));
  }, { projectId });
  await page.reload();
  await page.request.post("/api/engine/v1/dev/mock/reset");

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Create Voice \/ TTS/ }).click();
  await page.getByRole("textbox", { name: "النص الصوتي" }).fill("ا".repeat(150));
  await expect(page.getByTestId("advanced-composer-validation")).toContainText("صالحة للتسعير");
  await page.getByRole("button", { name: "احسب السعر النهائي" }).click();
  await expect(page.getByTestId("advanced-quote-summary")).toContainText("4 كريديت");
  await expect(page.getByTestId("advanced-quote-summary")).toContainText("2 كريديت");
  await page.getByRole("button", { name: "تأكيد وحجز 4 كريديت" }).click();
  const ttsConfirm = page.getByRole("dialog", { name: "تأكيد السعر والحجز" });
  await expect(ttsConfirm).toContainText("خصم المزوّد الآن");
  await expect(ttsConfirm).toContainText("صفر");
  await ttsConfirm.getByRole("button", { name: "تأكيد وحجز 4" }).click();
  await expect(page.getByTestId("advanced-operation-financials")).toContainText("الموقع: 4 · المزوّد: 2");
  const audioCard = page.locator("article").filter({ hasText: "TEST · audio.tts" });
  await expect(audioCard).toBeVisible();
  await audioCard.dblclick();
  const audioViewer = page.getByRole("dialog", { name: "TEST · audio.tts" });
  await expect(audioViewer.locator("audio[controls]")).toBeVisible();
  await expect(audioViewer.locator("audio")).not.toHaveAttribute("autoplay");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "العودة للوصفات" }).click();
  await page.locator("article").filter({ hasText: "face.png" }).click();
  await page.getByRole("button", { name: /Avatar \/ Lip-sync/ }).click();
  await expect(page.getByTestId("advanced-composer-validation")).toContainText("1 متطلبات");
  await audioCard.click();
  await page.getByRole("button", { name: /ربط TEST · audio.tts كـVoice Audio/ }).click();
  await expect(page.getByTestId("advanced-composer-validation")).toContainText("صالحة للتسعير");

  await page.getByRole("button", { name: "احسب السعر النهائي" }).click();
  await expect(page.getByTestId("advanced-quote-summary")).toContainText("30 كريديت");
  await expect(page.getByTestId("advanced-quote-summary")).toContainText("15 كريديت");
  await page.getByRole("button", { name: "تأكيد وحجز 30 كريديت" }).click();
  const avatarConfirm = page.getByRole("dialog", { name: "تأكيد السعر والحجز" });
  await avatarConfirm.getByRole("button", { name: "تأكيد وحجز 30" }).click();
  await expect(page.getByTestId("advanced-operation-financials")).toContainText("الموقع: 30 · المزوّد: 15");
  const videoCard = page.locator("article").filter({ hasText: "TEST · video.avatar" });
  await expect(videoCard).toBeVisible();
  await videoCard.dblclick();
  const videoViewer = page.getByRole("dialog", { name: "TEST · video.avatar" });
  await expect(videoViewer.locator("video[controls]")).toBeVisible();
  await expect(videoViewer.locator("video")).not.toHaveAttribute("autoplay");
  await page.keyboard.press("Escape");

  const wallet = await page.request.get("/api/engine/v1/dev/mock/wallets/local-user");
  expect(await wallet.json()).toMatchObject({
    customerCredits: { available: 966, held: 0, spent: 34 },
    providerTreasury: { localProvider: { availableAtomic: "983", heldAtomic: "0", spentAtomic: "17" } },
  });

  const outputs = await page.evaluate(({ projectId }) => {
    const project = JSON.parse(localStorage.getItem(`fusionlab:creative-space:v1:${projectId}`) ?? "null");
    return Object.values(project.assets).filter((asset: { origin?: string }) => asset.origin === "GENERATED");
  }, { projectId }) as Array<{ kind: string; resultUrl: string }>;
  expect(outputs.map(({ kind }) => kind)).toEqual(expect.arrayContaining(["AUDIO", "VIDEO"]));
  for (const output of outputs) {
    const response = await page.request.get(`/api/engine${output.resultUrl}`);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain(output.kind === "AUDIO" ? "audio/wav" : "video/mp4");
  }
});
