/**
 * Sanitizer for CMS-provided URLs (banners, announcements, etc.).
 * Allows: relative paths starting with "/" and absolute http(s) URLs only.
 * Blocks: javascript:, data:, vbscript:, file:, mailto:, tel:, etc.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export type SafeLink =
  | { kind: "internal"; path: string }
  | { kind: "external"; url: string }
  | { kind: "invalid" };

export function classifyLink(rawLink: string | null | undefined): SafeLink {
  if (!rawLink || typeof rawLink !== "string") return { kind: "invalid" };
  const link = rawLink.trim();
  if (!link) return { kind: "invalid" };

  // Internal route — must start with a single "/" and not "//"
  if (link.startsWith("/") && !link.startsWith("//")) {
    // Disallow control chars / scheme injection like /\evil
    if (/[\u0000-\u001F\u007F]/.test(link)) return { kind: "invalid" };
    return { kind: "internal", path: link };
  }

  // External — must parse as absolute http(s)
  try {
    const url = new URL(link);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { kind: "invalid" };
    return { kind: "external", url: url.toString() };
  } catch {
    return { kind: "invalid" };
  }
}

/**
 * Open an external link safely with noopener,noreferrer.
 */
export function openExternalSafely(url: string): void {
  const safe = classifyLink(url);
  if (safe.kind === "external") {
    window.open(safe.url, "_blank", "noopener,noreferrer");
  }
}
