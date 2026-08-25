import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ImmutableAdminAuditLog } from "./audit.ts";
import { VersionedAdminChangeService } from "./change-service.ts";
import { WriteOnlyCredentialVault } from "./credential-vault.ts";
import { AdminControlPlaneError, type AdminIdentity, type AdminRole } from "./types.ts";

const evidence = (value: string) => createHash("sha256").update(value).digest("hex");
const now = () => new Date("2026-08-12T12:00:00.000Z");
let sequence = 0;
const id = () => `00000000-0000-4000-8000-${(++sequence).toString().padStart(12, "0")}`;

function identity(actorId: string, roles: AdminRole[], assuranceLevel: 1 | 2 = 2): AdminIdentity {
  return { actorId, roles: ["ADMIN_VIEWER", ...roles], assuranceLevel };
}

function service(onPublish = vi.fn()) {
  sequence = 0;
  return {
    onPublish,
    changes: new VersionedAdminChangeService(new ImmutableAdminAuditLog(now, id), now, id, onPublish),
  };
}

function approvedRouteChange(changes: VersionedAdminChangeService) {
  const maker = identity("route-maker", ["ROUTE_MAKER"]);
  const approver = identity("route-approver", ["ROUTE_APPROVER"]);
  let change = changes.createDraft(maker, "draft-route-0001", {
    resourceType: "ROUTE_CONTROL",
    resourceId: "provider-test:local/test-video-v1",
    payload: { enabled: true, reasonCode: "INCIDENT_CONTAINMENT" },
    reasonCode: "P0_CONTAINMENT",
  });
  change = changes.validate(approver, "validate-route-0001", change.id, evidence("validation"));
  change = changes.simulate(approver, "simulate-route-0001", change.id, evidence("simulation"));
  return changes.approve(approver, "approve-route-0001", change.id, evidence("approval"));
}

