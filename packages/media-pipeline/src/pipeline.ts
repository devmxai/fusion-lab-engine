import { createHash } from "node:crypto";
import { type PrivateObjectStore } from "./private-store.ts";
import { type ProviderSourceUrlGuard } from "./url-guard.ts";
import { type MalwareScanner, validateMediaBytes } from "./validator.ts";
import {
  MediaPipelineError,
  type MediaIngestPolicy,
  type MediaType,
  type PrivateMediaObject,
  type PrivateMediaRead,
  type ProviderAssetSourcePolicy,
} from "./types.ts";

export type FetchedProviderAsset = { bytes: Uint8Array; contentType: string; sourceUrl: string };

export class PrivateMediaPipeline {
  constructor(
    private readonly store: PrivateObjectStore,
    private readonly urlGuard: ProviderSourceUrlGuard,
    private readonly scanner: MalwareScanner,
    private readonly policy: MediaIngestPolicy,
  ) {}

  createAccessGrant(object: PrivateMediaObject, ownerId: string, ttlSeconds = 300): string {
    if (ttlSeconds > this.policy.maximumAccessGrantSeconds) {
      throw new MediaPipelineError("ACCESS_DENIED", "Requested media access grant exceeds the maximum lifetime.");
    }
    return this.store.createAccessGrant(object.id, ownerId, ttlSeconds);
  }

  refreshAccessGrant(objectId: string, ownerId: string, ttlSeconds = 300): string {
    if (ttlSeconds > this.policy.maximumAccessGrantSeconds) {
      throw new MediaPipelineError("ACCESS_DENIED", "Requested media access grant exceeds the maximum lifetime.");
    }
    return this.store.createAccessGrant(objectId, ownerId, ttlSeconds);
  }

  readWithGrant(objectId: string, token: string): PrivateMediaRead {
    return this.store.readWithGrant(objectId, token);
  }

  async ingestProviderResult(input: {
    sourceUrl: string;
    sourcePolicy: ProviderAssetSourcePolicy;
    expectedMediaType: MediaType;
    ownerId: string;
    projectId: string;
    operationId: string;
    fetchAsset: (maxBytes: number) => Promise<FetchedProviderAsset>;
  }): Promise<PrivateMediaObject> {
    await this.urlGuard.assertAllowed(input.sourceUrl, input.sourcePolicy);
    const asset = await input.fetchAsset(this.policy.maxBytes[input.expectedMediaType]);
    if (asset.sourceUrl !== input.sourceUrl) {
      throw new MediaPipelineError("SOURCE_ORIGIN_NOT_ALLOWED", "Provider fetcher returned a different source URL.");
    }
    return this.ingestBytes({
      bytes: asset.bytes,
      declaredContentType: asset.contentType,
      expectedMediaType: input.expectedMediaType,
      ownerId: input.ownerId,
      projectId: input.projectId,
      operationId: input.operationId,
      bucket: "generated-originals-private",
    });
  }

  async ingestUpload(input: {
    bytes: Uint8Array;
    declaredContentType: string;
    expectedMediaType: MediaType;
    ownerId: string;
    projectId: string;
    uploadId: string;
  }): Promise<PrivateMediaObject> {
    return this.ingestBytes({
      ...input,
      operationId: null,
      bucket: "user-ingress-private",
    });
  }

  private async ingestBytes(input: {
    bytes: Uint8Array;
    declaredContentType: string;
    expectedMediaType: MediaType;
    ownerId: string;
    projectId: string;
    operationId: string | null;
    uploadId?: string;
    bucket: "generated-originals-private" | "user-ingress-private";
  }): Promise<PrivateMediaObject> {
    const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
    const identity = input.operationId ?? input.uploadId ?? "unbound";
    try {
      const validation = validateMediaBytes({
        bytes: input.bytes,
        declaredContentType: input.declaredContentType,
        expectedMediaType: input.expectedMediaType,
        policy: this.policy,
      });
      const scan = await this.scanner.scan(input.bytes);
      if (scan === "INFECTED") throw new MediaPipelineError("MALWARE_DETECTED", "Media scanner detected a prohibited signature.");
      if (scan === "ERROR") throw new MediaPipelineError("MALWARE_SCAN_FAILED", "Media scanner failed closed.");
      return this.store.putReady({
        objectKey: `${input.bucket}/${input.ownerId}/${identity}/${checksumSha256}`,
        bucket: input.bucket,
        ownerId: input.ownerId,
        projectId: input.projectId,
        operationId: input.operationId,
        mediaType: validation.mediaType,
        contentType: validation.contentType,
        bytes: input.bytes,
        checksumSha256,
        metadata: validation.metadata,
      });
    } catch (error) {
      if (!(error instanceof MediaPipelineError)) throw error;
      let quarantineId: string | null = null;
      if (input.bytes.byteLength <= this.policy.quarantineMaxBytes) {
        quarantineId = this.store.putQuarantine({
          objectKey: `quarantine-private/${input.ownerId}/${identity}/${checksumSha256}`,
          ownerId: input.ownerId,
          projectId: input.projectId,
          operationId: input.operationId,
          reasonCode: error.code,
          bytes: input.bytes,
          checksumSha256,
        }).id;
      }
      throw new MediaPipelineError(error.code, error.message, quarantineId);
    }
  }
}
