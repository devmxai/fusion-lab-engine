import { expect, test } from "@playwright/test";

test("retired UI routes never mount a legacy surface", async ({ page }) => {
  await page.goto("/studio?tab=text-to-video");
  await expect(page).toHaveURL(/\/projects\/local-demo\/studio$/);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText(/Local autosave/)).toBeVisible();

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/v2$/);
  await expect(page.getByRole("heading", { name: "Admin Control Plane" })).toBeVisible();
  await expect(page.getByText("الأدمن القديم", { exact: true })).toHaveCount(0);
});
