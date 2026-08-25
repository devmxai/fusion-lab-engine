import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MediaPipelineError,
  type MediaMetadata,
  type MediaType,
  type PrivateMediaObject,
  type PrivateMediaRead,
  type QuarantineRecord,
} from "./types.ts";

type StoredReady = { record: PrivateMediaObject; bytes: Uint8Array };
type StoredQuarantine = { record: QuarantineRecord; bytes: Uint8Array };
type AccessGrant = { objectId: string; ownerId: string; expiresAtMs: number };

export interface PrivateObjectStore {
  putReady(input: {
    objectKey: string;
    bucket: PrivateMediaObject["bucket"];
    ownerId: string;
    projectId: string;
    operationId: string | null;
    mediaType: MediaType;
    contentType: string;
    bytes: Uint8Array;
    checksumSha256: string;
    metadata: MediaMetadata;
  }): PrivateMediaObject;
  putQuarantine(input: {
    objectKey: string;
    ownerId: string;
    projectId: string;
    operationId: string | null;
    reasonCode: string;
    bytes: Uint8Array;
    checksumSha256: string;
  }): QuarantineRecord;
  createAccessGrant(objectId: string, ownerId: string, ttlSeconds: number): string;
  readWithGrant(objectId: string, token: string): PrivateMediaRead;
}

export class InMemoryPrivateObjectStore implements PrivateObjectStore {
  private readonly readyById = new Map<string, StoredReady>();
  private readonly readyIdByKey = new Map<string, string>();
  private readonly quarantineById = new Map<string, StoredQuarantine>();
  private readonly grants = new Map<string, AccessGrant>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
    private readonly token: () => string = () => randomBytes(32).toString("base64url"),
  ) {}

  putReady(input: Parameters<PrivateObjectStore["putReady"]>[0]): PrivateMediaObject {
    const existingId = this.readyIdByKey.get(input.objectKey);
    if (existingId) {
      const existing = this.readyById.get(existingId)!;
      if (existing.record.checksumSha256 !== input.checksumSha256) {
        throw new MediaPipelineError("PRIVATE_OBJECT_CONFLICT", "Private object key is already bound to different content.");
      }
      return structuredClone(existing.record);
    }
    const record: PrivateMediaObject = {
      id: this.id(),
      objectKey: input.objectKey,
      bucket: input.bucket,
      ownerId: input.ownerId,
      projectId: input.projectId,
      operationId: input.operationId,
      mediaType: input.mediaType,
      contentType: input.contentType,
      byteLength: input.bytes.byteLength,
      checksumSha256: input.checksumSha256,
      metadata: structuredClone(input.metadata),
      classification: "RESTRICTED",
      status: "READY",
      createdAt: this.now().toISOString(),
    };
    this.readyById.set(record.id, { record, bytes: input.bytes.slice() });
    this.readyIdByKey.set(record.objectKey, record.id);
    return structuredClone(record);
  }

  putQuarantine(input: Parameters<PrivateObjectStore["putQuarantine"]>[0]): QuarantineRecord {
    const record: QuarantineRecord = {
      id: this.id(),
      objectKey: input.objectKey,
      bucket: "quarantine-private",
      ownerId: input.ownerId,
      projectId: input.projectId,
      operationId: input.operationId,
      reasonCode: input.reasonCode,
      byteLength: input.bytes.byteLength,
      checksumSha256: input.checksumSha256,
      createdAt: this.now().toISOString(),
    };
    this.quarantineById.set(record.id, { record, bytes: input.bytes.slice() });
    return structuredClone(record);
  }

  createAccessGrant(objectId: string, ownerId: string, ttlSeconds: number): string {
    const object = this.readyById.get(objectId)?.record;
    if (!object) throw new MediaPipelineError("PRIVATE_OBJECT_NOT_FOUND", "Private media object does not exist.");
    if (object.ownerId !== ownerId || !Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
      throw new MediaPipelineError("ACCESS_DENIED", "Private media access grant is not authorized.");
    }
    const rawToken = this.token();
    this.grants.set(createHash("sha256").update(rawToken).digest("hex"), {
      objectId,
      ownerId,
      expiresAtMs: this.now().getTime() + ttlSeconds * 1_000,
    });
    return rawToken;
  }

  readWithGrant(objectId: string, token: string): PrivateMediaRead {
    const grant = this.grants.get(createHash("sha256").update(token).digest("hex"));
    if (!grant || grant.objectId !== objectId) {
      throw new MediaPipelineError("ACCESS_DENIED", "Private media access token is invalid.");
    }
    if (grant.expiresAtMs <= this.now().getTime()) {
      throw new MediaPipelineError("ACCESS_GRANT_EXPIRED", "Private media access token expired.");
    }
    const stored = this.readyById.get(objectId);
    if (!stored || stored.record.ownerId !== grant.ownerId) {
      throw new MediaPipelineError("ACCESS_DENIED", "Private media ownership verification failed.");
    }
    return { object: structuredClone(stored.record), bytes: stored.bytes.slice() };
  }

  quarantineSnapshot(): ReadonlyArray<Readonly<QuarantineRecord>> {
    return structuredClone([...this.quarantineById.values()].map(({ record }) => record));
  }
}

