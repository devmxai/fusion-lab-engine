import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PrivateMediaPipeline } from "./pipeline.ts";
import { InMemoryPrivateObjectStore } from "./private-store.ts";
import { InMemoryResumableUploadService } from "./resumable-upload.ts";
import { defaultLocalMediaPolicy, MediaPipelineError } from "./types.ts";
import { ProviderSourceUrlGuard } from "./url-guard.ts";
import { LocalSignatureScanner, validateMediaBytes } from "./validator.ts";

const svg = (body = "<text>TEST</text>") => new TextEncoder().encode(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">${body}</svg>`,
);

function wav(): Uint8Array {
  const bytes = new Uint8Array(52);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  view.setUint32(40, 8, true);
  return bytes;
}

function mp4(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0, 0, 0, 24], 0);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  return bytes;
}

function harness(now: () => Date = () => new Date("2026-08-12T12:00:00.000Z")) {
  let id = 0;
  const store = new InMemoryPrivateObjectStore(now, () => `media-${++id}`, () => `token-${id}`);
  const guard = new ProviderSourceUrlGuard(async () => ["93.184.216.34"]);
  const pipeline = new PrivateMediaPipeline(store, guard, new LocalSignatureScanner(), defaultLocalMediaPolicy);
  return { store, guard, pipeline };
}

describe("provider source SSRF guard", () => {
  it("allows one exact HTTPS origin resolving only to public addresses", async () => {
    const guard = new ProviderSourceUrlGuard(async () => ["93.184.216.34"]);
    await expect(guard.assertAllowed("https://media.provider.example/result/1", {
      allowedOrigins: ["https://media.provider.example"],
      allowHttpLoopbackForLocalTest: false,
      allowPrivateLoopbackForLocalTest: false,
    })).resolves.toBeInstanceOf(URL);
  });

  it("blocks metadata/private DNS, changed origins and URL credentials", async () => {
    const privateGuard = new ProviderSourceUrlGuard(async () => ["169.254.169.254"]);
    const policy = {
      allowedOrigins: ["https://media.provider.example"],
      allowHttpLoopbackForLocalTest: false,
      allowPrivateLoopbackForLocalTest: false,
    };
    await expect(privateGuard.assertAllowed("https://media.provider.example/result", policy))
      .rejects.toMatchObject({ code: "SOURCE_PRIVATE_IP_REJECTED" });
    await expect(privateGuard.assertAllowed("https://evil.example/result", policy))
      .rejects.toMatchObject({ code: "SOURCE_ORIGIN_NOT_ALLOWED" });
    await expect(privateGuard.assertAllowed("https://user:pass@media.provider.example/result", policy))
      .rejects.toMatchObject({ code: "INVALID_SOURCE_URL" });
  });

  it("allows plain HTTP only for an explicitly allowlisted loopback test provider", async () => {
    const guard = new ProviderSourceUrlGuard();
    await expect(guard.assertAllowed("http://127.0.0.1:8790/v1/assets/1", {
      allowedOrigins: ["http://127.0.0.1:8790"],
      allowHttpLoopbackForLocalTest: true,
      allowPrivateLoopbackForLocalTest: true,
    })).resolves.toBeInstanceOf(URL);
  });
});

describe("media validation and quarantine", () => {
  it("recognizes certified SVG, WAV and MP4 magic bytes", () => {
    expect(validateMediaBytes({ bytes: svg(), declaredContentType: "image/svg+xml", expectedMediaType: "image", policy: defaultLocalMediaPolicy })).toMatchObject({ contentType: "image/svg+xml", metadata: { width: 1280, height: 720 } });
    expect(validateMediaBytes({ bytes: wav(), declaredContentType: "audio/wav", expectedMediaType: "audio", policy: defaultLocalMediaPolicy }).mediaType).toBe("audio");
    expect(validateMediaBytes({ bytes: mp4(), declaredContentType: "video/mp4", expectedMediaType: "video", policy: defaultLocalMediaPolicy }).mediaType).toBe("video");
  });

  it("rejects declared MIME mismatch and active SVG content", () => {
    expect(() => validateMediaBytes({ bytes: svg(), declaredContentType: "image/png", expectedMediaType: "image", policy: defaultLocalMediaPolicy }))
      .toThrowError(expect.objectContaining<Partial<MediaPipelineError>>({ code: "MEDIA_TYPE_MISMATCH" }));
    expect(() => validateMediaBytes({ bytes: svg("<script>alert(1)</script>"), declaredContentType: "image/svg+xml", expectedMediaType: "image", policy: defaultLocalMediaPolicy }))
      .toThrowError(expect.objectContaining<Partial<MediaPipelineError>>({ code: "MEDIA_ACTIVE_CONTENT_REJECTED" }));
  });

  it("quarantines MIME violations and malware instead of publishing them", async () => {
    const { store, pipeline } = harness();
    await expect(pipeline.ingestUpload({ bytes: svg(), declaredContentType: "image/png", expectedMediaType: "image", ownerId: "user-1", projectId: "project-1", uploadId: "upload-bad-mime" }))
      .rejects.toMatchObject({ code: "MEDIA_TYPE_MISMATCH", quarantineId: "media-1" });
    await expect(pipeline.ingestUpload({ bytes: svg("<text>EICAR-STANDARD-ANTIVIRUS-TEST-FILE</text>"), declaredContentType: "image/svg+xml", expectedMediaType: "image", ownerId: "user-1", projectId: "project-1", uploadId: "upload-malware" }))
      .rejects.toMatchObject({ code: "MALWARE_DETECTED", quarantineId: "media-2" });
    expect(store.quarantineSnapshot()).toHaveLength(2);
  });

  it("fails closed for oversized content", async () => {
    const policy = structuredClone(defaultLocalMediaPolicy);
    policy.maxBytes.image = 10;
    const store = new InMemoryPrivateObjectStore();
    const pipeline = new PrivateMediaPipeline(store, new ProviderSourceUrlGuard(), new LocalSignatureScanner(), policy);
    await expect(pipeline.ingestUpload({ bytes: svg(), declaredContentType: "image/svg+xml", expectedMediaType: "image", ownerId: "user-1", projectId: "project-1", uploadId: "large" }))
      .rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
  });
});

