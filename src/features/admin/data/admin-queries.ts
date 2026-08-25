import { useQuery, type QueryFunction } from "@tanstack/react-query";

export const adminQueryKeys = {
  overview: ["admin", "overview"] as const,
  durableOverview: ["admin", "durable-overview"] as const,
  commerce: ["admin", "commerce"] as const,
  providers: ["admin", "providers"] as const,
  providerDirectory: ["admin", "provider-directory"] as const,
  credentials: ["admin", "credentials"] as const,
  capabilities: ["admin", "capabilities"] as const,
  referenceModels: ["admin", "reference-models"] as const,
  referenceSnapshots: ["admin", "reference-snapshots"] as const,
  offlineCatalog: ["admin", "offline-catalog"] as const,
  pricing: ["admin", "pricing"] as const,
  changes: ["admin", "changes"] as const,
  operations: ["admin", "operations"] as const,
  exceptions: ["admin", "exceptions"] as const,
  owners: ["admin", "owners"] as const,
  customers: ["admin", "customers"] as const,
  customer: (ownerId: string) => ["admin", "customers", ownerId] as const,
  audit: ["admin", "audit"] as const,
  approvals: ["admin", "approvals"] as const,
  snapshots: ["admin", "snapshots"] as const,
} as const;

export function useAdminReadQuery<T>(queryKey: readonly unknown[], queryFn: QueryFunction<T>) {
  return useQuery({
    queryKey,
    queryFn,
    // Admin writes always revalidate explicitly. Keeping read models warm for
    // one minute makes navigation instant without weakening server authority.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
