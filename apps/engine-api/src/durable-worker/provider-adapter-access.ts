import type { ProviderAdapter } from "../../../../packages/providers/src/types.js";

/** Resolves an adapter per durable operation, inside its credential lease. */
export interface OperationProviderAdapterAccess {
  withAdapter<T>(
    input: Readonly<{ operationId: string; providerId: string }>,
    work: (adapter: ProviderAdapter) => Promise<T>,
  ): Promise<T>;
}
