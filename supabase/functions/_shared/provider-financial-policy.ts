/**
 * Provider financial policy shared by server-owned Edge workers.
 *
 * These helpers intentionally fail closed: a transport failure or a provider
 * error string is never evidence that an upstream provider did not charge us.
 */

export type SubmissionTransportDisposition = "RELEASE_ALLOWED" | "HOLD_FOR_RECONCILIATION";

export function submissionTransportDisposition(
  providerDispatchAttempted: boolean,
): SubmissionTransportDisposition {
  return providerDispatchAttempted ? "HOLD_FOR_RECONCILIATION" : "RELEASE_ALLOWED";
}

export type TerminalNoChargeEvidence = {
  operationTaskId?: string | null;
  evidenceTaskId?: string | null;
  terminalState?: string | null;
  actualUsage?: string | number | null;
  evidenceHash?: string | null;
};

function representsZero(value: string | number): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value === 0;
  return /^[-+]?0+(?:\.0+)?$/.test(value.trim());
}

/**
 * A customer reservation can be released for a terminal provider failure only
 * when the worker supplies task-bound, terminal, hashed evidence that actual
 * provider usage is exactly zero. Generic status/error strings are rejected.
 */
export function hasConfirmedTerminalNoChargeEvidence(
  evidence: TerminalNoChargeEvidence,
): boolean {
  const terminal = evidence.terminalState?.toLowerCase();
  if (terminal !== "failed" && terminal !== "refunded") return false;
  if (!evidence.operationTaskId || evidence.operationTaskId !== evidence.evidenceTaskId) return false;
  if (!evidence.evidenceHash || !/^[a-f0-9]{64}$/i.test(evidence.evidenceHash)) return false;
  if (evidence.actualUsage === null || evidence.actualUsage === undefined) return false;
  return representsZero(evidence.actualUsage);
}

export function canSettleDeliveredLegacyResult(input: {
  hasDurableGenerationRecord: boolean;
  hasDeliveryReference: boolean;
}): boolean {
  return input.hasDurableGenerationRecord && input.hasDeliveryReference;
}
