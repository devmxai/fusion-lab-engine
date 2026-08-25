import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyInternalWorkloadRequest } from "../_shared/internal-workload-auth.ts";
import { logSafeEdgeError, logSafeEdgeEvent } from "../_shared/safe-edge-log.ts";
import { resolveSystemJobPlan } from "../_shared/system-job-policy.ts";
import { legacyPathIsRetired, retiredLegacyPathResponse } from "../_shared/legacy-retirement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (legacyPathIsRetired()) return retiredLegacyPathResponse(corsHeaders);

  const jsonRes = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const rawBody = await req.text();
    const internalAuthorized = await verifyInternalWorkloadRequest({
      method: req.method,
      path: new URL(req.url).pathname,
      timestamp: req.headers.get("x-fusionlab-workload-timestamp"),
      signature: req.headers.get("x-fusionlab-workload-signature"),
      body: rawBody,
      secret: Deno.env.get("INTERNAL_WORKER_HMAC_KEY"),
    });
    if (!internalAuthorized) {
      logSafeEdgeEvent("system_jobs_unsigned_workload_blocked");
      return jsonRes({ error: "internal_workload_required" }, 403);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // The role is retained inside the function only; it is never used as a
    // caller credential. A workload signature is required above.
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let body: { job?: string };
    try {
      body = JSON.parse(rawBody) as { job?: string };
    } catch {
      return jsonRes({ error: "invalid_json" }, 400);
    }
    const plan = resolveSystemJobPlan(body.job);
    if (!plan) {
      return jsonRes({ error: "unsupported_job" }, 400);
    }

    const results: Record<string, unknown> = { job: plan.job, timestamp: new Date().toISOString() };

    // Legacy financial mutations are intentionally fail-closed until the
    // ledger-aware replacement and database grants have approved evidence.
    if (plan.holdSubscriptionExpiry) {
      results.subscription_expiry = { action: "held", reason: "ledger_aware_replacement_required" };
    }

    if (plan.holdStaleReservations) {
      results.stale_reservations = { action: "held", reason: "provider_evidence_required" };
    }

    if (plan.runReconciliation) {
      const { data, error } = await supabase.rpc("reconciliation_check");
      results.reconciliation = error ? { status: "failed" } : data;
    }

    logSafeEdgeEvent("system_jobs_completed", { job: plan.job });
    return jsonRes({ success: true, results });
  } catch (err) {
    logSafeEdgeError("system_jobs_failed", err);
    return jsonRes({
      success: false,
      error: "internal_error",
    });
  }
});
