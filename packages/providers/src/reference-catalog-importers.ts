import { createHash } from "node:crypto";
import { z } from "zod";

export type ReferenceCatalogModality = "text" | "image" | "video" | "audio" | "embedding";
/**
 * Source-observed presentation information is deliberately kept separate from
 * a runnable route.  It may help an operator organise a catalog review, but
 * it is never sufficient to publish a model or render a customer selector.
 */
export type ReferenceExperienceCategory = "IMAGE" | "VIDEO" | "AVATAR" | "AUDIO";
export type ReferenceModelTaxonomyHint = Readonly<{
  schemaVersion: 1;
  reviewState: "UNREVIEWED";
  source: "OFFICIAL_DOCUMENTATION" | "OFFICIAL_MODELS_API";
  productFamily: Readonly<{ id: string; displayName: string }>;
  version?: Readonly<{ id: string; displayName: string }>;
  edition?: Readonly<{ id: string; displayName: string }>;
  experienceCategories: readonly ReferenceExperienceCategory[];
}>;
export type ReferenceModelDraft = Readonly<{
  id: string;
  providerId: "kie" | "openrouter";
  providerModelId: string;
  canonicalSlug: string;
  familyId: string;
  displayName: string;
  modalities: readonly ReferenceCatalogModality[];
  supportedParameters: readonly string[];
  sourceUrls: readonly string[];
  sourceEvidenceSha256: string;
  state: "REFERENCE_ACTIVE";
  /** Requires a separate catalog review before it can affect customer UX. */
  taxonomyHint?: ReferenceModelTaxonomyHint;
}>;

export type PublicReferenceCatalogSnapshot = Readonly<{
  id: string;
  providerId: "kie" | "openrouter";
  observedAt: string;
  sourceUrls: readonly string[];
  rawPayloadSha256: string;
  manifestSha256: string;
  parserVersion: string;
  sourceScope: "PUBLIC_REFERENCE";
  models: readonly ReferenceModelDraft[];
}>;

export class ReferenceCatalogImportError extends Error {
  constructor(readonly code: "INVALID_PUBLIC_SOURCE" | "INVALID_MODEL_REFERENCE" | "DUPLICATE_MODEL_REFERENCE", message: string) {
    super(message);
    this.name = "ReferenceCatalogImportError";
  }
}

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const OpenRouterModel = z.object({
  id: z.string().min(1).max(300),
  name: z.string().min(1).max(300),
  architecture: z.object({
    input_modalities: z.array(z.string()).optional(),
    output_modalities: z.array(z.string()).optional(),
  }).optional(),
  supported_parameters: z.union([z.array(z.string()), z.record(z.unknown())]).optional(),
}).passthrough();
const OpenRouterDocument = z.object({ data: z.array(OpenRouterModel) }).passthrough();
const KieDescriptor = z.object({
  providerModelId: z.string().min(1).max(300),
  displayName: z.string().min(1).max(300),
  familyId: z.string().min(1).max(300),
  modalities: z.array(z.enum(["text", "image", "video", "audio", "embedding"])).min(1),
  supportedParameters: z.array(z.string()).default([]),
  documentationUrl: z.string().url(),
  requestExampleSha256: Hash,
}).strict();

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
function sha256(value: unknown): string { return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(canonical(value))).digest("hex"); }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "model"; }
function modalities(input: readonly string[] | undefined, output: readonly string[] | undefined): ReferenceCatalogModality[] {
  const supported = new Set<ReferenceCatalogModality>();
  for (const item of [...(input ?? []), ...(output ?? [])]) {
    if (item === "text") supported.add("text");
    if (item === "image") supported.add("image");
    if (item === "video") supported.add("video");
    if (item === "audio") supported.add("audio");
    if (item === "embeddings" || item === "embedding") supported.add("embedding");
  }
  return [...supported].sort();
}
function parameterNames(value: string[] | Record<string, unknown> | undefined): string[] {
  return [...new Set(Array.isArray(value) ? value : Object.keys(value ?? {}))].sort();
}
function modelId(providerId: string, providerModelId: string): string { return `reference.${providerId}.${sha256(providerModelId).slice(0, 24)}`; }
function titleCase(value: string): string {
  return value.split(/[\s_-]+/).filter(Boolean).map((part) => part.length <= 3 ? part.toUpperCase() : `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`).join(" ");
}
function observedTaxonomy(input: {
  source: ReferenceModelTaxonomyHint["source"];
  familyId: string;
  displayName: string;
  modalities: readonly ReferenceCatalogModality[];
}): ReferenceModelTaxonomyHint {
  const label = input.displayName.trim();
  const version = label.match(/\b(?:v(?:ersion)?\s*)?(\d+(?:\.\d+){0,2})\b/i)?.[1];
  const edition = label.match(/\b(turbo|pro|master|standard|flex|ultra)\b/i)?.[1];
  const category: ReferenceExperienceCategory | null = /\b(?:avatar|talk|lip[\s-]?sync)\b/i.test(label)
    ? "AVATAR"
    : input.modalities.includes("video") ? "VIDEO"
      : input.modalities.includes("image") ? "IMAGE"
        : input.modalities.includes("audio") ? "AUDIO" : null;
  return {
    schemaVersion: 1,
    reviewState: "UNREVIEWED",
    source: input.source,
    productFamily: { id: input.familyId, displayName: titleCase(input.familyId.replace(/^family\.(?:kie|openrouter)\./, "")) || label },
    ...(version ? { version: { id: `observed.${slug(version)}`, displayName: version } } : {}),
    ...(edition ? { edition: { id: `observed.${slug(edition)}`, displayName: titleCase(edition) } } : {}),
    experienceCategories: category ? [category] : [],
  };
}
function assertPublicUrls(urls: readonly string[]): void {
  if (!urls.length || urls.some((url) => {
    try { return new URL(url).protocol !== "https:"; } catch { return true; }
  })) throw new ReferenceCatalogImportError("INVALID_PUBLIC_SOURCE", "Reference catalog sources must be non-empty HTTPS official URLs.");
}