describe("Admin V2 authorization and workflow", () => {
  it("requires AAL2 and scoped RBAC before creating a sensitive draft", () => {
    const { changes } = service();
    expect(() => changes.createDraft(identity("maker", ["ROUTE_MAKER"], 1), "draft-route-aal1", {
      resourceType: "ROUTE_CONTROL",
      resourceId: "route-1",
      payload: { enabled: false },
      reasonCode: "TEST",
    })).toThrowError(expect.objectContaining<Partial<AdminControlPlaneError>>({ code: "AAL2_REQUIRED" }));
    expect(() => changes.createDraft(identity("pricing-maker", ["PRICING_MAKER"]), "draft-route-denied", {
      resourceType: "ROUTE_CONTROL",
      resourceId: "route-1",
      payload: { enabled: false },
      reasonCode: "TEST",
    })).toThrowError(expect.objectContaining<Partial<AdminControlPlaneError>>({ code: "ADMIN_PERMISSION_DENIED" }));
  });

  it("enforces Draft→Validate→Simulate→Approve→Publish and independent maker-checker", () => {
    const { changes, onPublish } = service();
    const maker = identity("route-maker", ["ROUTE_MAKER", "ROUTE_APPROVER"]);
    let change = changes.createDraft(maker, "draft-route-0001", {
      resourceType: "ROUTE_CONTROL",
      resourceId: "route-1",
      payload: { enabled: true, reasonCode: "INCIDENT" },
      reasonCode: "CONTAINMENT",
    });
    expect(() => changes.publish(identity("publisher", ["PUBLISHER"]), "publish-too-early", change.id))
      .toThrowError(expect.objectContaining<Partial<AdminControlPlaneError>>({ code: "MAKER_CHECKER_REQUIRED" }));
    change = changes.validate(maker, "validate-route-0001", change.id, evidence("validate"));
    change = changes.simulate(maker, "simulate-route-0001", change.id, evidence("simulate"));
    expect(() => changes.approve(maker, "approve-self-0001", change.id, evidence("approve")))
      .toThrowError(expect.objectContaining<Partial<AdminControlPlaneError>>({ code: "MAKER_CHECKER_REQUIRED" }));
    change = changes.approve(identity("route-approver", ["ROUTE_APPROVER"]), "approve-route-0001", change.id, evidence("approve"));
    const published = changes.publish(identity("publisher", ["PUBLISHER"]), "publish-route-0001", change.id);
    expect(published.state).toBe("PUBLISHED");
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(changes.audit.verify()).toBe(true);
  });

  it("never mutates a published version and represents rollback as a new reviewed version", () => {
    const { changes } = service();
    const published = changes.publish(
      identity("publisher", ["PUBLISHER"]),
      "publish-route-0001",
      approvedRouteChange(changes).id,
    );
    expect(() => changes.validate(identity("approver", ["ROUTE_APPROVER"]), "mutate-published", published.id, evidence("x")))
      .toThrowError(expect.objectContaining<Partial<AdminControlPlaneError>>({ code: "IMMUTABLE_VERSION" }));
    const rollback = changes.createRollbackDraft(
      identity("rollback-maker", ["ROUTE_MAKER"]),
      "rollback-route-0001",
      published.id,
      "ROLLBACK_AFTER_INCIDENT",
    );
    expect(rollback).toMatchObject({ version: 2, state: "DRAFT", rollbackOfVersionId: published.id });
    expect(changes.get(identity("auditor", ["AUDITOR"]), published.id).state).toBe("PUBLISHED");
  });

  it("replays one command idempotently and rejects command ID reuse with different intent", () => {
    const { changes } = service();
    const maker = identity("route-maker", ["ROUTE_MAKER"]);
    const input = {
      resourceType: "ROUTE_CONTROL" as const,
      resourceId: "route-1",
      payload: { enabled: false },
      reasonCode: "TEST",
    };
    const first = changes.createDraft(maker, "same-command-0001", input);
    expect(changes.createDraft(maker, "same-command-0001", input)).toEqual(first);
    expect(changes.list(maker)).toHaveLength(1);
    expect(() => changes.createDraft(maker, "same-command-0001", { ...input, resourceId: "route-2" }))
      .toThrowError(expect.objectContaining<Partial<AdminControlPlaneError>>({ code: "ADMIN_COMMAND_CONFLICT" }));
  });

  it("rejects secret-shaped fields from the versioned change and preserves only hashes in audit", () => {
    const { changes } = service();
    expect(() => changes.createDraft(identity("security", ["SECURITY_OPERATOR"]), "secret-in-draft-1", {
      resourceType: "PROVIDER_CREDENTIAL",
      resourceId: "openrouter:main",
      payload: { apiKey: "must-not-enter-change-log" },
      reasonCode: "ROTATION",
    })).toThrowError(expect.objectContaining<Partial<AdminControlPlaneError>>({ code: "VALIDATION_FAILED" }));
    expect(JSON.stringify(changes.audit.snapshot())).not.toContain("must-not-enter-change-log");
  });

  it("keeps public reference catalog evidence separate from local operating catalog snapshots", () => {
    const { changes, onPublish } = service();
    const maker = identity("catalog-maker", ["ROUTE_MAKER"]);
    const checker = identity("catalog-checker", ["ROUTE_APPROVER"]);
    const hash = evidence("openrouter-public-catalog");
    let change = changes.createDraft(maker, "reference-catalog-draft-001", {
      resourceType: "REFERENCE_CATALOG_SNAPSHOT",
      resourceId: "snapshot.openrouter.public.001",
      payload: {
        id: "snapshot.openrouter.public.001", providerId: "openrouter", observedAt: "2026-08-22T00:00:00.000Z",
        parserVersion: "openrouter-public-models.v1", rawPayloadSha256: hash, manifestSha256: hash,
        evidenceSha256: hash, sourceScope: "PUBLIC_REFERENCE", sourceUrls: ["https://openrouter.ai/api/v1/models"],
      },
      reasonCode: "PUBLIC_CATALOG_REFRESH",
    });
    change = changes.validate(checker, "reference-catalog-validate-001", change.id, hash);
    change = changes.simulate(checker, "reference-catalog-simulate-001", change.id, hash);
    change = changes.approve(checker, "reference-catalog-approve-001", change.id, hash);
    const published = changes.publish(identity("catalog-publisher", ["PUBLISHER"]), "reference-catalog-publish-001", change.id);
    expect(published.state).toBe("PUBLISHED");
    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ resourceType: "REFERENCE_CATALOG_SNAPSHOT" }));

    const invalid = changes.createDraft(maker, "reference-catalog-invalid-001", {
      resourceType: "REFERENCE_CATALOG_SNAPSHOT", resourceId: "snapshot.invalid.001",
      payload: { id: "snapshot.invalid.001", providerId: "openrouter", observedAt: "not-a-date", parserVersion: "v1", rawPayloadSha256: hash, manifestSha256: hash, evidenceSha256: hash, sourceScope: "PUBLIC_REFERENCE", sourceUrls: ["http://invalid.example"] },
      reasonCode: "TEST_INVALID_SOURCE",
    });
    expect(() => changes.validate(checker, "reference-catalog-invalid-validate-001", invalid.id, hash))
      .toThrowError(expect.objectContaining<Partial<AdminControlPlaneError>>({ code: "VALIDATION_FAILED" }));
  });
});

describe("write-only credential flow", () => {
  it("writes, fingerprints, tests and activates without any reveal API", () => {
    sequence = 0;
    const vault = new WriteOnlyCredentialVault(now, id);
    const maker = identity("security-maker", ["SECURITY_OPERATOR"]);
    const checker = identity("security-checker", ["SECURITY_OPERATOR"]);
    const metadata = vault.write(maker, {
      providerId: "openrouter",
      accountId: "workspace-main",
      environment: "LOCAL",
      secret: "local-secret-value-never-returned",
    });
    expect(metadata).not.toHaveProperty("secret");
    expect(JSON.stringify(metadata)).not.toContain("local-secret-value-never-returned");
    const tested = vault.test(checker, metadata.id, (secret) => secret.endsWith("never-returned"));
    expect(tested.status).toBe("TESTED");
    expect(() => vault.activate(maker, metadata.id, maker.actorId)).toThrowError(
      expect.objectContaining<Partial<AdminControlPlaneError>>({ code: "MAKER_CHECKER_REQUIRED" }),
    );
    expect(vault.activate(checker, metadata.id, maker.actorId).status).toBe("ACTIVE");
    expect(() => vault.reveal()).toThrowError(expect.objectContaining<Partial<AdminControlPlaneError>>({
      code: "SECRET_REVEAL_PROHIBITED",
    }));
  });
});
