export type LocalLegacyRuntimeState = "ACTIVE" | "READ_ONLY" | "GRANTS_REVOKED" | "CODE_RETIRED";

export type LocalLegacyWriteDecision = Readonly<{
  state: LocalLegacyRuntimeState;
  allowed: boolean;
  reason: "ACTIVE" | "WRITE_DISABLED" | "GRANTS_REVOKED" | "CODE_RETIRED";
}>;

let runtimeState: LocalLegacyRuntimeState = "ACTIVE";

/**
 * Local-only switch used to exercise V1 retirement behavior without calling
 * Supabase or a paid provider. It is deliberately not used outside DEV mode.
 */
export function setLocalLegacyRuntimeStateForTest(state: LocalLegacyRuntimeState): void {
  runtimeState = state;
}

export function resetLocalLegacyRuntimeStateForTest(): void {
  runtimeState = "ACTIVE";
}

export function decideLocalLegacyGenerationWrite(): LocalLegacyWriteDecision {
  if (runtimeState === "ACTIVE") return { state: runtimeState, allowed: true, reason: "ACTIVE" };
  if (runtimeState === "READ_ONLY") return { state: runtimeState, allowed: false, reason: "WRITE_DISABLED" };
  if (runtimeState === "GRANTS_REVOKED") return { state: runtimeState, allowed: false, reason: "GRANTS_REVOKED" };
  return { state: runtimeState, allowed: false, reason: "CODE_RETIRED" };
}

export function assertLocalLegacyGenerationWriteAllowed(): void {
  const decision = decideLocalLegacyGenerationWrite();
  if (!decision.allowed) {
    throw new Error(`Local legacy generation write blocked: ${decision.reason}`);
  }
}
