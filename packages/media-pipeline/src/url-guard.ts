import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MediaPipelineError, type ProviderAssetSourcePolicy } from "./types.ts";

export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map(({ address }) => address);
};

function ipv4Parts(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  return address.split(".").map(Number);
}

function isLoopback(address: string): boolean {
  const v4 = ipv4Parts(address);
  if (v4) return v4[0] === 127;
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized.startsWith("::ffff:127.");
}

function isPrivateOrSpecial(address: string): boolean {
  const v4 = ipv4Parts(address);
  if (v4) {
    const [a, b] = v4;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  if (isIP(address) !== 6) return true;
  const normalized = address.toLowerCase();
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
    || normalized.startsWith("ff")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:169.254.")
    || normalized.startsWith("::ffff:192.168.");
}

export class ProviderSourceUrlGuard {
  constructor(private readonly resolveHost: HostResolver = defaultResolver) {}

  async assertAllowed(rawUrl: string, policy: ProviderAssetSourcePolicy): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new MediaPipelineError("INVALID_SOURCE_URL", "Provider asset URL is invalid.");
    }
    if (url.username || url.password || url.hash || !["http:", "https:"].includes(url.protocol)) {
      throw new MediaPipelineError("INVALID_SOURCE_URL", "Provider asset URL contains prohibited components.");
    }
    const allowedOrigins = policy.allowedOrigins.map((origin) => new URL(origin).origin);
    if (!allowedOrigins.includes(url.origin)) {
      throw new MediaPipelineError("SOURCE_ORIGIN_NOT_ALLOWED", "Provider asset origin is not allowlisted.");
    }

    const literalAddress = isIP(url.hostname) ? url.hostname : null;
    if (url.protocol !== "https:") {
      if (!policy.allowHttpLoopbackForLocalTest || !literalAddress || !isLoopback(literalAddress)) {
        throw new MediaPipelineError("INVALID_SOURCE_URL", "Plain HTTP is restricted to explicit loopback test providers.");
      }
    }

    let addresses: string[];
    try {
      addresses = literalAddress ? [literalAddress] : await this.resolveHost(url.hostname);
    } catch {
      throw new MediaPipelineError("SOURCE_DNS_REJECTED", "Provider hostname resolution failed closed.");
    }
    if (addresses.length === 0 || addresses.some((address) => isIP(address) === 0)) {
      throw new MediaPipelineError("SOURCE_DNS_REJECTED", "Provider hostname did not resolve to valid IP addresses.");
    }
    for (const address of addresses) {
      if (!isPrivateOrSpecial(address)) continue;
      if (policy.allowPrivateLoopbackForLocalTest && isLoopback(address)) continue;
      throw new MediaPipelineError("SOURCE_PRIVATE_IP_REJECTED", "Provider hostname resolved to a private or special IP address.");
    }
    return url;
  }
}
