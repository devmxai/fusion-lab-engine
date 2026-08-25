import { describe, expect, it } from "vitest";
import { resolveSystemJobPlan } from "../../supabase/functions/_shared/system-job-policy.ts";

describe("system job financial safety policy", () => {
  it("holds every legacy financial mutation for the all schedule", () => {
    expect(resolveSystemJobPlan("all")).toEqual({
      job: "all",
      holdSubscriptionExpiry: true,
      holdStaleReservations: true,
      runReconciliation: true,
    });
  });

  it("allows reconciliation without a financial mutation", () => {
    expect(resolveSystemJobPlan("reconciliation")).toEqual({
      job: "reconciliation",
      holdSubscriptionExpiry: false,
      holdStaleReservations: false,
      runReconciliation: true,
    });
  });

  it("rejects unknown scheduling commands", () => {
    expect(resolveSystemJobPlan("release-all-credits")).toBeNull();
    expect(resolveSystemJobPlan(undefined)).toBeNull();
  });
});
