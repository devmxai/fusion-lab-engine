import type { ProviderGenerationRequest } from "../../../../packages/contracts/src/provider.ts";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import {
  ProviderSubmissionUnknownError,
  type ProviderAdapter,
} from "../../../../packages/providers/src/types.ts";
import { ProviderTestService } from "../../../provider-test-api/src/service.ts";

export class FakeProviderAdapter implements ProviderAdapter {
  readonly id = "provider-test";
  readonly displayName = "Provider For Test";
  readonly version = "test";
  readonly assetSourcePolicy = {
    allowedOrigins: ["http://127.0.0.1:8790"],
    allowHttpLoopbackForLocalTest: true,
    allowPrivateLoopbackForLocalTest: true,
  } as const;
  readonly service = new ProviderTestService("http://127.0.0.1:8790");

  async listModels() { return this.service.listModels(); }
  async getBalance() { return this.service.getBalance(); }
  async submit(request: ProviderGenerationRequest, idempotencyKey: string) {
    const submitted = this.service.submit(request, idempotencyKey);
    if (submitted.submissionUnknown) throw new ProviderSubmissionUnknownError();
    return submitted.task;
  }
  async lookupByIdempotency(idempotencyKey: string) {
    return this.service.lookup(idempotencyKey);
  }
  async getTask(taskId: string) { return this.service.poll(taskId); }
  async fetchAsset(resultUrl: string) {
    const taskId = new URL(resultUrl).pathname.split("/").at(-1)!;
    const asset = this.service.getAsset(taskId);
    return { ...asset, sourceUrl: resultUrl };
  }
  async resetForDevelopment() { this.service.reset(); }
}

export function createFakeProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new FakeProviderAdapter());
  return registry;
}
