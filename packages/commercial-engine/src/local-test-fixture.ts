import type {
  CommercialRegistrySnapshot,
  ModelFamilyVersion,
  ProviderRouteVersion,
  RecipeVersion,
  RouteBillingManifestVersion,
  RouteCapabilityVersion,
} from "./types.ts";

export const localTestModelIds = [
  "local/test-image-v1",
  "local/test-video-v1",
  "local/test-audio-v1",
] as const;

export type LocalTestModelId = typeof localTestModelIds[number];

export function localFamilyVersionId(modelId: LocalTestModelId): string {
  return `family:${modelId}:v1`;
}

function mediaOf(modelId: LocalTestModelId): "image" | "video" | "audio" {
  if (modelId.includes("video")) return "video";
  if (modelId.includes("audio")) return "audio";
  return "image";
}

function videoControls(forceAudio = false) {
  return [
    { id: "durationSeconds", kind: "enum" as const, values: [5, 10], defaultValue: 5 },
    { id: "resolution", kind: "enum" as const, values: ["720p", "1080p"], defaultValue: "720p" },
    { id: "aspectRatio", kind: "enum" as const, values: ["16:9", "9:16", "1:1"], defaultValue: "16:9" },
    { id: "audio", kind: "boolean" as const, values: forceAudio ? [true] : [false, true], defaultValue: forceAudio },
  ];
}

function capability(modelId: LocalTestModelId): RouteCapabilityVersion {
  const mediaType = mediaOf(modelId);
  const controlSchema: NonNullable<RouteCapabilityVersion["controlSchema"]> = mediaType === "image" ? {
    version: "provider-test.image-controls.v1",
    recipes: [{
      recipeId: "image.create", prompt: { required: true, maxLength: 1_200, visible: true },
      bindings: { min: 0, max: 0, roles: [], slots: [] },
      controls: [{ id: "aspectRatio", kind: "enum" as const, values: ["1:1", "4:5", "16:9", "9:16"], defaultValue: "1:1" }],
    }],
  } : mediaType === "video" ? {
    version: "provider-test.video-controls.v1",
    recipes: [
      {
        recipeId: "video.text-to-video", prompt: { required: true, maxLength: 1_200, visible: true },
        bindings: { min: 0, max: 0, roles: [], slots: [] },
        controls: videoControls(),
      },
      {
        recipeId: "video.image-to-video", prompt: { required: true, maxLength: 1_200, visible: true },
        bindings: { min: 1, max: 1, roles: ["FIRST_FRAME"], slots: [{ role: "FIRST_FRAME", kind: "IMAGE", required: true }] },
        controls: videoControls(),
      },
      {
        recipeId: "video.first-last", prompt: { required: true, maxLength: 1_200, visible: true },
        bindings: { min: 2, max: 2, roles: ["FIRST_FRAME", "LAST_FRAME"], slots: [{ role: "FIRST_FRAME", kind: "IMAGE", required: true }, { role: "LAST_FRAME", kind: "IMAGE", required: true }] },
        controls: videoControls(),
      },
      {
        recipeId: "video.multi-reference", prompt: { required: true, maxLength: 1_200, visible: true },
        bindings: { min: 1, max: 4, roles: ["REFERENCE"], slots: [{ role: "REFERENCE", kind: "IMAGE", required: true }] },
        controls: videoControls(),
      },
      {
        recipeId: "video.avatar", prompt: { required: false, maxLength: 1_200, visible: true },
        bindings: { min: 2, max: 2, roles: ["SOURCE", "VOICE_AUDIO"], slots: [{ role: "SOURCE", kind: "IMAGE", required: true }, { role: "VOICE_AUDIO", kind: "AUDIO", required: true }] },
        controls: videoControls(true),
      },
      {
        recipeId: "video.motion-control", prompt: { required: false, maxLength: 1_200, visible: true },
        bindings: { min: 2, max: 2, roles: ["SOURCE", "MOTION"], slots: [{ role: "SOURCE", kind: "IMAGE", required: true }, { role: "MOTION", kind: "VIDEO", required: true }] },
        controls: videoControls(),
      },
      {
        recipeId: "video.edit", prompt: { required: true, maxLength: 1_200, visible: true },
        bindings: { min: 1, max: 2, roles: ["SOURCE", "REFERENCE"], slots: [{ role: "SOURCE", kind: "VIDEO", required: true }, { role: "REFERENCE", kind: "IMAGE", required: false }] },
        controls: videoControls(),
      },
      {
        recipeId: "video.extend", prompt: { required: true, maxLength: 1_200, visible: true },
        bindings: { min: 1, max: 1, roles: ["SOURCE"], slots: [{ role: "SOURCE", kind: "VIDEO", required: true }] },
        controls: videoControls(),
      },
    ],
  } : {
    version: "provider-test.audio-controls.v1",
    recipes: [{
      recipeId: "audio.tts", prompt: { required: true, maxLength: 5_000, visible: true },
      bindings: { min: 0, max: 0, roles: [], slots: [] },
      controls: [
        { id: "voice", kind: "enum" as const, values: ["test-neutral", "test-warm"], defaultValue: "test-neutral" },
        { id: "speed", kind: "enum" as const, values: [0.75, 1, 1.25], defaultValue: 1 },
      ],
    }],
  };
  return {
    id: `capability:${modelId}:v1`,
    version: 1,
    mediaType,
    inputModes: mediaType === "image" ? ["text", "image"] : mediaType === "video" ? ["text", "image", "audio"] : ["text"],
    semanticSlots: mediaType === "video" ? ["first_frame", "last_frame", "reference", "source", "voice_audio", "motion"] : ["reference"],
    maxReferences: mediaType === "video" ? 4 : mediaType === "image" ? 4 : 0,
    resolutions: ["720p", "1080p"],
    durationSeconds: mediaType === "video" ? { min: 1, max: 60 } : null,
    characterCount: mediaType === "audio" ? { min: 1, max: 100_000 } : null,
    supportsAudio: mediaType === "video",
    outputHasAudio: mediaType === "audio",
    controlSchema,
    lifecycle: "PUBLISHED",
  };
}

