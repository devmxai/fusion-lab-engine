const encoder = new TextEncoder();
const maxAgeMilliseconds = 5 * 60 * 1_000;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array | null {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
}

function canonicalRequest(method: string, path: string, timestamp: string, body: string): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${body}`;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signInternalWorkloadRequest(input: { method: string; path: string; timestamp: string; body: string; secret: string }): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await signingKey(input.secret), encoder.encode(canonicalRequest(input.method, input.path, input.timestamp, input.body)));
  return hex(new Uint8Array(signature));
}

export async function verifyInternalWorkloadRequest(input: {
  method: string;
  path: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  secret: string | undefined;
  now?: Date;
}): Promise<boolean> {
  if (!input.secret || !input.timestamp || !input.signature) return false;
  const signedAt = Date.parse(input.timestamp);
  const now = input.now ?? new Date();
  if (Number.isNaN(signedAt) || Number.isNaN(now.getTime()) || Math.abs(now.getTime() - signedAt) > maxAgeMilliseconds) return false;
  const signature = fromHex(input.signature);
  if (!signature) return false;
  // Create a DOM-compatible ArrayBuffer view rather than passing an ambient
  // Uint8Array<ArrayBufferLike>, which may carry a SharedArrayBuffer type in
  // the browser project even though this verifier only handles copied bytes.
  const signatureCopy = new Uint8Array(signature.byteLength);
  signatureCopy.set(signature);
  return crypto.subtle.verify("HMAC", await signingKey(input.secret), signatureCopy.buffer, encoder.encode(canonicalRequest(input.method, input.path, input.timestamp, input.body)));
}
