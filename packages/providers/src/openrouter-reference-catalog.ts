import { createHash } from "node:crypto";
import { z } from "zod";
import {
  buildPublicReferenceCatalogSnapshot,
  OpenRouterReferenceCatalogImporter,
  type PublicReferenceCatalogSnapshot,
  type ReferenceModelDraft,
} from "./reference-catalog-importers.js";

export const openRouterCatalogSources = {
  models: "https://openrouter.ai/api/v1/models?output_modalities=all",
  images: "https://openrouter.ai/api/v1/images/models",
  videos: "https://openrouter.ai/api/v1/videos/models",
} as const;

const VideoDocument = z.object({ data: z.array(z.object({
  id: z.string().min(1).max(300), name: z.string().min(1).max(300),
  allowed_passthrough_parameters: z.array(z.string()).nullish(),
  supported_aspect_ratios: z.array(z.string()).nullish(),
  supported_durations: z.array(z.number()).nullish(),
  supported_frame_images: z.array(z.string()).nullish(),
  supported_resolutions: z.array(z.string()).nullish(),
}).passthrough()) }).passthrough();

export type OpenRouterReferenceSources = Readonly<{
  models: unknown;
  images?: unknown;
  videos?: unknown;
}>;

/**
 * The transport boundary for public reference intake.  It is intentionally
 * supplied by the caller: importing a catalog must never create a surprise
 * outbound request or consume a provider credential.
 */
export type OpenRouterReferenceSourceRead = Readonly<{
  body: unknown;
  observedAt?: string;
  etag?: string | null;
  contentType?: string | null;
}>;

export type OpenRouterReferenceSourceCapture = Readonly<{
  sourceUrl: string;
  observedAt: string;
  rawPayloadSha256: string;
  byteLength: number;
  etag: string | null;
  contentType: string | null;
  body: unknown;
}>;

export type OpenRouterReferenceIntake = Readonly<{
  captures: readonly OpenRouterReferenceSourceCapture[];
  failures: readonly Readonly<{ sourceUrl: string; code: "SOURCE_READ_FAILED" | "SOURCE_RESPONSE_TOO_LARGE"; message: string }> [];
}>;

export class OpenRouterReferenceSourceError extends Error {
  constructor(readonly code: "SOURCE_READ_FAILED" | "SOURCE_RESPONSE_TOO_LARGE", message: string) {
    super(message);
    this.name = "OpenRouterReferenceSourceError";
  }
}

/**
 * Transport-agnostic source intake. The caller supplies the reader so this
 * layer cannot secretly make an external request or access a credential.
 */
export class OpenRouterReferenceSourceLoader {
  async load(read: (url: string) => Promise<unknown>): Promise<OpenRouterReferenceSources> {
    const [models, images, videos] = await Promise.all([
      read(openRouterCatalogSources.models), read(openRouterCatalogSources.images), read(openRouterCatalogSources.videos),
    ]);
    return { models, images, videos };
  }

  /**
   * Captures evidence per official source.  It never converts a partial read
   * into a catalog snapshot: callers must explicitly reject failures before
   * review.  The legacy `load` helper remains useful for fixture-only tests.
   */
  async capture(
    read: (url: string) => Promise<OpenRouterReferenceSourceRead>,
    options: { now?: () => Date; maxBytes?: number } = {},
  ): Promise<OpenRouterReferenceIntake> {
    const now = options.now ?? (() => new Date());
    const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("invalid_reference_source_max_bytes");
    const sourceUrls = Object.values(openRouterCatalogSources);
    const settled = await Promise.allSettled(sourceUrls.map(async (sourceUrl) => {
      const result = await read(sourceUrl);
      const raw = JSON.stringify(result.body);
      const byteLength = Buffer.byteLength(raw, "utf8");
      if (byteLength > maxBytes) {
        throw new OpenRouterReferenceSourceError("SOURCE_RESPONSE_TOO_LARGE", `Reference source ${sourceUrl} exceeds the ${maxBytes} byte intake limit.`);
      }
      const observedAt = (result.observedAt ? new Date(result.observedAt) : now());
      if (Number.isNaN(observedAt.getTime())) throw new OpenRouterReferenceSourceError("SOURCE_READ_FAILED", `Reference source ${sourceUrl} returned an invalid observation time.`);
      return {
        sourceUrl,
        observedAt: observedAt.toISOString(),
        rawPayloadSha256: createHash("sha256").update(raw).digest("hex"),
        byteLength,
        etag: result.etag ?? null,
        contentType: result.contentType ?? null,
        body: result.body,
      } as OpenRouterReferenceSourceCapture;
    }));
    const captures: OpenRouterReferenceSourceCapture[] = [];
    const failures: Array<{ sourceUrl: string; code: "SOURCE_READ_FAILED" | "SOURCE_RESPONSE_TOO_LARGE"; message: string }> = [];
    for (const [index, result] of settled.entries()) {
      const sourceUrl = sourceUrls[index]!;
      if (result.status === "fulfilled") captures.push(result.value);
      else {
        const error = result.reason;
        failures.push({
          sourceUrl,
          code: error instanceof OpenRouterReferenceSourceError ? error.code : "SOURCE_READ_FAILED",
          message: error instanceof Error ? error.message : "Reference source read failed.",
        });
      }
    }
    return { captures: captures.sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)), failures };
  }
}