/** Local durable store. Object bytes and metadata survive an Engine restart;
 * access grants intentionally do not, because they are short-lived capabilities. */
export class FilePrivateObjectStore implements PrivateObjectStore {
  private readonly records = new Map<string, PrivateMediaObject>();
  private readonly idByKey = new Map<string, string>();
  private readonly grants = new Map<string, AccessGrant>();

  constructor(
    private readonly root: string,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
    private readonly token: () => string = () => randomBytes(32).toString("base64url"),
  ) {
    mkdirSync(this.readyDirectory(), { recursive: true });
    for (const file of readdirSync(this.readyDirectory())) {
      if (!file.endsWith(".json")) continue;
      try {
        const record = JSON.parse(readFileSync(join(this.readyDirectory(), file), "utf8")) as PrivateMediaObject;
        if (record.id && record.objectKey) { this.records.set(record.id, record); this.idByKey.set(record.objectKey, record.id); }
      } catch { /* fail closed at access time; a malformed file is never served */ }
    }
  }

  putReady(input: Parameters<PrivateObjectStore["putReady"]>[0]): PrivateMediaObject {
    const existingId = this.idByKey.get(input.objectKey);
    if (existingId) {
      const existing = this.records.get(existingId)!;
      if (existing.checksumSha256 !== input.checksumSha256) throw new MediaPipelineError("PRIVATE_OBJECT_CONFLICT", "Private object key is already bound to different content.");
      return structuredClone(existing);
    }
    const record: PrivateMediaObject = { id: this.id(), objectKey: input.objectKey, bucket: input.bucket, ownerId: input.ownerId, projectId: input.projectId, operationId: input.operationId, mediaType: input.mediaType, contentType: input.contentType, byteLength: input.bytes.byteLength, checksumSha256: input.checksumSha256, metadata: structuredClone(input.metadata), classification: "RESTRICTED", status: "READY", createdAt: this.now().toISOString() };
    writeFileSync(this.binaryPath(record.id), input.bytes, { flag: "wx" });
    writeFileSync(this.metadataPath(record.id), JSON.stringify(record), { encoding: "utf8", flag: "wx" });
    this.records.set(record.id, record); this.idByKey.set(record.objectKey, record.id);
    return structuredClone(record);
  }

  putQuarantine(input: Parameters<PrivateObjectStore["putQuarantine"]>[0]): QuarantineRecord {
    const record: QuarantineRecord = { id: this.id(), objectKey: input.objectKey, bucket: "quarantine-private", ownerId: input.ownerId, projectId: input.projectId, operationId: input.operationId, reasonCode: input.reasonCode, byteLength: input.bytes.byteLength, checksumSha256: input.checksumSha256, createdAt: this.now().toISOString() };
    const directory = join(this.root, "quarantine"); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${record.id}.bin`), input.bytes, { flag: "wx" });
    writeFileSync(join(directory, `${record.id}.json`), JSON.stringify(record), { encoding: "utf8", flag: "wx" });
    return structuredClone(record);
  }

  createAccessGrant(objectId: string, ownerId: string, ttlSeconds: number): string {
    const object = this.records.get(objectId);
    if (!object) throw new MediaPipelineError("PRIVATE_OBJECT_NOT_FOUND", "Private media object does not exist.");
    if (object.ownerId !== ownerId || !Number.isInteger(ttlSeconds) || ttlSeconds < 1) throw new MediaPipelineError("ACCESS_DENIED", "Private media access grant is not authorized.");
    const token = this.token(); this.grants.set(this.hash(token), { objectId, ownerId, expiresAtMs: this.now().getTime() + ttlSeconds * 1_000 });
    return token;
  }

  readWithGrant(objectId: string, token: string): PrivateMediaRead {
    const grant = this.grants.get(this.hash(token));
    if (!grant || grant.objectId !== objectId) throw new MediaPipelineError("ACCESS_DENIED", "Private media access token is invalid.");
    if (grant.expiresAtMs <= this.now().getTime()) throw new MediaPipelineError("ACCESS_GRANT_EXPIRED", "Private media access token expired.");
    const object = this.records.get(objectId);
    if (!object || object.ownerId !== grant.ownerId || !existsSync(this.binaryPath(objectId))) throw new MediaPipelineError("ACCESS_DENIED", "Private media ownership verification failed.");
    return { object: structuredClone(object), bytes: new Uint8Array(readFileSync(this.binaryPath(objectId))) };
  }

  private readyDirectory() { return join(this.root, "ready"); }
  private binaryPath(id: string) { return join(this.readyDirectory(), `${id}.bin`); }
  private metadataPath(id: string) { return join(this.readyDirectory(), `${id}.json`); }
  private hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
}
