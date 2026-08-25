import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PROJECT_VIEW_LABELS,
  UI_FUX_DIRECTIONS,
  UI_FUX_PRODUCT_DECISIONS,
  UI_FUX_SUPPORTED_LOCALES,
  projectViewLabel,
  userFacingProjectActivitySummary,
} from "./product-decisions";

describe("UI FUX Phase 0 product decisions", () => {
  it("keeps the two locale surfaces explicit and direction-safe", () => {
    expect(UI_FUX_SUPPORTED_LOCALES).toEqual(["en", "ar"]);
    expect(UI_FUX_DIRECTIONS).toEqual({ en: "ltr", ar: "rtl" });
  });

  it("maps the persisted legacy mode to the public Space product name", () => {
    expect(PROJECT_VIEW_LABELS.STANDARD).toEqual({ en: "Standard", ar: "Standard" });
    expect(PROJECT_VIEW_LABELS.PROFESSIONAL).toEqual({ en: "Space", ar: "Space" });
    expect(projectViewLabel("PROFESSIONAL", "en")).toBe("Space");
    expect(projectViewLabel("PROFESSIONAL", "ar")).toBe("Space");
  });

  it("freezes Image-first, Published Offers, one domain truth and two projections", () => {
    expect(UI_FUX_PRODUCT_DECISIONS).toMatchObject({
      firstVerticalSlice: "IMAGE",
      customerModelSource: "PUBLISHED_OFFERS",
      projectDomainTruth: ["assets", "operations", "bindings"],
      standardPresentation: "GALLERY",
      spacePresentation: "GRAPH",
    });
  });

  it("normalizes legacy activity copy without mutating domain identifiers", () => {
    expect(userFacingProjectActivitySummary("Professional group created · Edit sequence"))
      .toBe("Space group created · Edit sequence");
    expect(userFacingProjectActivitySummary("Asset uploaded · source.png"))
      .toBe("Asset uploaded · source.png");
  });

  it("prevents the legacy product name from returning to visible Creative Space copy", () => {
    const pageSource = readFileSync(resolve(process.cwd(), "src/pages/CreativeSpacePage.tsx"), "utf8");
    const domainSource = readFileSync(resolve(process.cwd(), "src/features/creative-space/domain.ts"), "utf8");

    expect(pageSource).not.toContain(">Professional</");
    expect(pageSource).not.toContain("Professional Graph");
    expect(domainSource).not.toMatch(/["`]Professional (?:group|subflow|template|batch)/);
  });
});
