const blockedProviderHosts = [
  "api.kie.ai",
  "kieai.redpandaai.co",
  "openrouter.ai",
  "generativelanguage.googleapis.com",
] as const;

export class ProviderNetworkDeniedError extends Error {
  readonly code = "PROVIDER_NETWORK_DENIED";

  constructor(readonly hostname: string) {
    super(`External provider network access is blocked during local development and tests: ${hostname}`);
    this.name = "ProviderNetworkDeniedError";
  }
}

function inputUrl(input: RequestInfo | URL, baseUrl: string): URL | null {
  const raw = input instanceof Request ? input.url : String(input);
  try {
    return new URL(raw, baseUrl);
  } catch {
    return null;
  }
}

export function isBlockedProviderUrl(input: RequestInfo | URL, baseUrl = "http://127.0.0.1"): boolean {
  const url = inputUrl(input, baseUrl);
  if (!url) return false;
  const hostname = url.hostname.toLowerCase();
  return blockedProviderHosts.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
}

export function createProviderNetworkDenyFetch(
  upstreamFetch: typeof fetch,
  baseUrl = "http://127.0.0.1",
): typeof fetch {
  return async (input, init) => {
    const url = inputUrl(input, baseUrl);
    if (url && isBlockedProviderUrl(input, baseUrl)) {
      throw new ProviderNetworkDeniedError(url.hostname);
    }
    return upstreamFetch(input, init);
  };
}

/** Installs a test-only guard and returns a restore function for isolated tests. */
export function installProviderNetworkDeny(): () => void {
  const upstreamFetch = globalThis.fetch.bind(globalThis);
  const baseUrl = globalThis.location?.origin || "http://127.0.0.1";
  globalThis.fetch = createProviderNetworkDenyFetch(upstreamFetch, baseUrl);
  return () => {
    globalThis.fetch = upstreamFetch;
  };
}
