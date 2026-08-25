import { engineAuthorizationHeaders, ensureEngineSession } from "./engine-session";

export type PublishedSettingValue = string | number | boolean;
export type PublishedMediaKind = "image" | "video" | "audio";
export type PublishedInputMode = "text" | "image" | "audio";

export type PublishedControlCondition = Readonly<{
  controlId: string;
  operator: "EQUALS" | "NOT_EQUALS" | "IN";
  value: PublishedSettingValue | readonly PublishedSettingValue[];
}>;

export type PublishedControlV2 = Readonly<{
  id: string;
  kind: "enum" | "number" | "boolean";
  defaultValue: PublishedSettingValue;
  values?: readonly PublishedSettingValue[];
  min?: number;
  max?: number;
  step?: number;
  ui?: Readonly<{ labelKey: string; group: "BASIC" | "ADVANCED"; order: number }>;
  visibleWhen?: PublishedControlCondition;
}>;

export type PublishedRecipeV2 = Readonly<{
  recipeId: string;
  prompt: Readonly<{ required: boolean; maxLength: number; visible: boolean }>;
  bindings: Readonly<{
    min: number;
    max: number;
    roles: readonly string[];
    slots?: readonly Readonly<{ role: string; kind: "IMAGE" | "VIDEO" | "AUDIO"; required: boolean }>[];
  }>;
  controls: readonly PublishedControlV2[];
}>;

export type PublishedOffer = Readonly<{
  contractVersion: 2;
  offerId: string;
  displayName: string;
  modelFamilyId: string;
  providerId: string;
  providerModelId: string;
  modalities: readonly ("image" | "video" | "audio" | "text" | "embedding")[];
  identity: Readonly<{ familyId: string; officialModelId: string; providerId: string }>;
  presentation?: Readonly<{
    schemaVersion: 1;
    productFamily: Readonly<{ id: string; displayName: string }>;
    version?: Readonly<{ id: string; displayName: string }>;
    edition?: Readonly<{ id: string; displayName: string }>;
    experienceCategories: readonly ("IMAGE" | "VIDEO" | "AVATAR" | "AUDIO")[];
  }>;
  capability: Readonly<{
    schemaVersion: 2;
    id: string;
    version: number;
    mediaType: PublishedMediaKind;
    inputModes: readonly PublishedInputMode[];
    semanticSlots: readonly string[];
    maxReferences: number;
    resolutions: readonly string[];
    durationSeconds: Readonly<{ min: number; max: number }> | null;
    characterCount: Readonly<{ min: number; max: number }> | null;
    supportsAudio: boolean;
    outputHasAudio: boolean;
    controlSchema: Readonly<{ version: string; recipes: readonly PublishedRecipeV2[] }>;
  }>;
  customerPriceVersionId: string;
  commercialRecipeVersionId: string;
  releaseBundleId: string;
  releaseBundleVersion: number;
  evidence: Readonly<{
    level: "SERVER_VERIFIED" | "LEGACY_ADAPTED";
    capabilityVersionId: string;
    capabilityVersion: number;
    controlSchemaVersion: string;
    catalogSnapshotId: string | null;
    catalogSnapshotVersion: number | null;
    commercialRegistryEvidenceSha256: string | null;
    contractSha256: string | null;
  }>;
}>;

