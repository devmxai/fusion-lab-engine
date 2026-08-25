import {
  ProviderRouteCatalog,
  ProviderRouteManifestSchema,
  type CatalogScope,
  type ProviderRouteManifest,
} from "../../contracts/src/provider-catalog.js";
import type { ProviderAdapter } from "./types.js";

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();
  private readonly routes = new ProviderRouteCatalog();

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`provider_adapter_already_registered:${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  require(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new Error(`provider_adapter_not_registered:${providerId}`);
    return adapter;
  }

  list(): Array<{ id: string; displayName: string; version: string }> {
    return [...this.adapters.values()].map((adapter) => ({
      id: adapter.id,
      displayName: adapter.displayName,
      version: adapter.version,
    }));
  }

  registerRoute(input: ProviderRouteManifest): ProviderRouteManifest {
    const route = ProviderRouteManifestSchema.parse(input);
    this.require(route.providerId);
    return this.routes.register(route);
  }

  requireRoute(routeId: string): ProviderRouteManifest {
    return this.routes.require(routeId);
  }

  requirePublishedRoute(routeId: string): ProviderRouteManifest {
    return this.routes.requirePublished(routeId);
  }

  listRoutes(filter: { providerId?: string; scope?: CatalogScope; publishedOnly?: boolean } = {}): ProviderRouteManifest[] {
    return this.routes.list(filter);
  }
}
