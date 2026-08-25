import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  legacyPathIsRetired,
  retiredLegacyPathResponse,
} from "../../supabase/functions/_shared/legacy-retirement.ts";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

const retiredFunctions = [
  "start-generation",
  "kie-ai",
  "gemini-tts",
  "complete-generation",
  "system-jobs",
] as const;

describe("legacy Edge retirement boundary", () => {
  it("returns a non-cacheable hard retirement response", async () => {
    const response = retiredLegacyPathResponse({ "Access-Control-Allow-Origin": "*" });
    expect(legacyPathIsRetired()).toBe(true);
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: "legacy_generation_path_retired",
      code: "ENGINE_V2_REQUIRED",
    });
  });

  it("puts every historical Edge entry point behind the retirement boundary", () => {
    for (const name of retiredFunctions) {
      const content = source(`supabase/functions/${name}/index.ts`);
      expect(content, name).toContain('import { legacyPathIsRetired, retiredLegacyPathResponse }');
      expect(content, name).toContain("if (legacyPathIsRetired()) return retiredLegacyPathResponse(corsHeaders);");
    }
  });
});
