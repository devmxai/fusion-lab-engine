import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { signInternalWorkloadRequest } from "../_shared/internal-workload-auth.ts";
import { submissionTransportDisposition } from "../_shared/provider-financial-policy.ts";
import { logSafeEdgeError, logSafeEdgeEvent } from "../_shared/safe-edge-log.ts";
import { legacyPathIsRetired, retiredLegacyPathResponse } from "../_shared/legacy-retirement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    // ── 1. Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonRes({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonRes({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const {
      toolId, toolName, model, apiType, input, resolution, quality,
      durationSeconds, rawDurationSeconds, hasAudio, characterCount, idempotencyKey,
      prompt, fileType, jobMetadata, ttsParams,
    } = body;

    if (!toolId || !model) {
      return jsonRes({ success: false, error: "missing_fields", message: "Missing required fields: toolId, model" });
    }

    if (
      (model === "kling/ai-avatar-standard" || model === "kling/ai-avatar-pro") &&
      typeof rawDurationSeconds === "number" &&
      rawDurationSeconds > 15
    ) {
      return jsonRes({
        success: false,
        error: "validation_failed",
        message: `مدة الصوت ${rawDurationSeconds.toFixed(1)}ث وتتجاوز الحد الأقصى لنموذج Kling Avatar (15ث).`,
      }, 400);
    }

    const generationType = apiType === "tts" ? "audio" : "default";

    // ── 2. Validate entitlement + calculate price + reserve credits ──
    let serverCharCount: number | null = null;
    if (apiType === "tts" && ttsParams?.text) {
      const ttsText = (ttsParams.text || "") as string;
      // Strip English bracket tags [whispers] [laughs] etc., Arabic *star tags* (e.g. *يضحك*),
      // and pure-pause sequences (3+ dots) so they don't inflate billable character count.
      const spokenText = ttsText
        .replace(/\[[^\]]+\]/g, "")              // [any english tag]
        .replace(/\*[^*]+\*/g, "")               // *أي وسم عربي*
        .replace(/\.{3,}/g, "")                  // ... pause markers
        .replace(/\s+/g, " ")
        .trim();
      serverCharCount = spokenText.length;
    }

    const { data: reserveResult, error: reserveError } = await supabase.rpc(
      "validate_and_reserve",
      {
        p_model: model, p_tool_id: toolId, p_resolution: resolution || null,
        p_quality: quality || null, p_duration_seconds: durationSeconds || null,
        p_has_audio: hasAudio ?? null, p_idempotency_key: idempotencyKey || null,
        p_generation_type: generationType, p_character_count: serverCharCount,
      }
    );

    if (reserveError) {
      logSafeEdgeError("generation_reservation_failed", reserveError);
      return jsonRes({ success: false, error: "server_error", message: "Unable to reserve credits." });
    }

    const resData = reserveResult as Record<string, unknown>;
    if (!resData?.success) {
      return jsonRes({
        success: false, error: resData?.error || "validation_failed",
        details: resData?.details || null, balance: resData?.balance, required: resData?.required,
      });
    }

    const reservationId = resData.reservation_id as string;
    const creditsCharged = resData.credits_charged as number;
    const workloadSecret = Deno.env.get("INTERNAL_WORKER_HMAC_KEY");
    if (!workloadSecret) {
      await supabase.rpc("release_credits", { p_reservation_id: reservationId });
      return jsonRes({ success: false, error: "internal_workload_not_configured" }, 500);
    }

    const signedInternalRequest = async (path: string, payload: Record<string, unknown>) => {
      const requestBody = JSON.stringify(payload);
      const timestamp = new Date().toISOString();
      return {
        body: requestBody,
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "x-fusionlab-workload-timestamp": timestamp,
          "x-fusionlab-workload-signature": await signInternalWorkloadRequest({
            method: "POST",
            path,
            timestamp,
            body: requestBody,
            secret: workloadSecret,
          }),
        },
      };
    };

    let providerDispatchAttempted = false;

    const markSubmissionUnknown = async (reason: string) => {
      const { error } = await supabaseAdmin.from("generation_jobs").insert({
        user_id: user.id,
        task_id: null,
        reservation_id: reservationId,
        tool_id: toolId,
        tool_name: toolName || null,
        model,
        api_type: apiType || "standard",
        prompt: prompt || null,
        file_type: fileType || "image",
        status: "submission_unknown",
        progress: 0,
        metadata: { ...(jobMetadata || {}), submission_unknown_reason: reason },
        provider_billing_state: "submission_unknown",
        reconciliation_status: "pending_review",
        reconciliation_notes: "Provider dispatch outcome is unknown. Reservation remains held; automatic retry and release are prohibited.",
      });
      if (error) logSafeEdgeError("generation_submission_unknown_record_failed", error);
    };

    // ── 3. Route to provider ──
    try {
      // ─── TTS Route ───
      if (apiType === "tts" && ttsParams) {
        const ttsText = (ttsParams.text || "") as string;
        const spokenText = ttsText
          .replace(/\[[^\]]+\]/g, "")
          .replace(/\*[^*]+\*/g, "")
          .replace(/\.{3,}/g, "")
          .replace(/\s+/g, " ")
          .trim();
        const charCount = spokenText.length;

        if (charCount > 5000) {
          // Pre-provider failure: safe to refund
          await supabase.rpc("release_credits", { p_reservation_id: reservationId });
          return jsonRes({
            success: false, error: "text_too_long",
            message: `تجاوزت الحد الأقصى (5000 حرف). عدد الأحرف: ${charCount}`,
          });
        }

        // Map our internal model id to the actual Gemini model id.
        // Default = standard (Voice). 'gemini-tts-pro' = latest 3.1 (Voice Pro).
        const geminiModel =
          model === "gemini-tts-pro"
            ? "gemini-3.1-flash-tts-preview"
            : "gemini-2.5-flash-preview-tts";

        const ttsRequest = await signedInternalRequest("/functions/v1/gemini-tts", {
          action: "synthesize",
          prebuiltModel: geminiModel,
          ...ttsParams,
        });
        providerDispatchAttempted = true;
        const ttsResponse = await fetch(`${supabaseUrl}/functions/v1/gemini-tts`, {
          method: "POST", headers: ttsRequest.headers,
          body: ttsRequest.body,
        });

        const ttsData = await ttsResponse.json();

        if (!ttsResponse.ok || ttsData?.error) {
          logSafeEdgeEvent("generation_tts_provider_rejected", { status: ttsResponse.status });
          await markSubmissionUnknown("tts_response_not_confirmed");
          return jsonRes({
            success: false, error: "submission_unknown", reservationId,
            message: "تعذر تأكيد نتيجة مزود الصوت. الرصيد معلّق لحين التحقق ولا تتم إعادة المحاولة تلقائياً.",
          }, 202);
        }

        return jsonRes({
          success: true, reservationId, creditsCharged,
          apiType: "tts", plan: resData.plan,
          audioBase64: ttsData.audioBase64, mimeType: ttsData.mimeType, voiceName: ttsData.voiceName,
          model: ttsData.model,
        });
      }

      // ─── KIE.AI Routes ───
      if (!input) {
        // Pre-provider failure: safe to refund
        await supabase.rpc("release_credits", { p_reservation_id: reservationId });
        return jsonRes({ success: false, error: "missing_fields", message: "Missing input for non-TTS generation" });
      }

      let kieAction: string;
      if (apiType === "veo") kieAction = "veo-create";
      else if (apiType === "flux-kontext") kieAction = "flux-kontext-create";
      else kieAction = "create";

      const kieBody = kieAction === "create"
        ? { action: kieAction, model, input }
        : { action: kieAction, ...input };

      const kieRequest = await signedInternalRequest("/functions/v1/kie-ai", kieBody);
      providerDispatchAttempted = true;
      const kieResponse = await fetch(`${supabaseUrl}/functions/v1/kie-ai`, {
        method: "POST", headers: kieRequest.headers,
        body: kieRequest.body,
      });

      const kieData = await kieResponse.json();

      if (!kieResponse.ok || (kieData?.code !== 200 && !kieData?.data?.taskId)) {
        logSafeEdgeEvent("generation_provider_rejected", { status: kieResponse.status });
        await markSubmissionUnknown("kie_response_not_confirmed");
        return jsonRes({
          success: false, error: "submission_unknown", reservationId,
          message: "تعذر تأكيد قبول أو رفض المزود للطلب. الرصيد معلّق لحين التحقق.",
        }, 202);
      }

      const taskId = kieData?.data?.taskId;
      if (!taskId) {
        await markSubmissionUnknown("kie_task_id_missing_after_dispatch");
        return jsonRes({
          success: false, error: "submission_unknown", reservationId,
          message: "لم يعد المزود بمعرف مهمة قابل للتحقق. الرصيد معلّق لحين المراجعة.",
        }, 202);
      }

      // ══════════════════════════════════════════════════════════════════
      // CRITICAL POINT: taskId exists — upstream task was created.
      // From here on, NO automatic refund is allowed.
      // If job record creation fails, we mark for reconciliation instead.
      // ══════════════════════════════════════════════════════════════════

      const now = new Date().toISOString();

      const { data: jobRecord, error: jobError } = await supabaseAdmin
        .from("generation_jobs")
        .insert({
          user_id: user.id,
          task_id: taskId,
          reservation_id: reservationId,
          tool_id: toolId,
          tool_name: toolName || null,
          model,
          api_type: apiType || "standard",
          prompt: prompt || null,
          file_type: fileType || "image",
          status: "pending",
          progress: 0,
          metadata: jobMetadata || {},
          // Provider billing tracking
          provider_billing_state: "upstream_task_created",
          upstream_task_created_at: now,
          reconciliation_status: "not_required",
        })
        .select("id")
        .single();

      if (jobError) {
        logSafeEdgeError("generation_job_record_failed", jobError);
        // ══════════════════════════════════════════════════════════════
        // DO NOT REFUND HERE. The upstream task exists and may charge us.
        // Instead, create a reconciliation record so admin can review.
        // ══════════════════════════════════════════════════════════════

        // Attempt to create a minimal reconciliation record
        try {
          await supabaseAdmin.from("generation_jobs").insert({
            user_id: user.id,
            task_id: taskId,
            reservation_id: reservationId,
            tool_id: toolId,
            tool_name: toolName || null,
            model,
            api_type: apiType || "standard",
            prompt: prompt || null,
            file_type: fileType || "image",
            status: "failed",
            progress: 0,
            metadata: { ...(jobMetadata || {}), recovery_attempt: true, original_error: jobError.message },
            provider_billing_state: "upstream_task_created",
            upstream_task_created_at: now,
            reconciliation_status: "pending_review",
            reconciliation_notes: `Job record insert failed on first attempt. TaskId: ${taskId}. Reservation: ${reservationId}. Credits NOT refunded — upstream task may have been charged.`,
            error_message: "خطأ في إنشاء سجل المتابعة. يرجى مراجعة الإدارة.",
          });
        } catch (recoveryErr) {
          logSafeEdgeError("generation_job_recovery_record_failed", recoveryErr);
          // Last resort: at least the reservation exists in credit_reservations
          // Admin can reconcile via reservation_id + task_id in logs
        }

        return jsonRes({
          success: false,
          error: "job_record_failed",
          message: "حدث خطأ في إنشاء سجل المتابعة. تم تسجيل المشكلة وسيتم مراجعتها من الإدارة. الرصيد لن يُسترد تلقائياً لحين التأكد من حالة المزود.",
          taskId, // Return taskId so client can potentially track
          reservationId,
        }, 500);
      }

      logSafeEdgeEvent("generation_started", {
        api_type: apiType || "standard",
        billing_state: "upstream_task_created",
        has_job_record: Boolean(jobRecord?.id),
      });

      return jsonRes({
        success: true, taskId, reservationId, creditsCharged,
        apiType: apiType || "standard", plan: resData.plan,
        jobId: jobRecord?.id || null,
      });

    } catch (providerErr) {
      if (submissionTransportDisposition(providerDispatchAttempted) === "HOLD_FOR_RECONCILIATION") {
        logSafeEdgeError("generation_submission_unknown", providerErr);
        await markSubmissionUnknown("provider_transport_or_response_failure");
        return jsonRes({
          success: false,
          error: "submission_unknown",
          reservationId,
          message: "تعذر تأكيد حالة الإرسال إلى المزود. الرصيد معلّق لحين التحقق ولا تتم إعادة المحاولة أو الاسترداد تلقائياً.",
        }, 202);
      }

      try {
        await supabase.rpc("release_credits", { p_reservation_id: reservationId });
      } catch (releaseErr) {
        logSafeEdgeError("generation_pre_dispatch_release_failed", releaseErr);
      }
      throw providerErr;
    }
  } catch (err) {
    logSafeEdgeError("generation_start_failed", err);
    return jsonRes({
      success: false,
      error: "internal_error",
    });
  }
});