type LegacyPublishedOfferV1 = Omit<PublishedOffer, "contractVersion" | "identity" | "evidence" | "capability"> & {
  capability: Omit<PublishedOffer["capability"], "schemaVersion">;
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const settingValue = (value: unknown): value is PublishedSettingValue => ["string", "number", "boolean"].includes(typeof value);

function validControl(control: unknown, earlierControls: ReadonlySet<string>): control is PublishedControlV2 {
  if (!object(control) || !text(control.id) || !["enum", "number", "boolean"].includes(String(control.kind)) || !settingValue(control.defaultValue)) return false;
  if (control.kind === "enum" && (!Array.isArray(control.values) || !control.values.length || !control.values.every(settingValue) || !control.values.some((value) => Object.is(value, control.defaultValue)))) return false;
  if (control.kind === "number" && (typeof control.defaultValue !== "number" || typeof control.min !== "number" || typeof control.max !== "number" || control.min > control.max || control.defaultValue < control.min || control.defaultValue > control.max)) return false;
  if (control.kind === "boolean" && typeof control.defaultValue !== "boolean") return false;
  if (control.ui !== undefined && (!object(control.ui) || !text(control.ui.labelKey) || !["BASIC", "ADVANCED"].includes(String(control.ui.group)) || !Number.isSafeInteger(control.ui.order) || Number(control.ui.order) < 0)) return false;
  if (control.visibleWhen !== undefined) {
    if (!object(control.visibleWhen) || !text(control.visibleWhen.controlId) || !earlierControls.has(control.visibleWhen.controlId)
      || !["EQUALS", "NOT_EQUALS", "IN"].includes(String(control.visibleWhen.operator))) return false;
    if (control.visibleWhen.operator === "IN") {
      if (!Array.isArray(control.visibleWhen.value) || !control.visibleWhen.value.length || !control.visibleWhen.value.every(settingValue)) return false;
    } else if (!settingValue(control.visibleWhen.value)) return false;
  }
  return true;
}

function validCapability(value: unknown, expectedSchemaVersion: 1 | 2): boolean {
  if (!object(value) || (expectedSchemaVersion === 2 && value.schemaVersion !== 2) || !text(value.id) || !Number.isSafeInteger(value.version) || Number(value.version) < 1) return false;
  if (!["image", "video", "audio"].includes(String(value.mediaType)) || !Array.isArray(value.inputModes) || !Array.isArray(value.semanticSlots) || !Array.isArray(value.resolutions)) return false;
  if (!Number.isSafeInteger(value.maxReferences) || Number(value.maxReferences) < 0 || typeof value.supportsAudio !== "boolean" || typeof value.outputHasAudio !== "boolean") return false;
  if (!object(value.controlSchema) || !text(value.controlSchema.version) || !Array.isArray(value.controlSchema.recipes) || !value.controlSchema.recipes.length) return false;
  const recipeIds = new Set<string>();
  return value.controlSchema.recipes.every((recipe) => {
    if (!object(recipe) || !text(recipe.recipeId) || recipeIds.has(recipe.recipeId) || !object(recipe.prompt) || !object(recipe.bindings) || !Array.isArray(recipe.controls)) return false;
    recipeIds.add(recipe.recipeId);
    if (typeof recipe.prompt.required !== "boolean" || typeof recipe.prompt.visible !== "boolean" || !Number.isSafeInteger(recipe.prompt.maxLength) || Number(recipe.prompt.maxLength) < 0) return false;
    if (!Number.isSafeInteger(recipe.bindings.min) || !Number.isSafeInteger(recipe.bindings.max) || Number(recipe.bindings.min) < 0 || Number(recipe.bindings.max) < Number(recipe.bindings.min) || !Array.isArray(recipe.bindings.roles)) return false;
    const controls = new Set<string>();
    for (const control of recipe.controls) {
      if (!validControl(control, controls) || controls.has(control.id)) return false;
      controls.add(control.id);
    }
    return true;
  });
}

function validCommon(value: Record<string, unknown>): boolean {
  return text(value.offerId) && text(value.displayName) && text(value.modelFamilyId) && text(value.providerId) && text(value.providerModelId)
    && Array.isArray(value.modalities) && value.modalities.length > 0
    && text(value.customerPriceVersionId) && text(value.commercialRecipeVersionId) && text(value.releaseBundleId)
    && Number.isSafeInteger(value.releaseBundleVersion) && Number(value.releaseBundleVersion) > 0;
}

function validPresentation(value: unknown): boolean {
  if (value === undefined) return true;
  if (!object(value) || value.schemaVersion !== 1 || !object(value.productFamily) || !text(value.productFamily.id) || !text(value.productFamily.displayName)
    || !Array.isArray(value.experienceCategories) || value.experienceCategories.some((item) => !["IMAGE", "VIDEO", "AVATAR", "AUDIO"].includes(String(item)))) return false;
  for (const key of ["version", "edition"] as const) {
    if (value[key] !== undefined && (!object(value[key]) || !text((value[key] as Record<string, unknown>).id) || !text((value[key] as Record<string, unknown>).displayName))) return false;
  }
  return true;
}

export function normalizePublishedOffer(value: unknown): PublishedOffer | null {
  if (!object(value) || !validCommon(value) || !object(value.capability)) return null;
  if (value.contractVersion === 2) {
    if (!validCapability(value.capability, 2) || !validPresentation(value.presentation) || !object(value.identity) || !object(value.evidence)) return null;
    if (value.identity.familyId !== value.modelFamilyId || value.identity.officialModelId !== value.providerModelId || value.identity.providerId !== value.providerId) return null;
    if (value.evidence.level !== "SERVER_VERIFIED" || value.evidence.capabilityVersionId !== value.capability.id || value.evidence.capabilityVersion !== value.capability.version
      || value.evidence.controlSchemaVersion !== (value.capability.controlSchema as Record<string, unknown>).version
      || !text(value.evidence.catalogSnapshotId) || !Number.isSafeInteger(value.evidence.catalogSnapshotVersion) || Number(value.evidence.catalogSnapshotVersion) < 1
      || !sha256(value.evidence.commercialRegistryEvidenceSha256) || !sha256(value.evidence.contractSha256)) return null;
    return value as unknown as PublishedOffer;
  }
  if (value.contractVersion !== undefined || !validCapability(value.capability, 1)) return null;
  const legacy = value as unknown as LegacyPublishedOfferV1;
  return {
    ...legacy,
    contractVersion: 2,
    identity: { familyId: legacy.modelFamilyId, officialModelId: legacy.providerModelId, providerId: legacy.providerId },
    capability: { ...legacy.capability, schemaVersion: 2 },
    evidence: {
      level: "LEGACY_ADAPTED",
      capabilityVersionId: legacy.capability.id,
      capabilityVersion: legacy.capability.version,
      controlSchemaVersion: legacy.capability.controlSchema.version,
      catalogSnapshotId: null,
      catalogSnapshotVersion: null,
      commercialRegistryEvidenceSha256: null,
      contractSha256: null,
    },
  };
}

/** The released recipe list is the only customer recipe authority. */
export function publishedOfferSupportsRecipe(offer: PublishedOffer, recipeId: string): boolean {
  return offer.capability.controlSchema.recipes.some((recipe) => recipe.recipeId === recipeId);
}

/**
 * A customer picks a model family once; pricing variants such as 1K/2K/4K
 * stay inside that model.  The provider model id is intentionally included:
 * two provider routes must never be merged merely because their marketing
 * family name happens to match.
 */
export function publishedOfferFamilyKey(offer: PublishedOffer, recipeId: string): string {
  return `${offer.providerId}:${offer.providerModelId}:${recipeId}`;
}

/** Reads one certified control value without trusting presentation metadata. */
export function publishedOfferControlValue(
  offer: PublishedOffer,
  recipeId: string,
  controlId: string,
): PublishedSettingValue | null {
  return reconcilePublishedOfferSettings(offer, recipeId)?.[controlId] ?? null;
}

/** All priced variants that represent the same runnable provider model. */
export function publishedOfferFamilyMembers(
  offers: readonly PublishedOffer[],
  selectedOffer: PublishedOffer | null,
  recipeId: string,
): readonly PublishedOffer[] {
  if (!selectedOffer) return [];
  const family = publishedOfferFamilyKey(selectedOffer, recipeId);
  return offers.filter((offer) =>
    publishedOfferFamilyKey(offer, recipeId) === family &&
    publishedOfferSupportsRecipe(offer, recipeId),
  );
}

export type PublishedFamilyControl = Readonly<{
  control: PublishedControlV2;
  value: PublishedSettingValue;
}>;

/**
 * Merges only certified controls from a model's published commercial variants.
 * A control is not manufactured from an Admin label or a provider marketing
 * name: it must be present in the executable offer contract.
 */
export function publishedOfferFamilyControls(
  offers: readonly PublishedOffer[],
  recipeId: string,
  settings: Readonly<Record<string, unknown>> = {},
): readonly PublishedFamilyControl[] {
  const controls = new Map<string, PublishedControlV2>();
  for (const offer of offers) {
    for (const entry of evaluatePublishedOfferControls(offer, recipeId, settings)) {
      if (!entry.visible) continue;
      const previous = controls.get(entry.control.id);
      if (!previous) {
        controls.set(entry.control.id, entry.control);
        continue;
      }
      if (previous.kind === "enum" && entry.control.kind === "enum") {
        controls.set(entry.control.id, {
          ...previous,
          values: [...new Set([...(previous.values ?? []), ...(entry.control.values ?? [])])],
        });
      } else if (previous.kind === "number" && entry.control.kind === "number") {
        // A number control can represent a provider-certified range (for
        // example duration). Keep the complete published range across this
        // model family, then filter each value through the exact-SKU resolver.
        controls.set(entry.control.id, {
          ...previous,
          min: Math.min(previous.min ?? entry.control.min ?? 0, entry.control.min ?? previous.min ?? 0),
          max: Math.max(previous.max ?? entry.control.max ?? 0, entry.control.max ?? previous.max ?? 0),
          step: previous.step === entry.control.step ? previous.step : undefined,
        });
      }
    }
  }
  return [...controls.values()]
    .sort((left, right) => (left.ui?.order ?? 0) - (right.ui?.order ?? 0))
    .map((control) => {
      const current = settings[control.id];
      return {
        control,
        value: isPublishedControlValueValid(control, current)
          ? current
          : control.defaultValue,
      };
    });
}

export type PublishedOfferFamilyResolution = Readonly<{
  offer: PublishedOffer;
  settings: Readonly<Record<string, PublishedSettingValue>>;
}>;

/**
 * Returns only values that can be resolved to a certified, priced member of
 * the selected model family.  This keeps a coupled provider catalogue (for
 * example quality -> resolution, or duration -> tier) from presenting a
 * customer with a visually selectable but commercially impossible setting.
 */
export function publishedOfferFamilyControlValues(input: Readonly<{
  offers: readonly PublishedOffer[];
  selectedOffer: PublishedOffer | null;
  recipeId: string;
  settings: Readonly<Record<string, PublishedSettingValue>>;
  control: PublishedControlV2;
}>): readonly PublishedSettingValue[] {
  if (!input.selectedOffer) {
    return input.control.values ?? [input.control.defaultValue];
  }
  const candidates = input.control.kind === "number"
    ? publishedNumberControlCandidates(input.control)
    : input.control.values ?? [input.control.defaultValue];
  return candidates.filter((value) => Boolean(resolvePublishedOfferFamilyVariant({
    offers: input.offers,
    selectedOffer: input.selectedOffer,
    recipeId: input.recipeId,
    desiredSettings: { ...input.settings, [input.control.id]: value },
    changedControlId: input.control.id,
  })));
}

/**
 * Build a finite list only for discrete numeric controls. Large/free-form
 * values such as a seed remain an input; a certified 3..15 second duration
 * becomes a slider list. Every returned entry is still matched to one exact
 * published offer by `publishedOfferFamilyControlValues`.
 */
function publishedNumberControlCandidates(control: PublishedControlV2): readonly number[] {
  if (control.kind !== "number") return [];
  const min = control.min;
  const max = control.max;
  const step = control.step ?? 1;
  if (min === undefined || max === undefined || !Number.isFinite(step) || step <= 0) return [Number(control.defaultValue)];
  const count = Math.floor((max - min) / step) + 1;
  // Never turn a 0..999999 seed into an unusable million-option picker.
  if (count < 1 || count > 120) return [Number(control.defaultValue)];
  return Array.from({ length: count }, (_, index) => Number((min + (index * step)).toFixed(12)));
}

/**
 * Resolves a changed customer setting to exactly one published offer.  It is
 * the customer-side guard against a UI configuration being quoted at another
 * SKU's price.  A missing combination returns null rather than guessing.
 */
export function resolvePublishedOfferFamilyVariant(input: Readonly<{
  offers: readonly PublishedOffer[];
  selectedOffer: PublishedOffer | null;
  recipeId: string;
  desiredSettings: Readonly<Record<string, PublishedSettingValue>>;
  changedControlId: string;
}>): PublishedOfferFamilyResolution | null {
  const members = publishedOfferFamilyMembers(
    input.offers,
    input.selectedOffer,
    input.recipeId,
  );
  const candidates = members.flatMap((offer) => {
    const settings = reconcilePublishedOfferSettings(
      offer,
      input.recipeId,
      input.desiredSettings,
    );
    if (!settings || !Object.is(settings[input.changedControlId], input.desiredSettings[input.changedControlId])) return [];
    for (const [id, desired] of Object.entries(input.desiredSettings)) {
      // A control absent from an alternative variant is irrelevant only when
      // it was not the setting just changed.  This allows a model family to
      // expose a capability only where the provider actually supports it.
      if (id in settings && !Object.is(settings[id], desired)) {
        // Provider catalogues frequently express one commercial SKU through
        // coupled settings.  For example, KIE Kling 3.0's `mode` determines
        // the delivered resolution.  Treat a setting as derived only when
        // the published family proves one unambiguous value for the setting
        // the customer just changed; then return that certified value instead
        // of leaving the UI stuck on an impossible combination.
        const valuesForChangedSetting = new Set(
          members.flatMap((member) => {
            const memberSettings = reconcilePublishedOfferSettings(member, input.recipeId);
            return memberSettings
              && Object.is(memberSettings[input.changedControlId], input.desiredSettings[input.changedControlId])
              && id in memberSettings
              ? [memberSettings[id]]
              : [];
          }),
        );
        if (valuesForChangedSetting.size !== 1 || !valuesForChangedSetting.has(settings[id])) return [];
      }
    }
    return [{ offer, settings }];
  });
  return candidates.find(({ offer }) => offer.offerId === input.selectedOffer?.offerId)
    ?? candidates[0]
    ?? null;
}

function isPublishedControlValueValid(control: PublishedControlV2, value: unknown): value is PublishedSettingValue {
  if (control.kind === "enum") return !!control.values?.some((option) => Object.is(option, value));
  if (control.kind === "boolean") return typeof value === "boolean";
  return typeof value === "number" && Number.isFinite(value) && control.min !== undefined && control.max !== undefined
    && value >= control.min && value <= control.max
    && (control.step === undefined || Math.abs((value - control.min) / control.step - Math.round((value - control.min) / control.step)) < 1e-9);
}

function conditionMatches(condition: PublishedControlCondition | undefined, values: Readonly<Record<string, PublishedSettingValue>>): boolean {
  if (!condition) return true;
  const actual = values[condition.controlId];
  if (condition.operator === "IN") return Array.isArray(condition.value) && condition.value.some((candidate) => Object.is(candidate, actual));
  const equal = !Array.isArray(condition.value) && Object.is(condition.value, actual);
  return condition.operator === "EQUALS" ? equal : !equal;
}

export function evaluatePublishedOfferControls(offer: PublishedOffer, recipeId: string, settings: Readonly<Record<string, unknown>> = {}) {
  const recipe = offer.capability.controlSchema.recipes.find((candidate) => candidate.recipeId === recipeId);
  if (!recipe) return [];
  const resolved: Record<string, PublishedSettingValue> = {};
  return recipe.controls.map((control) => {
    const current = settings[control.id];
    const value = isPublishedControlValueValid(control, current) ? current : control.defaultValue;
    const visible = conditionMatches(control.visibleWhen, resolved);
    resolved[control.id] = value;
    return { control, visible, value } as const;
  });
}

/** Produces the exact settings payload certified by the published recipe. */
export function reconcilePublishedOfferSettings(offer: PublishedOffer, recipeId: string, current: Readonly<Record<string, unknown>> = {}): Record<string, PublishedSettingValue> | null {
  if (!publishedOfferSupportsRecipe(offer, recipeId)) return null;
  return Object.fromEntries(evaluatePublishedOfferControls(offer, recipeId, current).map(({ control, value }) => [control.id, value]));
}

export function publishedSettingsEqual(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && rightKeys.every((key) => Object.is(left[key], right[key]));
}

export type PublishedBindingCandidate = Readonly<{ assetId: string; role: string; kind: "IMAGE" | "VIDEO" | "AUDIO" }>;
export type PublishedOfferCompatibilityDiff = Readonly<{
  retainedBindingIds: readonly string[];
  incompatibleBindings: readonly Readonly<{ assetId: string; reason: "ROLE_UNSUPPORTED" | "KIND_UNSUPPORTED" | "BINDING_LIMIT" }>[];
  retainedSettings: readonly string[];
  resetSettings: readonly string[];
  removedSettings: readonly string[];
  addedSettings: readonly string[];
  quoteInvalidated: boolean;
}>;

export function diffPublishedOfferCompatibility(input: {
  fromOffer: PublishedOffer;
  toOffer: PublishedOffer;
  recipeId: string;
  settings: Readonly<Record<string, unknown>>;
  bindings: readonly PublishedBindingCandidate[];
}): PublishedOfferCompatibilityDiff {
  const targetRecipe = input.toOffer.capability.controlSchema.recipes.find((recipe) => recipe.recipeId === input.recipeId);
  if (!targetRecipe) return {
    retainedBindingIds: [], incompatibleBindings: input.bindings.map(({ assetId }) => ({ assetId, reason: "ROLE_UNSUPPORTED" })),
    retainedSettings: [], resetSettings: [], removedSettings: Object.keys(input.settings), addedSettings: [], quoteInvalidated: true,
  };
  const slots = new Map((targetRecipe.bindings.slots ?? []).map((slot) => [slot.role, slot.kind]));
  const retainedBindingIds: string[] = [];
  const incompatibleBindings: Array<{ assetId: string; reason: "ROLE_UNSUPPORTED" | "KIND_UNSUPPORTED" | "BINDING_LIMIT" }> = [];
  input.bindings.forEach((binding, index) => {
    const kind = slots.get(binding.role);
    if (!targetRecipe.bindings.roles.includes(binding.role)) incompatibleBindings.push({ assetId: binding.assetId, reason: "ROLE_UNSUPPORTED" });
    else if (kind && kind !== binding.kind) incompatibleBindings.push({ assetId: binding.assetId, reason: "KIND_UNSUPPORTED" });
    else if (index >= targetRecipe.bindings.max) incompatibleBindings.push({ assetId: binding.assetId, reason: "BINDING_LIMIT" });
    else retainedBindingIds.push(binding.assetId);
  });
  const target = reconcilePublishedOfferSettings(input.toOffer, input.recipeId, input.settings) ?? {};
  const targetIds = new Set(Object.keys(target));
  const retainedSettings = Object.keys(input.settings).filter((id) => targetIds.has(id) && Object.is(input.settings[id], target[id]));
  const resetSettings = Object.keys(input.settings).filter((id) => targetIds.has(id) && !Object.is(input.settings[id], target[id]));
  const removedSettings = Object.keys(input.settings).filter((id) => !targetIds.has(id));
  const addedSettings = Object.keys(target).filter((id) => !(id in input.settings));
  return {
    retainedBindingIds, incompatibleBindings, retainedSettings, resetSettings, removedSettings, addedSettings,
    quoteInvalidated: input.fromOffer.offerId !== input.toOffer.offerId || incompatibleBindings.length > 0 || resetSettings.length > 0 || removedSettings.length > 0 || addedSettings.length > 0,
  };
}

export async function loadPublishedOffers(): Promise<ReadonlyArray<PublishedOffer>> {
  await ensureEngineSession();
  const response = await fetch("/api/engine/v2/catalog/offers", { credentials: "same-origin", headers: await engineAuthorizationHeaders() });
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | unknown[] | null;
  if (!response.ok) throw new Error(!Array.isArray(payload) ? payload?.error?.message ?? "Published catalog is unavailable." : "Published catalog is unavailable.");
  if (!Array.isArray(payload)) throw new Error("Published catalog response is invalid.");
  const offers = payload.map(normalizePublishedOffer);
  if (offers.some((offer) => offer === null)) throw new Error("Published catalog contains an unsupported or invalid capability contract.");
  return offers as PublishedOffer[];
}
