import { createHash } from "node:crypto";
import {
  buildPublicReferenceCatalogSnapshot,
  KieReferenceCatalogImporter,
  type PublicReferenceCatalogSnapshot,
  type ReferenceCatalogModality,
  type ReferenceModelDraft,
} from "./reference-catalog-importers.js";

export const kieOfficialCatalogIndexUrl = "https://docs.kie.ai/llms.txt";

export type KieDocumentationIndexEntry = Readonly<{ title: string; documentationUrl: string }>;
export type KieDocumentationPageCapture = Readonly<{
  title: string;
  documentationUrl: string;
  rawMarkdown: string;
  familyId?: string;
}>;

export class KieDocumentationCatalogError extends Error {
  constructor(readonly code: "INVALID_INDEX" | "MODEL_ID_NOT_EVIDENCED" | "MODALITY_NOT_EVIDENCED", message: string) {
    super(message);
    this.name = "KieDocumentationCatalogError";
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "unknown";

/** Parses KIE's official llms.txt index; it discovers documentation, not runnable models. */
export function parseKieDocumentationIndex(raw: string): KieDocumentationIndexEntry[] {
  if (!raw.includes("docs.kie.ai")) throw new KieDocumentationCatalogError("INVALID_INDEX", "KIE documentation index has no docs.kie.ai evidence.");
  const entries = [...raw.matchAll(/\[([^\]]+)\]\((https:\/\/docs\.kie\.ai\/[^)\s]+)\)/g)]
    .map((match) => ({ title: match[1].trim(), documentationUrl: match[2].replace(/\.md$/, "") }))
    .filter((entry) => entry.title.length > 0);
  return [...new Map(entries.map((entry) => [entry.documentationUrl, entry])).values()]
    .sort((left, right) => left.documentationUrl.localeCompare(right.documentationUrl));
}

function balancedObject(text: string, offset: number): string | null {
  const start = text.indexOf("{", offset);
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (!escaped && char === '"') quoted = false;
      escaped = !escaped && char === "\\";
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function documentedModalities(title: string): ReferenceCatalogModality[] | null {
  const value = title.toLowerCase().replace(/[–—]/g, "-");
  // The official index calls this page simply "Kling 3.0".  Its own request
  // contract proves both `prompt` and optional `image_urls`, and the page
  // describes video output, so it is safely discoverable as a text/image to
  // video family instead of being skipped by title-only routing.
  if (/^kling\s+3\.0$/.test(value)) return ["text", "image", "video"];
  if (/text\s*(to|-)\s*image/.test(value)) return ["image", "text"];
  if (/image\s*(to|-)\s*image|image edit|image remix|image upscale/.test(value)) return ["image"];
  if (/text\s*(to|-)\s*video/.test(value)) return ["text", "video"];
  if (/image\s*(to|-)\s*video|reference\s*(to|-)\s*video/.test(value)) return ["image", "video"];
  if (/video\s*(to|-)\s*video|video edit|video extend/.test(value)) return ["video"];
  if (/text\s*(to|-)\s*(speech|audio|music)|music generation|voice generation/.test(value)) return ["audio", "text"];
  if (/audio isolation|vocal.*separation|convert.*wav|generate midi/.test(value)) return ["audio"];
  if (/lyrics generation/.test(value)) return ["text"];
  return null;
}

/**
 * Cheap discovery predicate used before downloading hundreds of KIE pages.
 * The authoritative parser still validates the captured request example; this
 * helper only decides which official index entries are worth fetching.
 */
export function isKieGenerativeModelDocumentation(title: string): boolean {
  return documentedModalities(title) !== null;
}

/**
 * Converts a captured official page into an evidence-backed descriptor. A
 * page cannot enter the catalog unless its exact request example contains a
 * model ID and its title gives an unambiguous modality contract.
 */
export function parseKieDocumentationPage(capture: KieDocumentationPageCapture) {
  if (!capture.documentationUrl.startsWith("https://docs.kie.ai/")) {
    throw new KieDocumentationCatalogError("INVALID_INDEX", "KIE capture must point to an official documentation URL.");
  }
  const normalized = capture.rawMarkdown.replace(/\\"/g, '"');
  const model = normalized.match(/"model"\s*:\s*"([^"\n]+)"/)?.[1];
  if (!model) throw new KieDocumentationCatalogError("MODEL_ID_NOT_EVIDENCED", `KIE documentation page ${capture.documentationUrl} has no model ID in a request example.`);
  const modalities = documentedModalities(capture.title);
  if (!modalities) throw new KieDocumentationCatalogError("MODALITY_NOT_EVIDENCED", `KIE documentation title ${capture.title} has no unambiguous modality contract.`);
  const inputOffset = normalized.indexOf('"input"');
  const input = inputOffset < 0 ? null : balancedObject(normalized, inputOffset);
  const supportedParameters = input ? [...new Set([...input.matchAll(/"([^"\n]+)"\s*:/g)].map((match) => match[1]))].sort() : [];
  return {
    providerModelId: model,
    displayName: capture.title,
    familyId: capture.familyId ?? `family.kie.${slug(model.split("/")[0] ?? model)}`,
    modalities,
    supportedParameters,
    documentationUrl: capture.documentationUrl,
    requestExampleSha256: digest(normalized),
  };
}

/** KIE references are built from captured official page text, never hard-coded model identifiers. */
export class KieDocumentationCatalogImporter {
  discover(indexMarkdown: string): KieDocumentationIndexEntry[] {
    return parseKieDocumentationIndex(indexMarkdown);
  }

  import(captures: readonly KieDocumentationPageCapture[]): ReferenceModelDraft[] {
    return new KieReferenceCatalogImporter().import(captures.map(parseKieDocumentationPage));
  }

  snapshot(input: { id: string; observedAt: string; indexMarkdown: string; captures: readonly KieDocumentationPageCapture[] }): PublicReferenceCatalogSnapshot {
    const sources = this.discover(input.indexMarkdown);
    const models = this.import(input.captures);
    const capturedUrls = new Set(input.captures.map((capture) => capture.documentationUrl));
    if (input.captures.some((capture) => !sources.some((entry) => entry.documentationUrl === capture.documentationUrl))) {
      throw new KieDocumentationCatalogError("INVALID_INDEX", "A captured KIE page is not present in the immutable official documentation index.");
    }
    return buildPublicReferenceCatalogSnapshot({
      id: input.id, providerId: "kie", observedAt: input.observedAt,
      sourceUrls: [kieOfficialCatalogIndexUrl, ...sources.filter((entry) => capturedUrls.has(entry.documentationUrl)).map((entry) => entry.documentationUrl)],
      rawPayload: { indexMarkdown: input.indexMarkdown, captures: input.captures }, parserVersion: "kie-documentation-catalog.v1", models,
    });
  }
}
