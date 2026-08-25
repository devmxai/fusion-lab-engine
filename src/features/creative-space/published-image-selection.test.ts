import { describe, expect, it } from "vitest";
import { planPublishedImageOfferSelection, planPublishedImageRecipeSelection, publishedImageVersionRouteOffer } from "./published-image-selection";
import { standardPrototypeImageOffer } from "./standard-prototype-fixture";

const draft = { schemaVersion: 1 as const, projectId: "project", recipeId: "image.create" as const, inputAssetId: null, prompt: "sunrise", offerId: "from", modelId: "from", settings: { resolution: "1K", aspectRatio: "1:1", style: "Natural", detail: "Standard", seed: 42 }, anchor: { x: 0, y: 0 }, updatedAt: "2026-01-01T00:00:00.000Z" };

describe("published image offer selection", () => {
  it("does not silently apply a selection that resets a published setting", () => {
    const from = { ...standardPrototypeImageOffer, offerId: "from", providerModelId: "from", identity: { ...standardPrototypeImageOffer.identity, officialModelId: "from" } };
    const to = { ...standardPrototypeImageOffer, offerId: "to", providerModelId: "to", identity: { ...standardPrototypeImageOffer.identity, officialModelId: "to" }, capability: { ...standardPrototypeImageOffer.capability, controlSchema: { ...standardPrototypeImageOffer.capability.controlSchema, recipes: [{ ...standardPrototypeImageOffer.capability.controlSchema.recipes[0], controls: [{ id: "resolution", kind: "enum" as const, defaultValue: "2K", values: ["2K", "4K"] }] }] } } };
    const plan = planPublishedImageOfferSelection({ draft, fromOffer: from, toOffer: to, now: new Date("2026-01-02T00:00:00.000Z") });
    expect(plan).toMatchObject({ valid: true, requiresConfirmation: true, reason: "COMPATIBILITY_CHANGE" });
    expect(plan.nextDraft?.settings).toEqual({ resolution: "2K" });
    expect(plan.summary).toContain("Setting reset: resolution");
  });

  it("fails closed when the released offer does not contain the current recipe", () => {
    const noCreate = { ...standardPrototypeImageOffer, capability: { ...standardPrototypeImageOffer.capability, controlSchema: { ...standardPrototypeImageOffer.capability.controlSchema, recipes: [{ ...standardPrototypeImageOffer.capability.controlSchema.recipes[0], recipeId: "image.edit", bindings: { min: 1, max: 1, roles: ["SOURCE"] } }] } } };
    expect(planPublishedImageOfferSelection({ draft, fromOffer: null, toOffer: noCreate }).valid).toBe(false);
  });

  it("does not change the model/version when a Standard intent is unsupported", () => {
    const editOnly = {
      ...standardPrototypeImageOffer,
      capability: {
        ...standardPrototypeImageOffer.capability,
        controlSchema: {
          ...standardPrototypeImageOffer.capability.controlSchema,
          recipes: [{ ...standardPrototypeImageOffer.capability.controlSchema.recipes[0], recipeId: "image.edit", bindings: { min: 1, max: 1, roles: ["SOURCE"] } }],
        },
      },
    };
    expect(planPublishedImageRecipeSelection({ draft, offer: editOnly, recipeId: "image.create" })).toEqual({ valid: false, nextDraft: null });
  });

  it("keeps the exact selected offer while applying a supported intent", () => {
    const editCapable = {
      ...standardPrototypeImageOffer,
      offerId: "exact-version",
      providerModelId: "exact-version-model",
      identity: { ...standardPrototypeImageOffer.identity, officialModelId: "exact-version-model" },
      capability: {
        ...standardPrototypeImageOffer.capability,
        controlSchema: {
          ...standardPrototypeImageOffer.capability.controlSchema,
          recipes: [{ ...standardPrototypeImageOffer.capability.controlSchema.recipes[0], recipeId: "image.edit", bindings: { min: 1, max: 1, roles: ["SOURCE"] } }],
        },
      },
    };
    const result = planPublishedImageRecipeSelection({ draft: { ...draft, inputAssetId: "asset-1" }, offer: editCapable, recipeId: "image.edit", now: new Date("2026-01-02T00:00:00.000Z") });
    expect(result).toMatchObject({ valid: true, nextDraft: { offerId: "exact-version", modelId: "exact-version-model", recipeId: "image.edit", inputAssetId: "asset-1" } });
  });

  it("uses only a released sibling route for the selected provider and model version", () => {
    const textRoute = {
      ...standardPrototypeImageOffer,
      offerId: "kie-gpt-image-2-text",
      providerId: "kie",
      providerModelId: "gpt-image-2-text-to-image",
      identity: { ...standardPrototypeImageOffer.identity, familyId: "family.gpt-image-2", officialModelId: "gpt-image-2" },
    };
    const imageToImageRoute = {
      ...textRoute,
      offerId: "kie-gpt-image-2-image",
      providerModelId: "gpt-image-2-image-to-image",
      capability: {
        ...textRoute.capability,
        controlSchema: {
          ...textRoute.capability.controlSchema,
          recipes: [{ ...textRoute.capability.controlSchema.recipes[0], recipeId: "image.edit", bindings: { min: 1, max: 1, roles: ["SOURCE"] } }],
        },
      },
    };
    const anotherProvider = { ...imageToImageRoute, offerId: "other-provider-image", providerId: "openrouter" };
    expect(publishedImageVersionRouteOffer({ offers: [textRoute, anotherProvider, imageToImageRoute], selectedOffer: textRoute, recipeId: "image.edit" })?.offerId).toBe("kie-gpt-image-2-image");
    expect(publishedImageVersionRouteOffer({ offers: [textRoute, anotherProvider], selectedOffer: textRoute, recipeId: "image.edit" })).toBeNull();
  });
});