describe("private object access", () => {
  it("requires a short-lived owner grant and returns defensive byte copies", async () => {
    let nowMs = Date.parse("2026-08-12T12:00:00.000Z");
    const { pipeline } = harness(() => new Date(nowMs));
    const object = await pipeline.ingestUpload({ bytes: svg(), declaredContentType: "image/svg+xml", expectedMediaType: "image", ownerId: "user-1", projectId: "project-1", uploadId: "upload-1" });
    expect(() => pipeline.readWithGrant(object.id, "missing")).toThrowError(expect.objectContaining<Partial<MediaPipelineError>>({ code: "ACCESS_DENIED" }));
    expect(() => pipeline.createAccessGrant(object, "user-2", 60)).toThrowError(expect.objectContaining<Partial<MediaPipelineError>>({ code: "ACCESS_DENIED" }));
    expect(() => pipeline.createAccessGrant(object, "user-1", 901)).toThrowError(expect.objectContaining<Partial<MediaPipelineError>>({ code: "ACCESS_DENIED" }));
    const token = pipeline.createAccessGrant(object, "user-1", 60);
    const first = pipeline.readWithGrant(object.id, token);
    first.bytes[0] = 0;
    expect(pipeline.readWithGrant(object.id, token).bytes[0]).not.toBe(0);
    nowMs += 60_000;
    expect(() => pipeline.readWithGrant(object.id, token)).toThrowError(expect.objectContaining<Partial<MediaPipelineError>>({ code: "ACCESS_GRANT_EXPIRED" }));
  });
});

describe("resumable private upload", () => {
  it("resumes after interruption at an exact offset and finalizes idempotently", async () => {
    const { pipeline } = harness();
    const uploads = new InMemoryResumableUploadService(pipeline, () => new Date("2026-08-12T12:00:00.000Z"), () => "upload-1");
    const bytes = svg();
    const intent = uploads.createIntent({
      ownerId: "user-1",
      projectId: "project-1",
      expectedMediaType: "image",
      declaredContentType: "image/svg+xml",
      expectedBytes: bytes.byteLength,
      expectedChecksumSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const split = 20;
    expect(uploads.append(intent.uploadId, "user-1", 0, bytes.slice(0, split)).offset).toBe(split);
    expect(uploads.status(intent.uploadId, "user-1").offset).toBe(split);
    expect(() => uploads.append(intent.uploadId, "user-1", 0, bytes.slice(split)))
      .toThrowError(expect.objectContaining<Partial<MediaPipelineError>>({ code: "UPLOAD_OFFSET_MISMATCH" }));
    expect(uploads.append(intent.uploadId, "user-1", split, bytes.slice(split)).complete).toBe(true);
    const first = await uploads.finalize(intent.uploadId, "user-1");
    const replay = await uploads.finalize(intent.uploadId, "user-1");
    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({ bucket: "user-ingress-private", checksumSha256: createHash("sha256").update(bytes).digest("hex") });
  });

  it("rejects cross-owner access, incomplete finalize and checksum mismatch", async () => {
    const { pipeline } = harness();
    let sequence = 0;
    const uploads = new InMemoryResumableUploadService(pipeline, () => new Date("2026-08-12T12:00:00.000Z"), () => `upload-${++sequence}`);
    const bytes = svg();
    const incomplete = uploads.createIntent({ ownerId: "user-1", projectId: "project-1", expectedMediaType: "image", declaredContentType: "image/svg+xml", expectedBytes: bytes.byteLength });
    expect(() => uploads.status(incomplete.uploadId, "user-2")).toThrowError(expect.objectContaining<Partial<MediaPipelineError>>({ code: "ACCESS_DENIED" }));
    await expect(uploads.finalize(incomplete.uploadId, "user-1")).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });
    const wrongChecksum = uploads.createIntent({ ownerId: "user-1", projectId: "project-1", expectedMediaType: "image", declaredContentType: "image/svg+xml", expectedBytes: bytes.byteLength, expectedChecksumSha256: "b".repeat(64) });
    uploads.append(wrongChecksum.uploadId, "user-1", 0, bytes);
    await expect(uploads.finalize(wrongChecksum.uploadId, "user-1")).rejects.toMatchObject({ code: "UPLOAD_CHECKSUM_MISMATCH" });
  });
});

describe("provider result ingestion", () => {
  it("validates URL before fetching and stores a restricted generated original", async () => {
    const { pipeline } = harness();
    const fetchAsset = vi.fn(async (maxBytes: number) => {
      expect(maxBytes).toBe(defaultLocalMediaPolicy.maxBytes.image);
      return { bytes: svg(), contentType: "image/svg+xml", sourceUrl: "https://media.provider.example/result/1" };
    });
    const object = await pipeline.ingestProviderResult({
      sourceUrl: "https://media.provider.example/result/1",
      sourcePolicy: { allowedOrigins: ["https://media.provider.example"], allowHttpLoopbackForLocalTest: false, allowPrivateLoopbackForLocalTest: false },
      expectedMediaType: "image",
      ownerId: "user-1",
      projectId: "project-1",
      operationId: "operation-1",
      fetchAsset,
    });
    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(object).toMatchObject({ bucket: "generated-originals-private", classification: "RESTRICTED", status: "READY" });
  });
});
