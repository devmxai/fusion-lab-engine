// @vitest-environment node
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import type { TransactionalSqlClient } from "../../durable-execution/src/postgres-atomic.ts";
import { createLocalTestRegistrySnapshot } from "./local-test-fixture.ts";
import { assertCommercialReleaseBinding, PostgresCommercialRegistryRepository } from "./durable-registry-repository.ts";

const sql = await readFile(new URL("../../durable-execution/sql/001_generation_v2_durability.sql", import.meta.url), "utf8");
const databases: PGlite[] = [];
const directories: string[] = [];
const NOW = () => new Date("2026-08-22T12:00:00.000Z");

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => { try { await database.close(); } catch { /* intentionally closed in restart test */ } }));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("durable commercial registry snapshots", () => {
  it("round-trips bigint pricing values and rejects immutable identity reuse", async () => {
    const database = await PGlite.create(); databases.push(database); await database.exec(sql);
    const repository = new PostgresCommercialRegistryRepository(database as unknown as TransactionalSqlClient, NOW);
    const snapshot = createLocalTestRegistrySnapshot();
    const stored = await repository.appendSnapshot({ commandId: "commercial-registry-write-001", evidenceSha256: "a".repeat(64), snapshot });
    expect(stored.snapshot.billingManifests[0]!.nativeScale).toBe(1n);
    expect(stored.snapshot.customerPriceVersions[0]!.targetContributionMarginBps).toBe(5_000n);
    await expect(repository.appendSnapshot({ commandId: "commercial-registry-write-001", evidenceSha256: "a".repeat(64), snapshot })).resolves.toEqual(stored);
    await expect(repository.appendSnapshot({ commandId: "commercial-registry-write-002", evidenceSha256: "a".repeat(64), snapshot })).rejects.toMatchObject({ code: "DUPLICATE_REGISTRY_SNAPSHOT" });
  });

  it("survives local Engine restart and refuses evidence mismatch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fusionlab-commercial-registry-")); directories.push(directory);
    const first = await PGlite.create(directory); databases.push(first); await first.exec(sql);
    const snapshot = createLocalTestRegistrySnapshot();
    await new PostgresCommercialRegistryRepository(first as unknown as TransactionalSqlClient, NOW)
      .appendSnapshot({ commandId: "commercial-registry-restart-001", evidenceSha256: "b".repeat(64), snapshot });
    await first.close();
    const second = await PGlite.create(directory); databases.push(second);
    const recovered = new PostgresCommercialRegistryRepository(second as unknown as TransactionalSqlClient, NOW);
    await expect(recovered.require({ id: snapshot.id, version: snapshot.version, evidenceSha256: "b".repeat(64), publishedOnly: true }))
      .resolves.toMatchObject({ snapshot: { id: snapshot.id, version: 1 } });
    await expect(recovered.require({ id: snapshot.id, version: snapshot.version, evidenceSha256: "c".repeat(64) }))
      .rejects.toMatchObject({ code: "INVALID_REGISTRY_REFERENCE" });
  });

  it("refuses a customer release when its capability lacks a valid control schema", () => {
    const snapshot = createLocalTestRegistrySnapshot();
    const route = snapshot.routes[0]!;
    const capability = snapshot.capabilities.find((candidate) => candidate.id === route.capabilityVersionId)!;
    delete capability.controlSchema;
    expect(() => assertCommercialReleaseBinding({
      snapshot, commercialRouteVersionId: route.id, familyVersionId: route.familyVersionId,
      recipeVersionId: snapshot.recipes[0]!.id, customerPriceVersionId: snapshot.customerPriceVersions[0]!.id,
      providerId: route.providerId, providerAccountId: route.providerAccountId, providerModelId: route.providerModelId,
      adapterVersion: route.adapterVersion,
    })).toThrow(/control schema/i);
  });

  it("refuses a customer release whose non-empty binding contract omits typed slots", () => {
    const snapshot = createLocalTestRegistrySnapshot();
    const route = snapshot.routes.find((candidate) => candidate.providerModelId === "local/test-video-v1")!;
    const capability = snapshot.capabilities.find((candidate) => candidate.id === route.capabilityVersionId)!;
    const recipe = capability.controlSchema!.recipes.find((candidate) => candidate.recipeId === "video.image-to-video")!;
    delete recipe.bindings.slots;
    expect(() => assertCommercialReleaseBinding({
      snapshot, commercialRouteVersionId: route.id, familyVersionId: route.familyVersionId,
      recipeVersionId: snapshot.recipes.find((candidate) => candidate.familyVersionIds.includes(route.familyVersionId))!.id,
      customerPriceVersionId: snapshot.customerPriceVersions[0]!.id,
      providerId: route.providerId, providerAccountId: route.providerAccountId, providerModelId: route.providerModelId,
      adapterVersion: route.adapterVersion,
    })).toThrow(/typed binding slots/i);
  });

  it("refuses a conditional control that references an unknown or later control", () => {
    const snapshot = createLocalTestRegistrySnapshot();
    const route = snapshot.routes.find((candidate) => candidate.providerModelId === "local/test-image-v1")!;
    const capability = snapshot.capabilities.find((candidate) => candidate.id === route.capabilityVersionId)!;
    const recipe = capability.controlSchema!.recipes[0]!;
    recipe.controls.push({
      id: "conditional-quality", kind: "enum", defaultValue: "standard", values: ["standard", "high"],
      visibleWhen: { controlId: "missing-control", operator: "EQUALS", value: true },
    });
    expect(() => assertCommercialReleaseBinding({
      snapshot, commercialRouteVersionId: route.id, familyVersionId: route.familyVersionId,
      recipeVersionId: snapshot.recipes.find((candidate) => candidate.familyVersionIds.includes(route.familyVersionId))!.id,
      customerPriceVersionId: snapshot.customerPriceVersions[0]!.id,
      providerId: route.providerId, providerAccountId: route.providerAccountId, providerModelId: route.providerModelId,
      adapterVersion: route.adapterVersion,
    })).toThrow(/condition must reference an earlier control/i);
  });
});
