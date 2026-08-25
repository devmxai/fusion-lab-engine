import { MediaPipelineError, type MediaIngestPolicy, type MediaMetadata, type MediaType } from "./types.js";

export type MediaValidation = {
  mediaType: MediaType;
  contentType: string;
  metadata: MediaMetadata;
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start = 0, end = bytes.byteLength): string {
  return new TextDecoder().decode(bytes.slice(start, end));
}

function svgMetadata(text: string): MediaMetadata {
  const width = /\bwidth=["'](\d+)/i.exec(text)?.[1];
  const height = /\bheight=["'](\d+)/i.exec(text)?.[1];
  return {
    width: width ? Number(width) : null,
    height: height ? Number(height) : null,
    durationMs: null,
    hasAudio: false,
  };
}

function rejectActiveSvg(text: string): void {
  if (
    /<script\b|<foreignObject\b|<!DOCTYPE\b|<!ENTITY\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|data:|javascript:)/i.test(text)
  ) {
    throw new MediaPipelineError("MEDIA_ACTIVE_CONTENT_REJECTED", "Active or external SVG content is prohibited.");
  }
}

export function validateMediaBytes(input: {
  bytes: Uint8Array;
  declaredContentType: string;
  expectedMediaType: MediaType;
  policy: MediaIngestPolicy;
}): MediaValidation {
  const { bytes, expectedMediaType, policy } = input;
  if (bytes.byteLength === 0) throw new MediaPipelineError("MEDIA_EMPTY", "Media file is empty.");
  if (bytes.byteLength > policy.maxBytes[expectedMediaType]) {
    throw new MediaPipelineError("MEDIA_TOO_LARGE", "Media file exceeds the certified size limit.");
  }

  let detected: MediaValidation | null = null;
  const prefix = ascii(bytes, 0, Math.min(bytes.byteLength, 1024)).trimStart();
  if (prefix.startsWith("<svg")) {
    const fullText = ascii(bytes);
    rejectActiveSvg(fullText);
    detected = { mediaType: "image", contentType: "image/svg+xml", metadata: svgMetadata(fullText) };
  } else if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    detected = { mediaType: "image", contentType: "image/png", metadata: { width: null, height: null, durationMs: null, hasAudio: false } };
  } else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    detected = { mediaType: "image", contentType: "image/jpeg", metadata: { width: null, height: null, durationMs: null, hasAudio: false } };
  } else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") {
    const durationMs = bytes.byteLength >= 44
      ? Math.round((new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(40, true) / 8_000) * 1_000)
      : null;
    detected = { mediaType: "audio", contentType: "audio/wav", metadata: { width: null, height: null, durationMs, hasAudio: true } };
  } else if (bytes.byteLength >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    detected = { mediaType: "video", contentType: "video/mp4", metadata: { width: null, height: null, durationMs: null, hasAudio: null } };
  }
  if (!detected) throw new MediaPipelineError("MEDIA_MAGIC_UNKNOWN", "Media magic bytes are not recognized.");

  const declared = input.declaredContentType.split(";")[0]!.trim().toLowerCase();
  if (
    detected.mediaType !== expectedMediaType
    || detected.contentType !== declared
    || !policy.allowedContentTypes[expectedMediaType].includes(detected.contentType)
  ) {
    throw new MediaPipelineError("MEDIA_TYPE_MISMATCH", "Declared MIME, detected magic and expected media type do not agree.");
  }
  return detected;
}

export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<"CLEAN" | "INFECTED" | "ERROR">;
}

export class LocalSignatureScanner implements MalwareScanner {
  async scan(bytes: Uint8Array): Promise<"CLEAN" | "INFECTED"> {
    const text = ascii(bytes);
    return text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE") ? "INFECTED" : "CLEAN";
  }
}
