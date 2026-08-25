/**
 * Provider records that may be configured in the control plane.
 *
 * These are deliberately not route manifests. A known provider never implies
 * that its models, prices, endpoints, or credentials were imported or
 * approved. Routes exist only after the catalog-snapshot workflow.
 */
export type ProviderOnboardingProfile = {
  providerId: string;
  displayName: string;
  documentationUrl: string;
  catalogUrl: string;
  pricingUrl: string;
  documentedCapabilities: string[];
  catalogState: "CATALOG_NOT_IMPORTED";
};

export const providerOnboardingProfiles: readonly ProviderOnboardingProfile[] = [
  {
    providerId: "kie",
    displayName: "KIE.ai",
    documentationUrl: "https://docs.kie.ai/",
    catalogUrl: "https://kie.ai/market",
    pricingUrl: "https://kie.ai/pricing",
    documentedCapabilities: ["text", "image", "video", "audio"],
    catalogState: "CATALOG_NOT_IMPORTED",
  },
  {
    providerId: "openrouter",
    displayName: "OpenRouter",
    documentationUrl: "https://openrouter.ai/docs/quickstart",
    catalogUrl: "https://openrouter.ai/models",
    pricingUrl: "https://openrouter.ai/pricing",
    documentedCapabilities: ["text", "image", "video", "audio", "embeddings"],
    catalogState: "CATALOG_NOT_IMPORTED",
  },
] as const;