function merge(models: readonly ReferenceModelDraft[]): ReferenceModelDraft[] {
  const merged = new Map<string, ReferenceModelDraft>();
  for (const model of models) {
    const before = merged.get(model.providerModelId);
    if (!before) { merged.set(model.providerModelId, model); continue; }
    merged.set(model.providerModelId, {
      ...before,
      displayName: before.displayName.length >= model.displayName.length ? before.displayName : model.displayName,
      modalities: [...new Set([...before.modalities, ...model.modalities])].sort(),
      supportedParameters: [...new Set([...before.supportedParameters, ...model.supportedParameters])].sort(),
      sourceUrls: [...new Set([...before.sourceUrls, ...model.sourceUrls])].sort(),
      sourceEvidenceSha256: createHash("sha256").update(`${before.sourceEvidenceSha256}:${model.sourceEvidenceSha256}`).digest("hex"),
    });
  }
  return [...merged.values()].sort((left, right) => left.providerModelId.localeCompare(right.providerModelId));
}

/** Normalizes the official general/image/video source documents into one reference-only catalog. */
export class OpenRouterReferenceCatalogBundleImporter {
  import(sources: OpenRouterReferenceSources): ReferenceModelDraft[] {
    const importer = new OpenRouterReferenceCatalogImporter();
    const common = importer.import(sources.models, openRouterCatalogSources.models);
    // The image list uses the same model fields, including object-form
    // supported_parameters. It adds endpoint-discovery evidence, not a route.
    const images = sources.images ? importer.import(sources.images, openRouterCatalogSources.images) : [];
    const video = sources.videos ? VideoDocument.parse(sources.videos).data.map((model) => ({
      id: model.id, name: model.name,
      architecture: { input_modalities: ["text"], output_modalities: ["video"] },
      supported_parameters: [
        ...(model.allowed_passthrough_parameters ?? []),
        ...(model.supported_aspect_ratios?.length ? ["aspect_ratio"] : []),
        ...(model.supported_durations?.length ? ["duration"] : []),
        ...(model.supported_frame_images?.length ? ["frame_images"] : []),
        ...(model.supported_resolutions?.length ? ["resolution"] : []),
      ],
    })) : [];
    return merge([...common, ...images, ...importer.import({ data: video }, openRouterCatalogSources.videos)]);
  }

  snapshot(input: { id: string; observedAt: string; sources: OpenRouterReferenceSources }): PublicReferenceCatalogSnapshot {
    const models = this.import(input.sources);
    return buildPublicReferenceCatalogSnapshot({
      id: input.id, providerId: "openrouter", observedAt: input.observedAt,
      sourceUrls: [
        openRouterCatalogSources.models,
        ...(input.sources.images ? [openRouterCatalogSources.images] : []),
        ...(input.sources.videos ? [openRouterCatalogSources.videos] : []),
      ],
      rawPayload: input.sources, parserVersion: "openrouter-reference-bundle.v1", models,
    });
  }

  snapshotFromIntake(input: { id: string; intake: OpenRouterReferenceIntake }): PublicReferenceCatalogSnapshot {
    if (input.intake.failures.length) {
      throw new OpenRouterReferenceSourceError("SOURCE_READ_FAILED", "A Reference Catalog snapshot cannot be built from a partial OpenRouter intake.");
    }
    const captures = new Map(input.intake.captures.map((capture) => [capture.sourceUrl, capture]));
    const models = captures.get(openRouterCatalogSources.models);
    const images = captures.get(openRouterCatalogSources.images);
    const videos = captures.get(openRouterCatalogSources.videos);
    if (!models || !images || !videos) {
      throw new OpenRouterReferenceSourceError("SOURCE_READ_FAILED", "A complete OpenRouter intake requires models, images, and videos evidence.");
    }
    const observedAt = [models, images, videos].map((capture) => capture.observedAt).sort().at(-1)!;
    return this.snapshot({ id: input.id, observedAt, sources: { models: models.body, images: images.body, videos: videos.body } });
  }
}
