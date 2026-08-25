import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyInternalWorkloadRequest } from "../_shared/internal-workload-auth.ts";
import {
  canSettleDeliveredLegacyResult,
  hasConfirmedTerminalNoChargeEvidence,
} from "../_shared/provider-financial-policy.ts";
import { logSafeEdgeError, logSafeEdgeEvent } from "../_shared/safe-edge-log.ts";
import { legacyPathIsRetired, retiredLegacyPathResponse } from "../_shared/legacy-retirement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type CompletionPayload = {
  reservationId?: string;
  status?: string;
  taskId?: string;
  toolId?: string;
  toolName?: string;
  prompt?: string;
  fileUrl?: string;
  fileType?: string;
  metadata?: Record<string, unknown> | null;
  providerStatusCode?: string;
  providerStatusMessage?: string;
  providerTerminalState?: "failed" | "refunded";
  providerEvidenceTaskId?: string;
  providerCreditsConsumed?: string | number | null;
  providerEvidenceHash?: string;
  errorMessage?: string;
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
      return jsonRes({ success: false, error: "internal_workload_required" }, 403);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    let body: CompletionPayload;
    try {
      body = JSON.parse(rawBody) as CompletionPayload;
    } catch {
      return jsonRes({ success: false, error: "invalid_json" }, 400);
    }
    const {
      reservationId, status, taskId, toolId, toolName,
      prompt, fileUrl, fileType, metadata,
      providerStatusCode, providerStatusMessage, providerTerminalState,
      providerEvidenceTaskId, providerCreditsConsumed, providerEvidenceHash,
    } = body;

    if (!reservationId || !status) {
      return jsonRes({ success: false, error: "Missing required fields: reservationId, status" }, 400);
    }

    // The terminal worker never trusts an actor identifier in its payload. It
    // derives the generation owner from the reservation recorded at reserve time.
    const { data: reservation, error: reservationError } = await supabaseAdmin
      .from("credit_reservations")
      .select("user_id, status")
      .eq("id", reservationId)
      .maybeSingle();
    if (reservationError) {
      logSafeEdgeError("completion_reservation_lookup_failed", reservationError);
      return jsonRes({ success: false, error: "reservation_lookup_failed" }, 500);
    }
    if (!reservation?.user_id) {
      return jsonRes({ success: false, error: "reservation_not_found" }, 404);
    }
    const userId = reservation.user_id;

    const now = new Date().toISOString();

    if (status === "success") {
      // ── Idempotency check ──
      const { data: existingGen } = await supabaseAdmin
        .from("generations")
        .select("id, file_url")
        .eq("reservation_id", reservationId)
        .maybeSingle();

      if (existingGen && reservation.status === "settled") {
        logSafeEdgeEvent("completion_idempotent_hit");
        return jsonRes({ success: true, action: "settled", idempotent: true });
      }

      if (!existingGen) {
        if (!fileUrl || !toolId) {
          return jsonRes({ success: false, error: "delivery_evidence_required" }, 422);
        }

        // The current legacy path has no private-ingest transaction yet. Its
        // minimum safe invariant is a durable delivery record before any debit.
        const { error: insertError } = await supabaseAdmin
          .from("generations")
          .insert({
            user_id: userId,
            tool_id: toolId,
            tool_name: toolName || null,
            prompt: prompt || null,
            file_url: fileUrl,
            file_type: fileType || "image",
            reservation_id: reservationId,
            metadata: metadata || null,
          });
        if (insertError) {
          logSafeEdgeError("completion_generation_record_insert_failed", insertError);
          return jsonRes({ success: false, error: "durable_delivery_record_failed" }, 500);
        }
      }

      if (!canSettleDeliveredLegacyResult({
        hasDurableGenerationRecord: true,
        hasDeliveryReference: Boolean(fileUrl || existingGen?.file_url),
      })) {
        return jsonRes({ success: false, error: "delivery_evidence_required" }, 422);
      }

      // ── Record deliverable evidence before final customer debit ──
      const { error: jobUpdateError } = await supabaseAdmin
        .from("generation_jobs")
        .update({
          status: "succeeded",
          progress: 100,
          result_url: fileUrl || null,
          completed_at: now,
          updated_at: now,
          provider_billing_state: "upstream_success_confirmed",
          upstream_terminal_at: now,
          provider_status_code: providerStatusCode || "success",
          provider_status_message: providerStatusMessage || null,
        })
        .eq("reservation_id", reservationId);
      if (jobUpdateError) {
        logSafeEdgeError("completion_job_delivery_update_failed", jobUpdateError);
        return jsonRes({ success: false, error: "delivery_operation_record_failed" }, 500);
      }

      // ── Settle only after durable delivery evidence ──
      const { data: settleData, error: settleError } = await supabaseAdmin.rpc("settle_credits", {
        p_reservation_id: reservationId,
        p_task_id: taskId || null,
      });

      if (settleError) {
        logSafeEdgeError("completion_settle_transport_failed", settleError);
        return jsonRes({ success: false, error: "settle_failed" }, 500);
      }

      if (!settleData?.success) {
        const bizError = settleData?.error || "unknown_settle_error";
        logSafeEdgeEvent("completion_settle_business_failed", { reason: bizError });
        if (bizError !== "already_processed") {
          return jsonRes({ success: false, error: bizError, details: settleData }, 422);
        }
        const { data: finalReservation, error: finalReservationError } = await supabaseAdmin
          .from("credit_reservations")
          .select("status")
          .eq("id", reservationId)
          .maybeSingle();
        if (finalReservationError || finalReservation?.status !== "settled") {
          return jsonRes({ success: false, error: "settlement_state_conflict" }, 409);
        }
      }

      logSafeEdgeEvent("completion_settled", { billing_state: "upstream_success_confirmed" });
      return jsonRes({ success: true, action: "settled" });

    } else if (status === "failed") {
      const errorMessage = body.errorMessage || "Generation failed";

      // A failure string/code is never billing evidence. Release requires a
      // terminal, task-bound provider record proving actual usage is zero.
      const isRefundConfirmed = hasConfirmedTerminalNoChargeEvidence({
        operationTaskId: taskId,
        evidenceTaskId: providerEvidenceTaskId,
        terminalState: providerTerminalState,
        actualUsage: providerCreditsConsumed,
        evidenceHash: providerEvidenceHash,
      });

      if (isRefundConfirmed) {
        // ── CONFIRMED REFUND: Safe to release credits ──
        const { data: releaseData, error: releaseError } = await supabaseAdmin.rpc("release_credits", {
          p_reservation_id: reservationId,
        });

        if (releaseError) {
          logSafeEdgeError("completion_release_transport_failed", releaseError);
          return jsonRes({ success: false, error: "release_failed" }, 500);
        }

        if (!releaseData?.success) {
          const bizError = releaseData?.error || "unknown_release_error";
          if (bizError !== "already_processed") {
            return jsonRes({ success: false, error: bizError, details: releaseData }, 422);
          }
        }

        // Update job record with confirmed refund state
        await supabaseAdmin
          .from("generation_jobs")
          .update({
            status: "failed",
            error_message: errorMessage,
            completed_at: now,
            updated_at: now,
            provider_billing_state: "upstream_failed_refunded_confirmed",
            provider_refund_confirmed_at: now,
            upstream_terminal_at: now,
            provider_status_code: providerStatusCode || null,
            provider_status_message: providerStatusMessage || null,
            reconciliation_status: "not_required",
          })
          .eq("reservation_id", reservationId);

        logSafeEdgeEvent("completion_released", { refund_confirmed: true });
        return jsonRes({ success: true, action: "released", refundConfirmed: true });

      } else {
        // ── UNCONFIRMED REFUND: Do NOT release credits automatically ──
        // Mark for admin reconciliation
        await supabaseAdmin
          .from("generation_jobs")
          .update({
            status: "failed",
            error_message: errorMessage,
            completed_at: now,
            updated_at: now,
            provider_billing_state: "upstream_failed_refund_unknown",
            upstream_terminal_at: now,
            provider_status_code: providerStatusCode || null,
            provider_status_message: providerStatusMessage || null,
            reconciliation_status: "pending_review",
            reconciliation_notes: `فشل التوليد بدون تأكيد استرداد من المزود. الكود: ${providerStatusCode || "N/A"}. الرسالة: ${errorMessage}. يحتاج مراجعة يدوية.`,
          })
          .eq("reservation_id", reservationId);

        logSafeEdgeEvent("completion_held_for_reconciliation", { refund_confirmed: false });
        return jsonRes({
          success: true,
          action: "held_for_reconciliation",
          refundConfirmed: false,
          message: "فشل التوليد. الرصيد معلّق لحين مراجعة حالة المزود.",
        });
      }
    }

    return jsonRes({ success: false, error: "Invalid status. Use: success, failed" }, 400);
  } catch (err) {
    logSafeEdgeError("completion_request_failed", err);
    return jsonRes({
      success: false,
      error: "internal_error",
    }, 500);
  }
});