/**
 * OpenRouter's public model feed is a discovery source only. It never turns a
 * model into an account availability, a provider route, or a customer offer.
 */
export class OpenRouterReferenceCatalogImporter {
  static readonly sourceUrl = "https://openrouter.ai/api/v1/models";
  static readonly parserVersion = "openrouter-public-models.v1";

  import(raw: unknown, sourceUrl = OpenRouterReferenceCatalogImporter.sourceUrl): ReferenceModelDraft[] {
    const document = OpenRouterDocument.parse(raw);
    const seen = new Set<string>();
    const models: ReferenceModelDraft[] = [];
    for (const model of document.data) {
      if (model.id.includes("~") || model.id.endsWith(":free")) {
        // Moving aliases/free variants are not fixed-price references. They can
        // be kept as raw source evidence elsewhere but never enter this stable
        // model catalog as an activatable reference.
        continue;
      }
      const modelModalities = modalities(model.architecture?.input_modalities, model.architecture?.output_modalities);
      if (!modelModalities.length) continue;
      if (seen.has(model.id)) throw new ReferenceCatalogImportError("DUPLICATE_MODEL_REFERENCE", `OpenRouter model ${model.id} appears more than once.`);
      seen.add(model.id);
      models.push({
        id: modelId("openrouter", model.id), providerId: "openrouter" as const, providerModelId: model.id,
        canonicalSlug: slug(model.id), familyId: `family.openrouter.${slug(model.id.split("/")[0] ?? "unknown")}`,
        displayName: model.name, modalities: modelModalities,
        supportedParameters: parameterNames(model.supported_parameters), sourceUrls: [sourceUrl],
        sourceEvidenceSha256: sha256(model), state: "REFERENCE_ACTIVE" as const,
        taxonomyHint: observedTaxonomy({
          source: "OFFICIAL_MODELS_API", familyId: `family.openrouter.${slug(model.id.split("/")[0] ?? "unknown")}`,
          displayName: model.name, modalities: modelModalities,
        }),
      });
    }
    return models.sort((left, right) => left.providerModelId.localeCompare(right.providerModelId));
  }
}

/**
 * KIE does not provide one documented universal public model-list endpoint.
 * Its reference importer accepts only descriptors extracted from a specific
 * official documentation page and its request example hash. This prevents an
 * undocumented name or guessed model ID from entering the catalog.
 */
export class KieReferenceCatalogImporter {
  static readonly parserVersion = "kie-documentation-descriptors.v1";

  import(descriptors: readonly unknown[]): ReferenceModelDraft[] {
    const seen = new Set<string>();
    return descriptors.map((raw) => {
      const item = KieDescriptor.parse(raw);
      if (seen.has(item.providerModelId)) throw new ReferenceCatalogImportError("DUPLICATE_MODEL_REFERENCE", `KIE model ${item.providerModelId} appears more than once.`);
      seen.add(item.providerModelId);
      const taxonomyHint = observedTaxonomy({ source: "OFFICIAL_DOCUMENTATION", familyId: item.familyId, displayName: item.displayName, modalities: item.modalities });
      return {
        id: modelId("kie", item.providerModelId), providerId: "kie" as const, providerModelId: item.providerModelId,
        canonicalSlug: slug(item.providerModelId), familyId: item.familyId, displayName: item.displayName,
        modalities: [...new Set(item.modalities)].sort(), supportedParameters: [...new Set(item.supportedParameters)].sort(),
        sourceUrls: [item.documentationUrl], sourceEvidenceSha256: item.requestExampleSha256, state: "REFERENCE_ACTIVE" as const,
        taxonomyHint,
      };
    }).sort((left, right) => left.providerModelId.localeCompare(right.providerModelId));
  }
}

export function buildPublicReferenceCatalogSnapshot(input: {
  id: string;
  providerId: "kie" | "openrouter";
  observedAt: string;
  sourceUrls: readonly string[];
  rawPayload: string | unknown;
  parserVersion: string;
  models: readonly ReferenceModelDraft[];
}): PublicReferenceCatalogSnapshot {
  if (!input.id || !input.parserVersion || Number.isNaN(new Date(input.observedAt).getTime())) throw new ReferenceCatalogImportError("INVALID_PUBLIC_SOURCE", "Reference snapshot identity, parser version, and observedAt are required.");
  assertPublicUrls(input.sourceUrls);
  if (!input.models.length || input.models.some((model) => model.providerId !== input.providerId)) throw new ReferenceCatalogImportError("INVALID_MODEL_REFERENCE", "Snapshot models must be non-empty and belong to the source provider.");
  const ids = input.models.map((model) => model.providerModelId);
  if (new Set(ids).size !== ids.length) throw new ReferenceCatalogImportError("DUPLICATE_MODEL_REFERENCE", "Snapshot contains duplicate provider model IDs.");
  const models = [...input.models].sort((left, right) => left.providerModelId.localeCompare(right.providerModelId));
  return {
    id: input.id, providerId: input.providerId, observedAt: new Date(input.observedAt).toISOString(), sourceUrls: [...input.sourceUrls],
    rawPayloadSha256: sha256(input.rawPayload), manifestSha256: sha256(models), parserVersion: input.parserVersion,
    sourceScope: "PUBLIC_REFERENCE", models,
  };
}
