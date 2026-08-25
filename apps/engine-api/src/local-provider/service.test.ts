// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ProviderGenerationRequest } from "../../../../packages/contracts/src/provider.ts";
import { ProviderRegistry } from "../../../../packages/providers/src/registry.ts";
import {
  ProviderSubmissionUnknownError,
  type ProviderAdapter,
} from "../../../../packages/providers/src/types.ts";
import { ProviderTestService } from "../../../provider-test-api/src/service.ts";
import {
  LocalMockProviderError,
  LocalMockProviderService,
  type MockOperationView,
} from "./service.ts";

class InMemoryProviderAdapter implements ProviderAdapter {
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

class NeverFoundUnknownAdapter extends InMemoryProviderAdapter {
  override async lookupByIdempotency(_idempotencyKey: string) { return null; }
}

class NeverTerminalAdapter extends InMemoryProviderAdapter {
  override async getTask(taskId: string) {
    return {
      taskId,
      status: "running" as const,
      actualProviderCredits: null,
      resultUrl: null,
      errorCode: null,
    };
  }
}

class UnknownChargeFailureAdapter extends InMemoryProviderAdapter {
  override async getTask(taskId: string) {
    return {
      taskId,
      status: "failed" as const,
      actualProviderCredits: null,
      resultUrl: null,
      errorCode: "PROVIDER_FAILED_WITHOUT_COST_EVIDENCE",
      chargeStatus: "UNKNOWN" as const,
    };
  }
}

function deterministicService(
  initialCustomerCredits = 1_000n,
  adapter: InMemoryProviderAdapter = new InMemoryProviderAdapter(),
  limits: { maxUnknownLookupsBeforeManualReview?: number; maxPollsBeforeManualReview?: number } = {},
) {
  let sequence = 0;
  const registry = new ProviderRegistry();
  registry.register(adapter);
  return new LocalMockProviderService({
    providerRegistry: registry,
    initialCustomerCredits,
    ...limits,
    now: () => new Date("2026-08-11T18:00:00.000Z"),
    id: () => {
      sequence += 1;
      return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
    },
  });
}

async function createImageOperation(
  service: LocalMockProviderService,
  scenario: "success" | "provider_failure" | "submission_unknown_then_success" | "delivery_failure" | "cost_shock_success" = "success",
) {
  const quote = service.createQuote({ modelId: "local/test-image-v1" });
  return service.createOperation({
    quoteId: quote.id,
    idempotencyKey: `local-${scenario}-0001`,
    scenario,
  });
}

async function advanceToTerminal(
  service: LocalMockProviderService,
  operation: MockOperationView,
) {
  let current = operation;
  for (let index = 0; index < 10; index += 1) {
    if (["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED"].includes(current.state)) {
      return current;
    }
    current = await service.advance(current.id);
  }
  throw new Error("operation_did_not_reach_terminal_state");
}

describe("LocalMockProviderService through canonical adapter", () => {
  it("reserves then settles once after provider HTTP-equivalent delivery", async () => {
    const service = deterministicService();
    const operation = await createImageOperation(service);
    expect(operation.state).toBe("RESERVED");
    expect(operation.providerTaskId).toBeNull();

    expect((await service.getBalances()).customerCredits).toMatchObject({
      available: 996,
      held: 4,
      spent: 0,
    });
    expect((await service.getBalances()).providerTreasury.localProvider).toMatchObject({
      availableAtomic: "1000",
      heldAtomic: "0",
      spentAtomic: "0",
    });

    const submitted = await service.advance(operation.id);
    expect(submitted.state).toBe("SUBMITTED");
    expect(submitted.providerTaskId).toBeTruthy();
    expect(submitted.attempts).toEqual([
      expect.objectContaining({ attemptNumber: 1, state: "SUBMITTED" }),
    ]);

    const settled = await advanceToTerminal(service, submitted);
    expect(settled.state).toBe("SETTLED");
    expect(settled.assetChecksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(settled.financials).toMatchObject({
      customerChargedCredits: 4,
      providerChargedCredits: 2,
      realizedGrossProfitCredits: 2,
      realizedGrossMarginBps: 5_000,
    });
    expect((await service.getBalances()).customerCredits).toMatchObject({
      available: 996,
      held: 0,
      spent: 4,
    });
    expect((await service.getBalances()).providerTreasury.localProvider).toMatchObject({
      availableAtomic: "998",
      heldAtomic: "0",
      spentAtomic: "2",
    });
    expect(service.getLedgerAudit().journals.map(({ kind }) => kind)).toEqual([
      "GRANT",
      "RESERVE",
      "SETTLE",
    ]);

    const repeatedAdvance = await service.advance(settled.id);
    expect(repeatedAdvance.events).toHaveLength(settled.events.length);
  });

  it("returns one operation for one idempotency key", async () => {
    const service = deterministicService();
    const quote = service.createQuote({ modelId: "local/test-image-v1" });
    const input = {
      quoteId: quote.id,
      idempotencyKey: "same-operation-0001",
      scenario: "success" as const,
    };
    const first = await service.createOperation(input);
    const repeated = await Promise.all(Array.from({ length: 100 }, () => service.createOperation(input)));
    expect(repeated.every(({ id }) => id === first.id)).toBe(true);
    expect((await service.getBalances()).customerCredits.held).toBe(4);
    const submitted = await service.advance(first.id);
    expect(submitted.state).toBe("SUBMITTED");
    expect(service.getLedgerAudit().operations).toHaveLength(1);
    expect(service.getLedgerAudit().outbox).toHaveLength(1);
    expect(service.getLedgerAudit().attempts).toHaveLength(1);
    expect((await service.getBalances()).providerTreasury.localProvider.heldAtomic).toBe("2");
    await expect(service.createOperation({ ...input, scenario: "provider_failure" }))
      .rejects.toBeInstanceOf(LocalMockProviderError);
  });

  it("consumes one quote once across 100 distinct transport retries", async () => {
    const service = deterministicService();
    const quote = service.createQuote({ modelId: "local/test-image-v1" });
    const repeated = await Promise.all(Array.from({ length: 100 }, (_, index) => service.createOperation({
      quoteId: quote.id,
      idempotencyKey: `transport-retry-${index.toString().padStart(4, "0")}`,
      generationIntentId: "generation-intent-quote-once-0001",
      scenario: "success",
    })));

    expect(new Set(repeated.map(({ id }) => id)).size).toBe(1);
    expect(service.getLedgerAudit().operations).toHaveLength(1);
    expect(service.getLedgerAudit().outbox).toHaveLength(1);
    expect(service.getLedgerAudit().journals.filter(({ kind }) => kind === "RESERVE")).toHaveLength(1);
    expect((await service.getBalances()).customerCredits).toMatchObject({ available: 996, held: 4, spent: 0 });
  });

  it("records every runtime state change through the legal versioned state machine", async () => {
    const service = deterministicService();
    const operation = await createImageOperation(service);
    const settled = await advanceToTerminal(service, operation);

    expect(settled.state).toBe("SETTLED");
    expect(settled.stateVersion).toBe(settled.events.length - 1);
    expect(settled.events.map(({ version }) => version)).toEqual(
      Array.from({ length: settled.events.length }, (_, index) => index),
    );
  });

  it("resolves an accepted-but-timeout submission through provider lookup", async () => {
    const service = deterministicService();
    const operation = await createImageOperation(service, "submission_unknown_then_success");
    expect(operation.state).toBe("RESERVED");
    const unknown = await service.advance(operation.id);
    expect(unknown.state).toBe("SUBMISSION_UNKNOWN");
    expect((await service.getBalances()).providerTreasury.localProvider).toMatchObject({
      availableAtomic: "998",
      heldAtomic: "2",
    });

    const resolved = await service.advance(unknown.id);
    expect(resolved.state).toBe("SUBMITTED");
    expect(resolved.providerTaskId).toBeTruthy();
    expect((await service.getBalances()).customerCredits.held).toBe(4);
  });

  it("recovers submission unknown from a verified callback without settlement or retry", async () => {
    const service = deterministicService();
    const operation = await createImageOperation(service, "submission_unknown_then_success");
    const unknown = await service.advance(operation.id);
    const recovered = await service.consumeProviderCallback({
      operationId: unknown.id,
      deliveryId: "verified-kie-wakeup-1",
      task: { taskId: "callback-recovered-task", status: "submitted", actualProviderCredits: null, resultUrl: null, errorCode: null, chargeStatus: "UNKNOWN" },
    });
    expect(recovered.operation).toMatchObject({ state: "SUBMITTED", providerTaskId: "callback-recovered-task" });
    expect((await service.getBalances()).customerCredits.held).toBe(4);
  });

  it("deduplicates provider callbacks and rejects conflicting delivery replays", async () => {
    const service = deterministicService();
    const reserved = await createImageOperation(service);
    const submitted = await service.advance(reserved.id);
    const task = {
      taskId: submitted.providerTaskId!,
      status: "running" as const,
      actualProviderCredits: null,
      resultUrl: null,
      errorCode: null,
    };
    const first = await service.consumeProviderCallback({
      operationId: submitted.id,
      deliveryId: "provider-delivery-0001",
      task,
    });
    const duplicate = await service.consumeProviderCallback({
      operationId: submitted.id,
      deliveryId: "provider-delivery-0001",
      task,
    });
    expect(first.delivery).toBe("PROCESSED");
    expect(duplicate.delivery).toBe("DUPLICATE");
    expect(duplicate.operation.events).toHaveLength(first.operation.events.length);
    await expect(service.consumeProviderCallback({
      operationId: submitted.id,
      deliveryId: "provider-delivery-0001",
      task: { ...task, status: "submitted" },
    })).rejects.toMatchObject({ code: "CALLBACK_REPLAY_CONFLICT", statusCode: 409 });
  });

  it("moves unresolved submission and polling timeouts to manual reconciliation without releasing the hold", async () => {
    const unknownService = deterministicService(
      1_000n,
      new NeverFoundUnknownAdapter(),
      { maxUnknownLookupsBeforeManualReview: 2 },
    );
    let unknown = await createImageOperation(unknownService, "submission_unknown_then_success");
    unknown = await unknownService.advance(unknown.id);
    expect(unknown.state).toBe("SUBMISSION_UNKNOWN");
    unknown = await unknownService.advance(unknown.id);
    unknown = await unknownService.advance(unknown.id);
    expect(unknown.state).toBe("RECONCILIATION_REQUIRED");
    expect(unknown.attempts).toEqual([expect.objectContaining({ state: "MANUAL_REVIEW" })]);
    expect((await unknownService.getBalances()).customerCredits.held).toBe(4);

    const pollingService = deterministicService(
      1_000n,
      new NeverTerminalAdapter(),
      { maxPollsBeforeManualReview: 2 },
    );
    let polling = await createImageOperation(pollingService);
    polling = await pollingService.advance(polling.id);
    polling = await pollingService.advance(polling.id);
    polling = await pollingService.advance(polling.id);
    polling = await pollingService.advance(polling.id);
    expect(polling.state).toBe("RECONCILIATION_REQUIRED");
    expect((await pollingService.getBalances()).customerCredits.held).toBe(4);
  });

  it("does not release a failed provider task when no-charge evidence is missing", async () => {
    const service = deterministicService(1_000n, new UnknownChargeFailureAdapter());
    let operation = await createImageOperation(service);
    operation = await service.advance(operation.id);
    operation = await service.advance(operation.id);
    expect(operation.state).toBe("RECONCILIATION_REQUIRED");
    expect(operation.attempts).toEqual([expect.objectContaining({ state: "MANUAL_REVIEW" })]);
    expect((await service.getBalances()).customerCredits).toMatchObject({ available: 996, held: 4, spent: 0 });
    expect(service.getLedgerAudit().journals.map(({ kind }) => kind)).toEqual(["GRANT", "RESERVE"]);
  });

  it("releases both sides on confirmed provider failure", async () => {
    const service = deterministicService();
    const terminal = await advanceToTerminal(
      service,
      await createImageOperation(service, "provider_failure"),
    );
    expect(terminal.state).toBe("PROVIDER_FAILED");
    expect(terminal.financials).toMatchObject({
      customerChargedCredits: 0,
      providerChargedCredits: 0,
      realizedGrossProfitCredits: 0,
    });
    expect((await service.getBalances()).customerCredits.available).toBe(1_000);
    expect((await service.getBalances()).providerTreasury.localProvider).toMatchObject({
      availableAtomic: "1000",
      heldAtomic: "0",
      spentAtomic: "0",
    });
    expect(service.getLedgerAudit().journals.map(({ kind }) => kind)).toEqual([
      "GRANT",
      "RESERVE",
      "RELEASE",
    ]);
    expect(service.getReconciliationReport()).toMatchObject({
      totalOperations: 1,
      reconciledOperations: 1,
      reconciliationRateBps: 10_000,
      targetMet: true,
    });
  });

  it("records provider loss when real asset download fails", async () => {
    const service = deterministicService();
    const terminal = await advanceToTerminal(
      service,
      await createImageOperation(service, "delivery_failure"),
    );
    expect(terminal.state).toBe("DELIVERY_FAILED");
    expect(terminal.providerLossMicrousd).toBe("20000");
    expect(terminal.financials).toMatchObject({
      customerChargedCredits: 0,
      providerChargedCredits: 2,
      realizedGrossProfitCredits: -2,
    });
    expect((await service.getBalances()).customerCredits.available).toBe(1_000);
  });

  it("absorbs actual provider cost shock above the fixed quote", async () => {
    const service = deterministicService();
    const terminal = await advanceToTerminal(
      service,
      await createImageOperation(service, "cost_shock_success"),
    );
    expect(terminal.state).toBe("SETTLED");
    expect(terminal.financials).toMatchObject({
      customerChargedCredits: 4,
      providerChargedCredits: 3,
      realizedGrossProfitCredits: 1,
      realizedGrossMarginBps: 2_500,
    });
  });

  it("rejects a quote above the site wallet before provider dispatch", async () => {
    const service = deterministicService(1n);
    const quote = service.createQuote({ modelId: "local/test-image-v1" });
    await expect(service.createOperation({
      quoteId: quote.id,
      idempotencyKey: "insufficient-0001",
      scenario: "success",
    })).rejects.toThrow("insufficient credits");
    expect((await service.getBalances()).providerTreasury.localProvider.availableAtomic)
      .toBe("1000");
  });
});
