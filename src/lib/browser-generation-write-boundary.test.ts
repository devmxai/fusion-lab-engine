import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const prohibitedRecordMutation = /\.from\(["'](?:generation_jobs|generations|credit_reservations|credit_transactions)["']\)\s*\.(?:insert|update|upsert|delete)\b/s;
const prohibitedGenerationStorageMutation = /\.storage\.from\(["']generations["']\)\s*\.(?:upload|remove)\b/s;
const prohibitedAdminMutation = /supabase\.(?:rpc\(|from\(["'][^)]+["']\)\s*\.(?:insert|update|upsert|delete)\b)/s;
const prohibitedPublicMediaAccess = /(?:getPublicUrl|temp-uploads)/;

describe("browser generation write boundary", () => {
  it("keeps the sole Creative Space surface free from browser-owned lifecycle writes", () => {
    const content = source("src/pages/CreativeSpacePage.tsx");
    expect(content).not.toMatch(prohibitedRecordMutation);
    expect(content).not.toMatch(prohibitedGenerationStorageMutation);
    expect(content).not.toMatch(prohibitedPublicMediaAccess);
  });

  it("does not render provider cost or margin evidence in the customer workspace", () => {
    const content = source("src/pages/CreativeSpacePage.tsx");
    expect(content).not.toContain("providerEstimate.atomic");
    expect(content).not.toContain("تكلفة المزوّد");
    expect(content).not.toContain("كلفة المزود");
    expect(content).not.toContain("تقدير المزود");
  });

  it("keeps the new Admin control plane read-only in the browser", () => {
    expect(source("src/pages/AdminV2Page.tsx")).not.toMatch(prohibitedAdminMutation);
  });

  it("does not re-import a retired Studio or Admin surface", () => {
    const app = source("src/App.tsx");
    for (const retiredImport of [
      "./pages/AdminPage.tsx", "./pages/PricingPage.tsx",
      "./pages/StudioPage.tsx", "./pages/UnifiedStudioPage.tsx", "./pages/LibraryPage.tsx",
      "./pages/AudioStudioPage.tsx", "GenerationQueueProvider",
    ]) {
      expect(app, retiredImport).not.toContain(retiredImport);
    }
  });
});
