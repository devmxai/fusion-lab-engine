import { createHash, randomUUID } from "node:crypto";
import { type PrivateMediaPipeline } from "./pipeline.ts";
import { MediaPipelineError, type MediaType, type PrivateMediaObject } from "./types.ts";

type UploadSession = {
  id: string;
  ownerId: string;
  projectId: string;
  expectedMediaType: MediaType;
  declaredContentType: string;
  expectedBytes: number;
  expectedChecksumSha256: string | null;
  bytes: Uint8Array;
  expiresAtMs: number;
  state: "OPEN" | "FINALIZED";
  result: PrivateMediaObject | null;
};

export class InMemoryResumableUploadService {
  private readonly sessions = new Map<string, UploadSession>();

  constructor(
    private readonly pipeline: PrivateMediaPipeline,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  createIntent(input: {
    ownerId: string;
    projectId: string;
    expectedMediaType: MediaType;
    declaredContentType: string;
    expectedBytes: number;
    expectedChecksumSha256?: string | null;
    ttlSeconds?: number;
  }) {
    if (!Number.isInteger(input.expectedBytes) || input.expectedBytes < 1) {
      throw new MediaPipelineError("UPLOAD_SIZE_MISMATCH", "Upload intent requires a positive exact byte length.");
    }
    const id = this.id();
    const session: UploadSession = {
      id,
      ownerId: input.ownerId,
      projectId: input.projectId,
      expectedMediaType: input.expectedMediaType,
      declaredContentType: input.declaredContentType,
      expectedBytes: input.expectedBytes,
      expectedChecksumSha256: input.expectedChecksumSha256 ?? null,
      bytes: new Uint8Array(),
      expiresAtMs: this.now().getTime() + (input.ttlSeconds ?? 900) * 1_000,
      state: "OPEN",
      result: null,
    };
    this.sessions.set(id, session);
    return { uploadId: id, offset: 0, expectedBytes: session.expectedBytes, expiresAt: new Date(session.expiresAtMs).toISOString() };
  }

  append(uploadId: string, ownerId: string, offset: number, chunk: Uint8Array) {
    const session = this.requireOpen(uploadId, ownerId);
    if (offset !== session.bytes.byteLength) {
      throw new MediaPipelineError("UPLOAD_OFFSET_MISMATCH", "Upload chunk offset does not match the committed offset.");
    }
    if (session.bytes.byteLength + chunk.byteLength > session.expectedBytes) {
      throw new MediaPipelineError("UPLOAD_SIZE_MISMATCH", "Upload chunk exceeds the declared byte length.");
    }
    const combined = new Uint8Array(session.bytes.byteLength + chunk.byteLength);
    combined.set(session.bytes);
    combined.set(chunk, session.bytes.byteLength);
    session.bytes = combined;
    return { uploadId, offset: session.bytes.byteLength, complete: session.bytes.byteLength === session.expectedBytes };
  }

  status(uploadId: string, ownerId: string) {
    const session = this.requireSession(uploadId, ownerId);
    return { uploadId, offset: session.bytes.byteLength, expectedBytes: session.expectedBytes, state: session.state };
  }

  async finalize(uploadId: string, ownerId: string): Promise<PrivateMediaObject> {
    const session = this.requireSession(uploadId, ownerId);
    if (session.state === "FINALIZED" && session.result) return structuredClone(session.result);
    this.requireOpen(uploadId, ownerId);
    if (session.bytes.byteLength !== session.expectedBytes) {
      throw new MediaPipelineError("UPLOAD_SIZE_MISMATCH", "Upload cannot finalize before all declared bytes arrive.");
    }
    const checksum = createHash("sha256").update(session.bytes).digest("hex");
    if (session.expectedChecksumSha256 && session.expectedChecksumSha256 !== checksum) {
      throw new MediaPipelineError("UPLOAD_CHECKSUM_MISMATCH", "Upload checksum does not match the intent.");
    }
    const result = await this.pipeline.ingestUpload({
      bytes: session.bytes,
      declaredContentType: session.declaredContentType,
      expectedMediaType: session.expectedMediaType,
      ownerId: session.ownerId,
      projectId: session.projectId,
      uploadId: session.id,
    });
    session.state = "FINALIZED";
    session.result = result;
    return structuredClone(result);
  }

  private requireOpen(uploadId: string, ownerId: string): UploadSession {
    const session = this.requireSession(uploadId, ownerId);
    if (session.state !== "OPEN") throw new MediaPipelineError("ACCESS_DENIED", "Finalized upload session is immutable.");
    if (session.expiresAtMs <= this.now().getTime()) throw new MediaPipelineError("UPLOAD_EXPIRED", "Upload session expired.");
    return session;
  }

  private requireSession(uploadId: string, ownerId: string): UploadSession {
    const session = this.sessions.get(uploadId);
    if (!session) throw new MediaPipelineError("UPLOAD_NOT_FOUND", "Upload session does not exist.");
    if (session.ownerId !== ownerId) throw new MediaPipelineError("ACCESS_DENIED", "Upload session belongs to another owner.");
    return session;
  }
}
