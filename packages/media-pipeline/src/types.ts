export type MediaType = "image" | "video" | "audio";

export type ProviderAssetSourcePolicy = {
  allowedOrigins: readonly string[];
  allowHttpLoopbackForLocalTest: boolean;
  allowPrivateLoopbackForLocalTest: boolean;
};

export type MediaIngestPolicy = {
  maxBytes: Record<MediaType, number>;
  allowedContentTypes: Record<MediaType, string[]>;
  quarantineMaxBytes: number;
  maximumAccessGrantSeconds: number;
};

export const defaultLocalMediaPolicy: MediaIngestPolicy = {
  maxBytes: { image: 5 * 1024 * 1024, video: 100 * 1024 * 1024, audio: 20 * 1024 * 1024 },
  allowedContentTypes: {
    image: ["image/png", "image/jpeg", "image/svg+xml"],
    video: ["video/mp4"],
    audio: ["audio/wav"],
  },
  quarantineMaxBytes: 5 * 1024 * 1024,
  maximumAccessGrantSeconds: 15 * 60,
};

export type MediaMetadata = {
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasAudio: boolean | null;
};

export type PrivateMediaObject = {
  id: string;
  objectKey: string;
  bucket: "generated-originals-private" | "user-ingress-private";
  ownerId: string;
  projectId: string;
  operationId: string | null;
  mediaType: MediaType;
  contentType: string;
  byteLength: number;
  checksumSha256: string;
  metadata: MediaMetadata;
  classification: "RESTRICTED";
  status: "READY";
  createdAt: string;
};

export type PrivateMediaRead = {
  object: PrivateMediaObject;
  bytes: Uint8Array;
};

export type QuarantineRecord = {
  id: string;
  objectKey: string;
  bucket: "quarantine-private";
  ownerId: string;
  projectId: string;
  operationId: string | null;
  reasonCode: string;
  byteLength: number;
  checksumSha256: string;
  createdAt: string;
};

export class MediaPipelineError extends Error {
  constructor(
    public readonly code:
      | "INVALID_SOURCE_URL"
      | "SOURCE_ORIGIN_NOT_ALLOWED"
      | "SOURCE_DNS_REJECTED"
      | "SOURCE_PRIVATE_IP_REJECTED"
      | "MEDIA_EMPTY"
      | "MEDIA_TOO_LARGE"
      | "MEDIA_MAGIC_UNKNOWN"
      | "MEDIA_TYPE_MISMATCH"
      | "MEDIA_ACTIVE_CONTENT_REJECTED"
      | "MALWARE_DETECTED"
      | "MALWARE_SCAN_FAILED"
      | "PRIVATE_OBJECT_CONFLICT"
      | "PRIVATE_OBJECT_NOT_FOUND"
      | "ACCESS_DENIED"
      | "ACCESS_GRANT_EXPIRED"
      | "UPLOAD_NOT_FOUND"
      | "UPLOAD_EXPIRED"
      | "UPLOAD_OFFSET_MISMATCH"
      | "UPLOAD_SIZE_MISMATCH"
      | "UPLOAD_CHECKSUM_MISMATCH",
    message: string,
    public readonly quarantineId: string | null = null,
  ) {
    super(message);
    this.name = "MediaPipelineError";
  }
}
