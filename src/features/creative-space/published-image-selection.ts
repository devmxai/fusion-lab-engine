import type { ImageComposerDraft } from "./composer-draft";
import { diffPublishedOfferCompatibility, publishedOfferSupportsRecipe, reconcilePublishedOfferSettings, type PublishedBindingCandidate, type PublishedOffer } from "./published-offers-client";
import { customerModelVersionKey } from "./model-presentation";

export type PublishedImageOfferSelectionPlan = Readonly<{
  valid: boolean;
  requiresConfirmation: boolean;
  reason: "RECIPE_UNSUPPORTED" | "COMPATIBILITY_CHANGE" | "NO_CHANGE";
  nextDraft: ImageComposerDraft | null;
  summary: readonly string[];
}>;

/**
 * Finds the released contract for a customer intent within the exact provider
 * and customer-facing model version the customer selected.  Different routes
 * (for example text-to-image and image-to-image) may use separate provider
 * SKUs, but Standard must never silently substitute another provider or model
 * version just because it happens to support the requested recipe.
 */
export function publishedImageVersionRouteOffer(input: {
  offers: readonly PublishedOffer[];
  selectedOffer: PublishedOffer | null;
  recipeId: ImageComposerDraft["recipeId"];
}): PublishedOffer | null {
  const selected = input.selectedOffer;
  if (!selected) return null;
  const versionKey = customerModelVersionKey(selected);
  return input.offers.find(
    (offer) =>
      offer.providerId === selected.providerId &&
      offer.capability.mediaType === "image" &&
      customerModelVersionKey(offer) === versionKey &&
      publishedOfferSupportsRecipe(offer, input.recipeId),
  ) ?? null;
}

/**
 * The caller supplies one released, same-provider/same-version route. This
 * function deliberately performs no fallback search: a UI action must never
 * make a hidden provider/model substitution.
 */
export function planPublishedImageRecipeSelection(input: {
  draft: ImageComposerDraft;
  offer: PublishedOffer | null;
  recipeId: ImageComposerDraft["recipeId"];
  now?: Date;
}): Readonly<{ valid: boolean; nextDraft: ImageComposerDraft | null }> {
  const offer = input.offer;
  if (!offer || !publishedOfferSupportsRecipe(offer, input.recipeId)) {
    return { valid: false, nextDraft: null };
  }
  const recipe = offer.capability.controlSchema.recipes.find((item) => item.recipeId === input.recipeId);
  const settings = reconcilePublishedOfferSettings(offer, input.recipeId);
  if (!recipe || !settings) return { valid: false, nextDraft: null };
  return {
    valid: true,
    nextDraft: {
      ...input.draft,
      recipeId: input.recipeId,
      offerId: offer.offerId,
      modelId: offer.providerModelId,
      settings: settings as ImageComposerDraft["settings"],
      inputAssetId: recipe.bindings.max > 0 ? input.draft.inputAssetId : null,
      updatedAt: (input.now ?? new Date()).toISOString(),
    },
  };
}

/** Plans, but never silently applies, a Standard-mode published-offer change. */
export function planPublishedImageOfferSelection(input: {
  draft: ImageComposerDraft;
  fromOffer: PublishedOffer | null;
  toOffer: PublishedOffer;
  bindings?: readonly PublishedBindingCandidate[];
  now?: Date;
}): PublishedImageOfferSelectionPlan {
  if (!publishedOfferSupportsRecipe(input.toOffer, input.draft.recipeId)) return {
    valid: false, requiresConfirmation: false, reason: "RECIPE_UNSUPPORTED", nextDraft: null,
    summary: ["The selected published offer does not support the current recipe."],
  };
  const settings = reconcilePublishedOfferSettings(input.toOffer, input.draft.recipeId, input.draft.settings);
  if (!settings) return { valid: false, requiresConfirmation: false, reason: "RECIPE_UNSUPPORTED", nextDraft: null, summary: ["The selected offer has no valid published settings."] };
  const now = input.now ?? new Date();
  const nextDraft: ImageComposerDraft = {
    ...input.draft,
    offerId: input.toOffer.offerId,
    modelId: input.toOffer.providerModelId,
    settings: settings as Record<string, string | number | boolean>,
    updatedAt: now.toISOString(),
  };
  if (!input.fromOffer || input.fromOffer.offerId === input.toOffer.offerId) return { valid: true, requiresConfirmation: false, reason: "NO_CHANGE", nextDraft, summary: [] };
  const diff = diffPublishedOfferCompatibility({
    fromOffer: input.fromOffer, toOffer: input.toOffer, recipeId: input.draft.recipeId,
    settings: input.draft.settings, bindings: input.bindings ?? [],
  });
  const summary = [
    ...diff.resetSettings.map((id) => `Setting reset: ${id}`),
    ...diff.removedSettings.map((id) => `Setting removed: ${id}`),
    ...diff.addedSettings.map((id) => `Setting added: ${id}`),
    ...diff.incompatibleBindings.map(({ assetId, reason }) => `Reference ${assetId} requires review: ${reason}`),
  ];
  return { valid: true, requiresConfirmation: diff.quoteInvalidated, reason: diff.quoteInvalidated ? "COMPATIBILITY_CHANGE" : "NO_CHANGE", nextDraft, summary };
}
