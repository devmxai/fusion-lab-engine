import { describe, expect, it } from "vitest";
import { QuoteResponseV2Schema, PublicOperationV2Schema } from "./api-v2.ts";
import { CanonicalEventSchema, eventCatalog } from "./events.ts";
import { openApiV2Document, requiredPublicV2Paths } from "./openapi.ts";
import { legalOperationTransitions, requireLegalTransition } from "./operation.ts";

const UUID = "018f1f28-67d3-7c32-8e53-3d713aef8a91";
const UUID_2 = "018f1f28-67d3-7c32-8e53-3d713aef8a92";
const HASH = "a".repeat(64);

type ContractOperation = {
  security?: unknown[];
  parameters?: Array<{ name?: string; in?: string; required?: boolean }>;
  "x-privacy-class"?: string;
  "x-rate-limit-policy"?: string;
  "x-pagination"?: string;
};

describe("API-001 public API contract", () => {
  it("contains every required v2 path", () => {
    for (const path of requiredPublicV2Paths) {
      expect(openApiV2Document.paths).toHaveProperty(path);
    }
  });

  it("declares authentication, privacy and rate limiting for every operation", () => {
    for (const pathItem of Object.values(openApiV2Document.paths)) {
      for (const contract of Object.values(pathItem) as ContractOperation[]) {
        expect(contract.security).toEqual([{ bearerAuth: [] }]);
        expect(contract["x-privacy-class"]).toMatch(/^(INTERNAL|CONFIDENTIAL)$/);
        expect(contract["x-rate-limit-policy"]).toBe("authenticated-user-and-project");
      }
    }
  });

  it("requires an idempotency key for every mutation", () => {
    for (const pathItem of Object.values(openApiV2Document.paths)) {
      for (const [method, contract] of Object.entries(pathItem) as Array<[string, ContractOperation]>) {
        if (method === "get") continue;
        expect(contract.parameters).toContainEqual(expect.objectContaining({
          name: "Idempotency-Key",
          in: "header",
          required: true,
        }));
      }
    }
  });

  it("does not expose provider routing or provider finance fields", () => {
    const serialized = JSON.stringify(openApiV2Document);
    for (const forbidden of [
      "providerTaskId",
      "provider_model_id",
      "providerCost",
      "actualProviderCredits",
      "rawProviderPayload",
      "secretRef",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rejects internal fields in strict public DTOs", () => {
    const quote = {
      quoteId: UUID,
      projectId: UUID_2,
      customerCredits: 4,
      discountCredits: 0,
      expiresAt: "2026-08-12T12:00:00.000Z",
      mode: "exact",
      pinned: {
        recipeVersionId: UUID,
        familyVersionId: UUID_2,
        customerPriceVersionId: UUID,
      },
      requestHash: HASH,
      providerCost: 2,
    };
    expect(QuoteResponseV2Schema.safeParse(quote).success).toBe(false);

    const operation = {
      operationId: UUID,
      generationIntentId: "generation-intent-contract-0001",
      projectId: UUID_2,
      quoteId: UUID,
      state: "QUEUED",
      stateVersion: 3,
      customerCredits: 4,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:01.000Z",
      resultAssetIds: [],
      error: null,
      providerTaskId: "private-task-id",
    };
    expect(PublicOperationV2Schema.safeParse(operation).success).toBe(false);
  });
});

describe("STM-001 operation transition contract", () => {
  it("applies a legal compare-and-set transition and increments version once", () => {
    const result = requireLegalTransition({
      currentState: "DRAFT",
      currentVersion: 7,
      expectedState: "DRAFT",
      expectedVersion: 7,
      event: "quote.issued.v1",
      actor: "engine-api",
      hasEvidence: true,
    });
    expect(result.state).toBe("QUOTED");
    expect(result.version).toBe(8);
  });

  it("rejects stale, illegal, unauthorized and evidence-free transitions", () => {
    const validBase = {
      currentState: "DRAFT" as const,
      currentVersion: 1,
      expectedState: "DRAFT" as const,
      expectedVersion: 1,
      event: "quote.issued.v1",
      actor: "engine-api" as const,
      hasEvidence: true,
    };
    expect(() => requireLegalTransition({ ...validBase, expectedVersion: 0 }))
      .toThrow("operation_compare_and_set_conflict");
    expect(() => requireLegalTransition({
      ...validBase,
      currentState: "SETTLED",
      expectedState: "SETTLED",
      event: "provider.running.v1",
    })).toThrow("illegal_operation_transition");
    expect(() => requireLegalTransition({ ...validBase, actor: "worker" }))
      .toThrow("illegal_operation_transition");
    expect(() => requireLegalTransition({ ...validBase, hasEvidence: false }))
      .toThrow("operation_transition_evidence_required");
  });

  it("contains no duplicate transition authority tuple", () => {
    const tuples = legalOperationTransitions.map(({ from, event, actor }) => `${from}:${event}:${actor}`);
    expect(new Set(tuples).size).toBe(tuples.length);
  });
});

describe("EVT-001 canonical event contract", () => {
  const validEvent = {
    eventId: UUID,
    schemaVersion: 1,
    occurredAt: "2026-08-12T12:00:00.000Z",
    producer: "engine-api",
    correlationId: UUID_2,
    causationId: null,
    aggregate: { type: "quote", id: UUID, version: 1 },
    privacyClass: "CONFIDENTIAL",
    name: "quote.issued.v1",
    payload: { quoteId: UUID_2, customerCredits: 4, requestHash: HASH },
  } as const;

  it("accepts a versioned typed envelope", () => {
    expect(CanonicalEventSchema.parse(validEvent)).toEqual(validEvent);
  });

  it("rejects secrets and raw provider payloads by strict schema", () => {
    expect(CanonicalEventSchema.safeParse({ ...validEvent, secret: "never" }).success).toBe(false);
    expect(CanonicalEventSchema.safeParse({
      ...validEvent,
      payload: { ...validEvent.payload, rawProviderPayload: { private: true } },
    }).success).toBe(false);
  });

  it("catalogues each event name exactly once with compatibility policy", () => {
    expect(new Set(eventCatalog.map(({ name }) => name)).size).toBe(eventCatalog.length);
    expect(eventCatalog.every(({ schemaVersion }) => schemaVersion === 1)).toBe(true);
    expect(eventCatalog.every(({ compatibility }) => compatibility === "BACKWARD_ADD_OPTIONAL_ONLY")).toBe(true);
  });
});
