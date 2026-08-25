import type { SpaceViewMode } from "./domain";

export const UI_FUX_SUPPORTED_LOCALES = ["en", "ar"] as const;

export type UiFuxLocale = (typeof UI_FUX_SUPPORTED_LOCALES)[number];

export const UI_FUX_PRODUCT_DECISIONS = Object.freeze({
  defaultLocale: "en" as UiFuxLocale,
  firstVerticalSlice: "IMAGE" as const,
  customerModelSource: "PUBLISHED_OFFERS" as const,
  projectDomainTruth: ["assets", "operations", "bindings"] as const,
  standardPresentation: "GALLERY" as const,
  spacePresentation: "GRAPH" as const,
});

/**
 * `PROFESSIONAL` is a persisted legacy value and must remain readable.
 * It is never presented to customers; the public product name is Space.
 */
export const PROJECT_VIEW_LABELS = Object.freeze({
  STANDARD: Object.freeze({ en: "Standard", ar: "Standard" }),
  PROFESSIONAL: Object.freeze({ en: "Space", ar: "Space" }),
}) satisfies Readonly<Record<SpaceViewMode, Readonly<Record<UiFuxLocale, string>>>>;

export const UI_FUX_DIRECTIONS = Object.freeze({
  en: "ltr",
  ar: "rtl",
}) satisfies Readonly<Record<UiFuxLocale, "ltr" | "rtl">>;

export function projectViewLabel(mode: SpaceViewMode, locale: UiFuxLocale): string {
  return PROJECT_VIEW_LABELS[mode][locale];
}

export function userFacingProjectActivitySummary(summary: string): string {
  return summary.replace(/^Professional\b/, "Space");
}
