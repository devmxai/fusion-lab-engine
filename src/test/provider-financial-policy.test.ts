import { describe, expect, it } from "vitest";
import {
  canSettleDeliveredLegacyResult,
  hasConfirmedTerminalNoChargeEvidence,
  submissionTransportDisposition,
} from "../../supabase/functions/_shared/provider-financial-policy.ts";

describe("provider financial fail-closed policy", () => {
  it("holds a reservation when a provider dispatch may have left the process", () => {
    expect(submissionTransportDisposition(true)).toBe("HOLD_FOR_RECONCILIATION");
    expect(submissionTransportDisposition(false)).toBe("RELEASE_ALLOWED");
  });

  it("rejects error strings and accepts only task-bound terminal zero-usage evidence", () => {
    expect(hasConfirmedTerminalNoChargeEvidence({
      operationTaskId: "task-1",
      evidenceTaskId: "task-1",
      terminalState: "failed",
      actualUsage: "0.000",
      evidenceHash: "a".repeat(64),
    })).toBe(true);

    for (const evidence of [
      { terminalState: "failed", actualUsage: "0", evidenceHash: "a".repeat(64) },
      { operationTaskId: "task-1", evidenceTaskId: "task-2", terminalState: "failed", actualUsage: "0", evidenceHash: "a".repeat(64) },
      { operationTaskId: "task-1", evidenceTaskId: "task-1", terminalState: "running", actualUsage: "0", evidenceHash: "a".repeat(64) },
      { operationTaskId: "task-1", evidenceTaskId: "task-1", terminalState: "failed", actualUsage: "0.01", evidenceHash: "a".repeat(64) },
      { operationTaskId: "task-1", evidenceTaskId: "task-1", terminalState: "failed", actualUsage: "0", evidenceHash: "not-a-hash" },
    ]) {
      expect(hasConfirmedTerminalNoChargeEvidence(evidence)).toBe(false);
    }
  });

  it("requires a durable delivery record before final settlement", () => {
    expect(canSettleDeliveredLegacyResult({ hasDurableGenerationRecord: true, hasDeliveryReference: true })).toBe(true);
    expect(canSettleDeliveredLegacyResult({ hasDurableGenerationRecord: false, hasDeliveryReference: true })).toBe(false);
    expect(canSettleDeliveredLegacyResult({ hasDurableGenerationRecord: true, hasDeliveryReference: false })).toBe(false);
  });
});
