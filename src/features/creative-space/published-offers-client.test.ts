import { describe, expect, it } from "vitest";
import {
  diffPublishedOfferCompatibility,
  evaluatePublishedOfferControls,
  normalizePublishedOffer,
  publishedOfferControlValue,
  publishedOfferFamilyControls,
  publishedOfferFamilyControlValues,
  publishedOfferFamilyKey,
  resolvePublishedOfferFamilyVariant,
  publishedOfferSupportsRecipe,
  publishedSettingsEqual,
  reconcilePublishedOfferSettings,
  type PublishedOffer,
} from "./published-offers-client";

const recipe = (recipeId = "image.create"): PublishedOffer["capability"]["controlSchema"]["recipes"][number] => ({
  recipeId,
  prompt: { required: true, maxLength: 1200, visible: true },
  bindings: recipeId === "image.edit"
    ? { min: 1, max: 1, roles: ["SOURCE"], slots: [{ role: "SOURCE", kind: "IMAGE", required: true }] }
    : { min: 0, max: 0, roles: [], slots: [] },
  controls: [],
});

const offer = (input: { offerId?: string; recipes?: PublishedOffer["capability"]["controlSchema"]["recipes"]; providerModelId?: string } = {}): PublishedOffer => ({
  contractVersion: 2,
  offerId: input.offerId ?? "offer.image",
  displayName: "Image",
  modelFamilyId: "family.image",
  providerId: "openrouter",
  providerModelId: input.providerModelId ?? "openai/gpt-image",
  modalities: ["image"],
  identity: { familyId: "family.image", officialModelId: input.providerModelId ?? "openai/gpt-image", providerId: "openrouter" },
  customerPriceVersionId: "price.v1",
  commercialRecipeVersionId: "recipe.v1",
  releaseBundleId: "bundle.v1",
  releaseBundleVersion: 1,
  capability: {
    schemaVersion: 2,
    id: "capability.v1",
    version: 1,
    mediaType: "image",
    inputModes: ["text", "image"],
    semanticSlots: ["SOURCE"],
    maxReferences: 1,
    resolutions: ["1K"],
    durationSeconds: null,
    characterCount: null,
    supportsAudio: false,
    outputHasAudio: false,
    controlSchema: { version: "test.controls.v2", recipes: input.recipes ?? [recipe(), recipe("image.edit")] },
  },
  evidence: {
    level: "SERVER_VERIFIED",
    capabilityVersionId: "capability.v1",
    capabilityVersion: 1,
    controlSchemaVersion: "test.controls.v2",
    catalogSnapshotId: "snapshot.v1",
    catalogSnapshotVersion: 1,
    commercialRegistryEvidenceSha256: "c".repeat(64),
    contractSha256: "d".repeat(64),
  },
});

