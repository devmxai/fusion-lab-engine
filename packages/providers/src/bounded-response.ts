import { ProviderDefinitiveError } from "./types.js";

/** Read an asset response without allowing an unbounded buffer allocation. */
export async function readBoundedProviderAsset(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError("invalid_provider_asset_max_bytes");
  if (response.redirected) {
    throw new ProviderDefinitiveError("RESULT_REDIRECT_REJECTED", "Provider asset download must not follow redirects.");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new ProviderDefinitiveError("RESULT_TOO_LARGE", "Provider asset exceeds the certified byte limit.");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new ProviderDefinitiveError("RESULT_TOO_LARGE", "Provider asset exceeds the certified byte limit.");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel("provider_asset_exceeds_limit");
        throw new ProviderDefinitiveError("RESULT_TOO_LARGE", "Provider asset exceeds the certified byte limit.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
