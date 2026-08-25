import { engineAuthorizationHeaders } from "@/features/creative-space/engine-session";

const API_BASE = "/api/engine/v2";

export type CustomerAccount = {
  ownerId: string;
  wallet: null | { availableCredits: number; heldCredits: number; spentCredits: number; updatedAt: string };
  subscription: null | { id: string; state: string; planVersionId: string; planKey: string; displayName: string; interval: "MONTH" | "YEAR"; creditsPerPeriod: number; currentPeriodStart: string; currentPeriodEnd: string };
};

async function customerRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { ...await engineAuthorizationHeaders(), ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message || payload?.error?.code || "The subscription request failed.");
  return payload as T;
}

export const getCustomerAccount = () => customerRequest<CustomerAccount>("/account");

function activationCommandId() {
  if (!globalThis.crypto?.randomUUID) throw new Error("This browser cannot create a secure activation command.");
  return globalThis.crypto.randomUUID();
}

export const redeemActivationKey = (activationKey: string) => customerRequest<{
  subscriptionId: string; planVersionId: string; planKey: string; displayName: string; interval: "MONTH" | "YEAR";
  state: "ACTIVE"; currentPeriodStart: string; currentPeriodEnd: string; creditsGranted: number;
  wallet: { availableCredits: number; heldCredits: number; spentCredits: number }; replayed: boolean;
}>("/subscriptions/activate", {
  method: "POST",
  headers: { "idempotency-key": activationCommandId() },
  body: JSON.stringify({ activationKey: activationKey.trim() }),
});