describe("PublishedOffer capability contract v2", () => {
  it("uses only released recipe records as the customer recipe authority", () => {
    expect(publishedOfferSupportsRecipe(offer(), "image.create")).toBe(true);
    expect(publishedOfferSupportsRecipe(offer(), "image.edit")).toBe(true);
    expect(publishedOfferSupportsRecipe(offer(), "video.text-to-video")).toBe(false);
    expect(publishedOfferSupportsRecipe(offer({ recipes: [recipe()] }), "image.edit")).toBe(false);
  });

  it("maps a valid v1 offer completely into v2 without inventing evidence", () => {
    const v2 = offer();
    const { contractVersion: _contract, identity: _identity, evidence: _evidence, capability, ...legacyBase } = v2;
    const { schemaVersion: _schema, ...legacyCapability } = capability;
    const upgraded = normalizePublishedOffer({ ...legacyBase, capability: legacyCapability });
    expect(upgraded).toMatchObject({
      contractVersion: 2,
      identity: { familyId: "family.image", officialModelId: "openai/gpt-image", providerId: "openrouter" },
      capability: { schemaVersion: 2 },
      evidence: { level: "LEGACY_ADAPTED", contractSha256: null },
    });
  });

  it("fails closed for unknown contract versions, mismatched identity or invalid evidence", () => {
    expect(normalizePublishedOffer({ ...offer(), contractVersion: 3 })).toBeNull();
    expect(normalizePublishedOffer({ ...offer(), identity: { ...offer().identity, officialModelId: "other/model" } })).toBeNull();
    expect(normalizePublishedOffer({ ...offer(), evidence: { ...offer().evidence, contractSha256: "not-a-hash" } })).toBeNull();
    const invalidCondition = offer({ recipes: [{ ...recipe(), controls: [{
      id: "quality", kind: "enum", defaultValue: "standard", values: ["standard"],
      visibleWhen: { controlId: "missing", operator: "EQUALS", value: true },
    }] }] });
    expect(normalizePublishedOffer(invalidCondition)).toBeNull();
  });

  it("hydrates exact defaults, keeps valid values and discards stale settings", () => {
    const selected = offer({ recipes: [{
      ...recipe(),
      controls: [
        { id: "resolution", kind: "enum", defaultValue: "1K", values: ["1K", "2K", "4K"], ui: { labelKey: "control.resolution", group: "BASIC", order: 1 } },
        { id: "aspectRatio", kind: "enum", defaultValue: "1:1", values: ["1:1", "9:16"], ui: { labelKey: "control.aspectRatio", group: "BASIC", order: 2 } },
      ],
    }] });
    const settings = reconcilePublishedOfferSettings(selected, "image.create", { resolution: "8K", aspectRatio: "9:16", legacy: true });
    expect(settings).toEqual({ resolution: "1K", aspectRatio: "9:16" });
    expect(publishedSettingsEqual(settings!, { resolution: "1K", aspectRatio: "9:16" })).toBe(true);
  });

  it("keeps certified commercial variants under one provider model family", () => {
    const oneK = offer({ offerId: "offer.1k", recipes: [{ ...recipe(), controls: [
      { id: "resolution", kind: "enum", defaultValue: "1K", values: ["1K"] },
    ] }] });
    const fourK = offer({ offerId: "offer.4k", recipes: [{ ...recipe(), controls: [
      { id: "resolution", kind: "enum", defaultValue: "4K", values: ["4K"] },
    ] }] });
    const otherRoute = offer({ offerId: "offer.other", providerModelId: "openai/other-image" });
    expect(publishedOfferFamilyKey(oneK, "image.create"))
      .toBe(publishedOfferFamilyKey(fourK, "image.create"));
    expect(publishedOfferFamilyKey(oneK, "image.create"))
      .not.toBe(publishedOfferFamilyKey(otherRoute, "image.create"));
    expect(publishedOfferControlValue(fourK, "image.create", "resolution"))
      .toBe("4K");
  });

  it("resolves every customer setting to the exact compatible priced variant", () => {
    const low = offer({ offerId: "offer.low", recipes: [{ ...recipe(), controls: [
      { id: "resolution", kind: "enum", defaultValue: "1K", values: ["1K"] },
      { id: "quality", kind: "enum", defaultValue: "standard", values: ["standard"] },
    ] }] });
    const high = offer({ offerId: "offer.high", recipes: [{ ...recipe(), controls: [
      { id: "resolution", kind: "enum", defaultValue: "4K", values: ["4K"] },
      { id: "quality", kind: "enum", defaultValue: "high", values: ["high"] },
    ] }] });
    expect(publishedOfferFamilyControls([low, high], "image.create", { resolution: "1K", quality: "standard" })
      .map(({ control }) => [control.id, control.values]))
      .toEqual([["resolution", ["1K", "4K"]], ["quality", ["standard", "high"]]]);
    expect(resolvePublishedOfferFamilyVariant({
      offers: [low, high], selectedOffer: low, recipeId: "image.create",
      desiredSettings: { resolution: "4K", quality: "high" }, changedControlId: "resolution",
    })).toMatchObject({ offer: { offerId: "offer.high" }, settings: { resolution: "4K", quality: "high" } });
    // A catalog-proven one-to-one setting is derived, rather than making the
    // customer manually select two values for the same priced SKU.
    expect(resolvePublishedOfferFamilyVariant({
      offers: [low, high], selectedOffer: low, recipeId: "image.create",
      desiredSettings: { resolution: "4K", quality: "standard" }, changedControlId: "resolution",
    })).toMatchObject({ offer: { offerId: "offer.high" }, settings: { resolution: "4K", quality: "high" } });
  });

  it("shows only settings that have an exact priced variant in a coupled family", () => {
    const fiveSeconds = offer({ offerId: "offer.5s", recipes: [{ ...recipe("video.image-to-video"), controls: [
      { id: "durationSeconds", kind: "enum", defaultValue: 5, values: [5] },
      { id: "quality", kind: "enum", defaultValue: "standard", values: ["standard"] },
      { id: "resolution", kind: "enum", defaultValue: "720p", values: ["720p"] },
    ] }] });
    const tenSeconds = offer({ offerId: "offer.10s", recipes: [{ ...recipe("video.image-to-video"), controls: [
      { id: "durationSeconds", kind: "enum", defaultValue: 10, values: [10] },
      { id: "quality", kind: "enum", defaultValue: "pro", values: ["pro"] },
      { id: "resolution", kind: "enum", defaultValue: "1080p", values: ["1080p"] },
    ] }] });
    const controls = publishedOfferFamilyControls([fiveSeconds, tenSeconds], "video.image-to-video", {
      durationSeconds: 5, quality: "standard", resolution: "720p",
    });
    const duration = controls.find(({ control }) => control.id === "durationSeconds")!.control;
    const quality = controls.find(({ control }) => control.id === "quality")!.control;
    expect(publishedOfferFamilyControlValues({
      offers: [fiveSeconds, tenSeconds], selectedOffer: fiveSeconds, recipeId: "video.image-to-video",
      settings: { durationSeconds: 5, quality: "standard", resolution: "720p" }, control: duration,
    })).toEqual([5, 10]);
    expect(publishedOfferFamilyControlValues({
      offers: [fiveSeconds, tenSeconds], selectedOffer: fiveSeconds, recipeId: "video.image-to-video",
      settings: { durationSeconds: 5, quality: "standard", resolution: "720p" }, control: quality,
    })).toEqual(["standard", "pro"]);
  });

  it("turns a certified numeric duration range into only exact priced choices", () => {
    const fiveSeconds = offer({ offerId: "offer.numeric.5s", recipes: [{ ...recipe("video.image-to-video"), controls: [
      { id: "durationSeconds", kind: "number", defaultValue: 5, min: 5, max: 5, step: 1 },
      { id: "quality", kind: "enum", defaultValue: "standard", values: ["standard"] },
    ] }] });
    const tenSeconds = offer({ offerId: "offer.numeric.10s", recipes: [{ ...recipe("video.image-to-video"), controls: [
      { id: "durationSeconds", kind: "number", defaultValue: 10, min: 10, max: 10, step: 1 },
      { id: "quality", kind: "enum", defaultValue: "pro", values: ["pro"] },
    ] }] });
    const duration = publishedOfferFamilyControls([fiveSeconds, tenSeconds], "video.image-to-video", {
      durationSeconds: 5, quality: "standard",
    }).find(({ control }) => control.id === "durationSeconds")!.control;
    expect(duration).toMatchObject({ kind: "number", min: 5, max: 10, step: 1 });
    expect(publishedOfferFamilyControlValues({
      offers: [fiveSeconds, tenSeconds], selectedOffer: fiveSeconds, recipeId: "video.image-to-video",
      settings: { durationSeconds: 5, quality: "standard" }, control: duration,
    })).toEqual([5, 10]);
    expect(resolvePublishedOfferFamilyVariant({
      offers: [fiveSeconds, tenSeconds], selectedOffer: fiveSeconds, recipeId: "video.image-to-video",
      desiredSettings: { durationSeconds: 10, quality: "standard" }, changedControlId: "durationSeconds",
    })).toMatchObject({ offer: { offerId: "offer.numeric.10s" }, settings: { durationSeconds: 10, quality: "pro" } });
  });

  it("evaluates conditional controls in deterministic manifest order", () => {
    const selected = offer({ recipes: [{
      ...recipe(),
      controls: [
        { id: "audio", kind: "boolean", defaultValue: false },
        { id: "voice", kind: "enum", defaultValue: "alloy", values: ["alloy", "nova"], visibleWhen: { controlId: "audio", operator: "EQUALS", value: true } },
      ],
    }] });
    expect(evaluatePublishedOfferControls(selected, "image.create", { audio: false }).map(({ control, visible }) => [control.id, visible]))
      .toEqual([["audio", true], ["voice", false]]);
    expect(evaluatePublishedOfferControls(selected, "image.create", { audio: true }).map(({ control, visible }) => [control.id, visible]))
      .toEqual([["audio", true], ["voice", true]]);
  });

  it("retains a model's independently supported controls without manufacturing the others", () => {
    const qualityOnly = offer({ recipes: [{ ...recipe("video.image-to-video"), controls: [
      { id: "quality", kind: "enum", defaultValue: "pro", values: ["standard", "pro"] },
    ] }] });
    const controls = publishedOfferFamilyControls([qualityOnly], "video.image-to-video");
    expect(controls.map(({ control }) => control.id)).toEqual(["quality"]);
    expect(publishedOfferFamilyControlValues({
      offers: [qualityOnly], selectedOffer: qualityOnly, recipeId: "video.image-to-video",
      settings: { quality: "pro" }, control: controls[0]!.control,
    })).toEqual(["standard", "pro"]);
  });

  it("returns a complete compatibility diff before a model change", () => {
    const from = offer({ offerId: "offer.from", recipes: [{ ...recipe("image.edit"), controls: [
      { id: "resolution", kind: "enum", defaultValue: "1K", values: ["1K", "2K"] },
      { id: "style", kind: "enum", defaultValue: "photo", values: ["photo", "art"] },
    ] }] });
    const to = offer({ offerId: "offer.to", providerModelId: "openai/gpt-image-2", recipes: [{ ...recipe("image.edit"), controls: [
      { id: "resolution", kind: "enum", defaultValue: "2K", values: ["2K", "4K"] },
      { id: "quality", kind: "enum", defaultValue: "standard", values: ["standard", "high"] },
    ] }] });
    const diff = diffPublishedOfferCompatibility({
      fromOffer: from,
      toOffer: to,
      recipeId: "image.edit",
      settings: { resolution: "1K", style: "art" },
      bindings: [{ assetId: "asset-image", role: "SOURCE", kind: "IMAGE" }, { assetId: "asset-audio", role: "VOICE_AUDIO", kind: "AUDIO" }],
    });
    expect(diff).toEqual({
      retainedBindingIds: ["asset-image"],
      incompatibleBindings: [{ assetId: "asset-audio", reason: "ROLE_UNSUPPORTED" }],
      retainedSettings: [],
      resetSettings: ["resolution"],
      removedSettings: ["style"],
      addedSettings: ["quality"],
      quoteInvalidated: true,
    });
  });
});
