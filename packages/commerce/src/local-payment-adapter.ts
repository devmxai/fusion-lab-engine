import { createHash } from "node:crypto";
import type { CreateProviderCheckoutInput, PaymentAdapter, ProviderCheckoutSession } from "./types.ts";

export class LocalPaymentSandboxAdapter implements PaymentAdapter {
  readonly id = "payment-sandbox-for-test";

  async createCheckout(input: CreateProviderCheckoutInput): Promise<ProviderCheckoutSession> {
    const providerSessionId = `paytest_${createHash("sha256")
      .update(`${input.checkoutId}:${input.idempotencyKey}`)
      .digest("hex")
      .slice(0, 24)}`;
    return {
      provider: this.id,
      providerSessionId,
      checkoutUrl: `/v1/dev/commerce/sandbox/checkouts/${input.checkoutId}`,
    };
  }
}