function billing(modelId: LocalTestModelId): RouteBillingManifestVersion {
  const mediaType = mediaOf(modelId);
  const formula: RouteBillingManifestVersion["formula"] = mediaType === "image"
    ? { kind: "per_image", unitsPerImage: { numerator: 2n, denominator: 1n } }
    : mediaType === "video"
      ? {
          kind: "per_output_second",
          unitsPerSecond: { numerator: 2n, denominator: 1n },
          resolutionMultipliers: {
            "720p": { numerator: 1n, denominator: 1n },
            "1080p": { numerator: 3n, denominator: 2n },
          },
          audioAddonPerGeneration: { numerator: 5n, denominator: 1n },
        }
      : { kind: "per_character_block", blockSize: 100n, unitsPerBlock: { numerator: 1n, denominator: 1n } };
  return {
    id: `billing:${modelId}:v1`,
    version: 1,
    nativeUnit: "provider_credit",
    nativeScale: 1n,
    formula,
    actualUsageExtractor: "provider-test.task.actualProviderCredits.v1",
    failureChargePolicy: "NO_CHARGE_CONFIRMED_ONLY",
    lifecycle: "PUBLISHED",
  };
}

function route(modelId: LocalTestModelId): ProviderRouteVersion {
  return {
    id: `route:${modelId}:v1`,
    routeId: `route:${modelId}`,
    version: 1,
    providerId: "provider-test",
    providerAccountId: "provider-test:local-development",
    providerModelId: modelId,
    familyVersionId: localFamilyVersionId(modelId),
    capabilityVersionId: `capability:${modelId}:v1`,
    billingManifestVersionId: `billing:${modelId}:v1`,
    costVersionId: "cost:provider-test-credit:v1",
    adapterVersion: "provider-test-http.v1",
    privacy: { retention: "NONE", dataRegion: "local-loopback", allowsTraining: false },
    certification: {
      scope: "LOCAL_TEST_ONLY",
      owner: "local-test-harness",
      canaryEvidenceId: `golden:${modelId}:v1`,
      capabilityContract: true,
      goldenBilling: true,
      actualCostExtraction: true,
      resultIngest: true,
      failureRefund: true,
      privacyReview: true,
      marginShock: true,
    },
    killSwitch: { enabled: false, reasonCode: null },
    lifecycle: "PUBLISHED",
  };
}

export function createLocalTestRegistrySnapshot(options: {
  snapshotVersion?: number;
  targetContributionMarginBps?: bigint;
  hardFloorMarginBps?: bigint;
} = {}): CommercialRegistrySnapshot {
  const version = options.snapshotVersion ?? 1;
  const targetMargin = options.targetContributionMarginBps ?? 5_000n;
  const priceId = `customer-price:local:${targetMargin}:v${version}`;
  const families: ModelFamilyVersion[] = localTestModelIds.map((modelId) => ({
    id: localFamilyVersionId(modelId),
    familyId: `family:${modelId}`,
    version: 1,
    displayName: modelId.replace("local/test-", "Test ").replace("-v1", ""),
    mediaType: mediaOf(modelId),
    lifecycle: "PUBLISHED",
  }));
  const recipes: RecipeVersion[] = localTestModelIds.map((modelId) => ({
    id: `recipe:${mediaOf(modelId)}.generate:v1`,
    recipeId: `recipe:${mediaOf(modelId)}.generate`,
    version: 1,
    product: `${mediaOf(modelId)}.generate`,
    familyVersionIds: [localFamilyVersionId(modelId)],
    lifecycle: "PUBLISHED",
  }));
  return {
    id: `registry:provider-test:v${version}:margin-${targetMargin}`,
    version,
    status: "PUBLISHED",
    createdAt: "2026-08-12T00:00:00.000Z",
    families,
    recipes,
    capabilities: localTestModelIds.map(capability),
    billingManifests: localTestModelIds.map(billing),
    costVersions: [{
      id: "cost:provider-test-credit:v1",
      version: 1,
      status: "FRESH",
      nativeUnitReplacementCostMicrousd: 10_000n,
      riskBufferBps: 0n,
      maximumCostMultiplierBps: 10_000n,
      source: {
        url: "local://provider-test/golden-pricing-v1",
        snapshotHash: "a".repeat(64),
        capturedAt: "2026-08-12T00:00:00.000Z",
        validUntil: "2099-01-01T00:00:00.000Z",
      },
    }],
    customerPriceVersions: [{
      id: priceId,
      version,
      policy: "target_margin",
      manualCredits: null,
      targetContributionMarginBps: targetMargin,
      hardFloorMarginBps: options.hardFloorMarginBps ?? 2_500n,
      creditValueFloorMicrousd: 10_000n,
      allowedCreditStep: 1n,
      minimumChargeCredits: 1n,
      variablePlatformCostMicrousd: 0n,
      lifecycle: "PUBLISHED",
    }],
    routingPolicyVersions: [
      { id: `routing:exact:v${version}`, version, mode: "exact", allowStaleCost: false, staleRiskBufferBps: 2_000n, lifecycle: "PUBLISHED" },
      { id: `routing:smart-schema:v${version}`, version, mode: "smart", allowStaleCost: false, staleRiskBufferBps: 2_000n, lifecycle: "PUBLISHED" },
    ],
    routes: localTestModelIds.map(route),
  };
}
