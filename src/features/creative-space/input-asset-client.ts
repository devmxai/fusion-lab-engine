import { ImageEngineRequestError } from "./image-quote-client";
import { engineAuthorizationHeaders, ensureEngineSession } from "./engine-session";

export type UploadedInputAsset = Readonly<{
  assetId: string;
  projectId: string;
  name: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  byteLength: number;
  checksumSha256: string;
  state: "READY";
}>;

const supported = new Set(["image/jpeg", "image/png", "image/webp"]);

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function engine<T>(path: string, init: RequestInit): Promise<T> {
  await ensureEngineSession();
  const response = await fetch(`/api/engine${path}`, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(await engineAuthorizationHeaders()), ...init.headers },
  });
  const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new ImageEngineRequestError(response.status, payload?.error?.code ?? "INPUT_ASSET_REQUEST_FAILED", payload?.error?.message ?? "Image upload could not be completed.");
  return payload as T;
}

/**
 * Uploads directly to an Engine-issued, private one-time target. The file is
 * then read back and verified by the Engine before it becomes a usable source
 * asset; browser metadata alone is never accepted as proof.
 */
export async function uploadInputImage(projectId: string, file: File): Promise<UploadedInputAsset> {
  if (!supported.has(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) {
    throw new ImageEngineRequestError(400, "INPUT_ASSET_INVALID", "Choose a PNG, JPEG, or WebP image no larger than 10 MB.");
  }
  const checksumSha256 = await sha256(file);
  const intent = await engine<{ assetId: string; uploadUrl: string; expiresAt: string; contentType: string }>("/v2/input-assets/uploads", {
    method: "POST",
    body: JSON.stringify({ projectId, filename: file.name || "reference-image", contentType: file.type, byteLength: file.size, checksumSha256 }),
  });
  const upload = await fetch(intent.uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type, "x-upsert": "false" },
    body: file,
  });
  if (!upload.ok) throw new ImageEngineRequestError(upload.status, "INPUT_UPLOAD_FAILED", "The image could not be uploaded to the private store.");
  return engine<UploadedInputAsset>(`/v2/input-assets/${encodeURIComponent(intent.assetId)}/finalize`, {
    method: "POST",
    body: JSON.stringify({ checksumSha256 }),
  });
}

export async function readInputImage(assetId: string): Promise<string> {
  await ensureEngineSession();
  const response = await fetch(`/api/engine/v2/input-assets/${encodeURIComponent(assetId)}/content`, {
    headers: await engineAuthorizationHeaders(),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
    throw new ImageEngineRequestError(response.status, payload?.error?.code ?? "INPUT_ASSET_UNAVAILABLE", payload?.error?.message ?? "The uploaded image is unavailable.");
  }
  return URL.createObjectURL(await response.blob());
}
