import { Image as ImageIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { PublishedOffer } from "./published-offers-client";

export type CustomerModelPresentation = Readonly<{
  /** A customer-facing short name. It deliberately contains no provider route. */
  name: string;
  /** Local key used by the UI to resolve an audited brand mark. */
  brand: "openai" | "kling" | "seedance" | "grok" | "generic";
}>;

/**
 * A compact customer-facing hierarchy.  It is presentation only: selecting a
 * family/version always resolves back to one exact released offer, whose
 * contract and price remain the server authority.
 */
export type CustomerModelFamilyPresentation = Readonly<{
  familyName: string;
  version: string | null;
  edition: string | null;
  brand: CustomerModelPresentation["brand"];
}>;

function normalizedIdentity(offer: PublishedOffer): string {
  return `${offer.identity.familyId} ${offer.identity.officialModelId} ${offer.displayName}`.toLowerCase();
}

/**
 * KIE exposes Kling 3.0 and Kling 3.0 Turbo as different executable model
 * routes.  They must remain distinct customer versions: Turbo has a smaller
 * certified control set, while Kling 3.0 exposes the complete 3–15s matrix.
 */
function klingVersion(offer: PublishedOffer): Pick<CustomerModelFamilyPresentation, "version" | "edition"> | null {
  const modelId = offer.identity.officialModelId.toLowerCase();
  if (modelId === "kling-3.0/video") return { version: "3.0", edition: "Standard" };
  if (modelId.includes("kling/v3-turbo") || modelId.includes("kling-3-0-turbo")) return { version: "3.0", edition: "Turbo" };
  return null;
}

/**
 * Converts a release contract into the small, product-safe identity shown in
 * Standard. Provider identifiers and provider route names stay in the engine
 * and Admin only. This registry is intentionally local: the UI never hotlinks
 * a logo or asks an external provider for presentation metadata.
 */
export function customerModelPresentation(offer: PublishedOffer): CustomerModelPresentation {
  const identity = normalizedIdentity(offer);
  if (identity.includes("gpt-image-2")) return { name: "GPT Image 2", brand: "openai" };
  if (identity.includes("gpt-image-1.5")) return { name: "GPT Image 1.5", brand: "openai" };
  if (identity.includes("gpt-image-1")) return { name: "GPT Image 1", brand: "openai" };
  if (identity.includes("gpt-image")) return { name: "GPT Image", brand: "openai" };
  const exactKlingVersion = klingVersion(offer);
  if (exactKlingVersion?.edition === "Standard") return { name: "Kling 3.0", brand: "kling" };
  if (exactKlingVersion?.edition === "Turbo") return { name: "Kling 3.0 Turbo", brand: "kling" };
  if (identity.includes("kling") && identity.includes("3")) return { name: "Kling 3.0", brand: "kling" };
  if (identity.includes("kling") && identity.includes("2.6")) return { name: "Kling 2.6", brand: "kling" };
  if (identity.includes("kling") && identity.includes("2.5")) return { name: "Kling 2.5", brand: "kling" };
  if (identity.includes("kling")) return { name: "Kling", brand: "kling" };
  if (identity.includes("seedream")) return { name: "Seedream 4.5", brand: "seedance" };
  if (identity.includes("grok-imagine")) return { name: "Grok Imagine", brand: "grok" };
  return {
    name: offer.displayName
      .replace(/\s·\s(?:\d+K|\d{3,4}p|\d+s)$/i, "")
      .replace(/\s+(?:text|image)\s+to\s+(?:image|video)$/i, "")
      .trim(),
    brand: "generic",
  };
}

export function customerModelFamilyPresentation(offer: PublishedOffer): CustomerModelFamilyPresentation {
  if (offer.presentation) {
    return {
      familyName: offer.presentation.productFamily.displayName,
      version: offer.presentation.version?.displayName ?? null,
      edition: offer.presentation.edition?.displayName ?? null,
      brand: customerModelPresentation(offer).brand,
    };
  }
  const exactKlingVersion = klingVersion(offer);
  if (exactKlingVersion) return { familyName: "Kling", ...exactKlingVersion, brand: "kling" };
  const presentation = customerModelPresentation(offer);
  const known = presentation.name.match(/^(GPT Image|Kling|Seedream|Grok Imagine)\s+(\d+(?:\.\d+)*)$/i);
  if (known) {
    return { familyName: known[1]!, version: known[2]!, edition: null, brand: presentation.brand };
  }
  return { familyName: presentation.name, version: null, edition: null, brand: presentation.brand };
}

/**
 * Stable customer hierarchy keys. These never use the provider route as a
 * family/version identity: one product version can legitimately expose
 * separate executable routes for text-to-video and image-to-video.
 */
export function customerModelProductFamilyKey(offer: PublishedOffer): string {
  const presentation = customerModelFamilyPresentation(offer);
  if (offer.presentation) return `${presentation.brand}:${offer.presentation.productFamily.id}`;
  return `${presentation.brand}:${presentation.familyName.toLocaleLowerCase()}`;
}

export function customerModelVersionKey(offer: PublishedOffer): string {
  const presentation = customerModelFamilyPresentation(offer);
  if (offer.presentation) {
    return `${customerModelProductFamilyKey(offer)}:${offer.presentation.version?.id ?? "base"}:${offer.presentation.edition?.id ?? "standard"}`;
  }
  return `${customerModelProductFamilyKey(offer)}:${presentation.version ?? "base"}:${presentation.edition ?? "standard"}`;
}

const GenericMark: ComponentType<{ className?: string }> = ImageIcon;

/**
 * Local, monochrome vector marks for the model brands. They are deliberately
 * kept separate from provider routing and are rendered as small factual model
 * identifiers only—not as a partner lockup or FusionLab branding.
 */
function OfficialModelBrandMark({
  brand,
  className,
}: Readonly<{ brand: Exclude<CustomerModelPresentation["brand"], "generic">; className?: string }>) {
  const shared = { className, fill: "currentColor", viewBox: "0 0 24 24", xmlns: "http://www.w3.org/2000/svg" };
  switch (brand) {
    case "openai":
      return <svg {...shared} fillRule="evenodd"><path d="M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.553 5.553 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.02.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.002zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z" /></svg>;
    case "kling":
      return <svg {...shared} fillRule="evenodd"><path clipRule="evenodd" d="M5.493 21.234c-1.112-1.451-1.109-4.263-.081-7.459l-4.557-2.63a1.683 1.683 0 01-.85-1.304 1.505 1.505 0 01.08-.622 13.18 13.18 0 011.037-2.255c3.476-6.02 10.916-8.23 16.619-4.938.46.266.82.67 1.081 1.184.785 1.545.685 4.096-.234 6.954l4.557 2.631c.339.196.596.492.736.832a1.53 1.53 0 01.034 1.093 13.146 13.146 0 01-1.037 2.255c-3.476 6.02-10.916 8.23-16.619 4.938a2.6 2.6 0 01-.766-.68zm11.096-6.615c-2.073 3.591-5.808 5.316-8.343 3.852-1.267-.731-1.994-2.122-2.145-3.778-.095-1.035.036-2.173.4-3.32.217-.684.517-1.37.902-2.039l.008-.014c2.073-3.59 5.808-5.315 8.343-3.852.633.366 1.13.895 1.49 1.54.986 1.772.922 4.415-.285 6.914-.111.23-.232.457-.362.683l-.008.014z" /></svg>;
    case "seedance":
      return <svg {...shared} fillRule="evenodd"><path d="M14.944 18.587l-1.704-.445V10.01l1.824-.462c1-.254 1.84-.461 1.88-.453.032 0 .056 2.235.056 4.972v4.973l-.176-.008c-.104 0-.952-.207-1.88-.446zM7 16.542c0-2.736.024-4.98.064-4.98.032-.008.872.2 1.88.454l1.816.461-.016 4.05-.024 4.049-1.632.422c-.896.23-1.736.445-1.856.469L7 21.523v-4.98zM19.24 12.477c0-9.03.008-9.515.144-9.475.072.024.784.207 1.576.406.792.207 1.576.405 1.744.445l.296.08-.016 8.56-.024 8.568-1.624.414c-.888.23-1.728.437-1.856.47l-.24.055v-9.523zM1 12.509c0-4.678.024-8.505.064-8.505.032 0 .872.207 1.872.454l1.824.461v7.582c0 4.16-.016 7.574-.032 7.574-.024 0-.872.215-1.88.47L1 21.013v-8.505z" /></svg>;
    case "grok":
      return <svg {...shared} fillRule="evenodd"><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" /></svg>;
  }
}

/**
 * A stable local mark component. The registry key lets us replace a mark with
 * a reviewed first-party SVG without changing any customer-facing component
 * or provider integration.
 */
export function CustomerModelMark({
  presentation,
  className = "",
}: Readonly<{ presentation: CustomerModelPresentation; className?: string }>) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.12] bg-[#191d24] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.04)] ${className}`}
    >
      {presentation.brand === "generic" ? (
        <GenericMark className="h-4 w-4" />
      ) : (
        <OfficialModelBrandMark brand={presentation.brand} className="h-4 w-4" />
      )}
    </span>
  );
}
