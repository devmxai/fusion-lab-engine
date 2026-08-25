import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Cryptographically secure 6-digit OTP
function generateOTP(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const num = (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) >>> 0;
  return String(100000 + (num % 900000));
}

// Constant-time string compare to avoid timing attacks
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function sendWhatsAppMessage(phone: string, message: string): Promise<boolean> {
  const wasenderKey = Deno.env.get("WASENDER_API_KEY");
  if (!wasenderKey) {
    console.error("WASENDER_API_KEY not configured");
    return false;
  }

  const whatsappPhone = phone.startsWith("964") ? phone : "964" + phone;

  const res = await fetch("https://api.wasenderapi.com/api/send-message", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${wasenderKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      to: whatsappPhone,
      type: "text",
      text: message,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("WASender error:", errText);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    const { action, phone_number, otp_code, subscription_data } = await req.json();

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Helper to compute OTP hash via DB function (uses server-side pepper)
    const computeHash = async (otp: string, phone: string): Promise<string> => {
      const { data, error } = await adminClient.rpc("hash_otp", {
        p_otp: otp,
        p_user_id: userId,
        p_phone: phone,
      });
      if (error) throw new Error("hash_failed");
      return data as string;
    };

    // ── Send OTP ──
    if (action === "send_otp") {
      if (!phone_number || !/^7\d{9}$/.test(phone_number)) {
        return new Response(
          JSON.stringify({ error: "invalid_phone", message: "رقم الهاتف غير صالح" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check user-level lockout (last verification record)
      const { data: lastVerif } = await adminClient
        .from("phone_verifications")
        .select("locked_until")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastVerif?.locked_until && new Date(lastVerif.locked_until) > new Date()) {
        return new Response(
          JSON.stringify({ error: "locked_out", message: "الحساب مقفل مؤقتاً. حاول لاحقاً." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { count } = await adminClient
        .from("phone_verifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", new Date(Date.now() - 3600000).toISOString());

      if ((count || 0) >= 3) {
        return new Response(
          JSON.stringify({ error: "rate_limit", message: "تم تجاوز الحد الأقصى. حاول بعد ساعة." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: existingPhone } = await adminClient
        .from("profiles")
        .select("id")
        .eq("phone_number", phone_number)
        .eq("phone_verified", true)
        .neq("id", userId)
        .maybeSingle();

      if (existingPhone) {
        // Avoid enumeration: same generic error
        return new Response(
          JSON.stringify({ error: "phone_unavailable", message: "تعذر استخدام هذا الرقم" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const otp = generateOTP();
      const otpHash = await computeHash(otp, phone_number);

      // Invalidate previous unverified codes for this user+phone
      await adminClient
        .from("phone_verifications")
        .update({ verified: true, attempts: 99 })
        .eq("user_id", userId)
        .eq("phone_number", phone_number)
        .eq("verified", false);

      await adminClient.from("phone_verifications").insert({
        user_id: userId,
        phone_number,
        otp_code: "REDACTED", // legacy column kept non-null; never used for verification
        otp_hash: otpHash,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      const messageBody = `🔐 رمز التحقق الخاص بك في FusionLab:\n\n*${otp}*\n\nصالح لمدة 5 دقائق. لا تشاركه مع أحد.`;

      const sent = await sendWhatsAppMessage(phone_number, messageBody);
      if (!sent) {
        return new Response(
          JSON.stringify({ error: "send_failed", message: "تعذر إرسال رمز التحقق. تحقق من الرقم وحاول مجدداً." }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "تم إرسال رمز التحقق" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Verify OTP ──
    if (action === "verify_otp") {
      if (!otp_code || !phone_number || !/^\d{4,8}$/.test(String(otp_code))) {
        return new Response(
          JSON.stringify({ error: "invalid_input", message: "بيانات غير صالحة" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: verification } = await adminClient
        .from("phone_verifications")
        .select("*")
        .eq("user_id", userId)
        .eq("phone_number", phone_number)
        .eq("verified", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!verification) {
        return new Response(
          JSON.stringify({ error: "no_otp", message: "لم يتم العثور على رمز تحقق صالح" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (new Date(verification.expires_at) < new Date()) {
        return new Response(
          JSON.stringify({ error: "expired", message: "انتهت صلاحية الرمز. أعد الإرسال." }),
          { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if ((verification.attempts ?? 0) >= 5) {
        // Lock the user for 30 minutes
        await adminClient
          .from("phone_verifications")
          .update({ locked_until: new Date(Date.now() + 30 * 60 * 1000).toISOString() })
          .eq("id", verification.id);
        return new Response(
          JSON.stringify({ error: "max_attempts", message: "تم تجاوز عدد المحاولات. حاول لاحقاً." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await adminClient
        .from("phone_verifications")
        .update({ attempts: (verification.attempts ?? 0) + 1 })
        .eq("id", verification.id);

      // Verify against hash (with safe fallback to legacy plaintext for old records)
      const submittedHash = await computeHash(String(otp_code), phone_number);
      const storedHash = verification.otp_hash as string | null;
      const legacyPlain = verification.otp_code as string;

      let isValid = false;
      if (storedHash) {
        isValid = constantTimeEqual(submittedHash, storedHash);
      } else if (legacyPlain && legacyPlain !== "REDACTED") {
        // legacy fallback (will phase out)
        isValid = constantTimeEqual(String(otp_code), legacyPlain);
      }

      if (!isValid) {
        return new Response(
          JSON.stringify({ error: "wrong_code", message: "الرمز غير صحيح" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await adminClient
        .from("phone_verifications")
        .update({ verified: true })
        .eq("id", verification.id);

      await adminClient
        .from("profiles")
        .update({ phone_number, phone_verified: true })
        .eq("id", userId);

      return new Response(
        JSON.stringify({ success: true, message: "تم التحقق بنجاح" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Send Subscription Confirmation WhatsApp ──
    if (action === "send_subscription_confirmation") {
      const { data: adminRole } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .in("role", ["admin", "super_admin"])
        .maybeSingle();

      if (!adminRole) {
        return new Response(
          JSON.stringify({ error: "unauthorized", message: "غير مصرح" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!subscription_data?.phone_number || !subscription_data?.plan_name || !subscription_data?.credits) {
        return new Response(
          JSON.stringify({ error: "missing_data", message: "بيانات ناقصة" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { phone_number: targetPhone, plan_name, credits, starts_at, expires_at } = subscription_data;

      const formatDate = (d: string) => {
        try {
          return new Date(d).toLocaleDateString("ar-IQ", { year: "numeric", month: "long", day: "numeric" });
        } catch {
          return d;
        }
      };

      const message = `✅ *تم تفعيل اشتراكك في FusionLab!*\n\n` +
        `📋 *الخطة:* ${plan_name}\n` +
        `💰 *الرصيد:* ${credits} كريدت\n` +
        `📅 *من:* ${formatDate(starts_at)}\n` +
        `📅 *إلى:* ${formatDate(expires_at)}\n\n` +
        `شكراً لاشتراكك! يمكنك البدء بالاستخدام الآن.\n` +
        `🔗 fusionlab.pro`;

      const sent = await sendWhatsAppMessage(targetPhone, message);
      if (!sent) {
        return new Response(
          JSON.stringify({ error: "send_failed", message: "فشل إرسال رسالة التأكيد" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "تم إرسال تأكيد الاشتراك" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "invalid_action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("OTP Error:", err);
    return new Response(
      JSON.stringify({ error: "internal_error", message: "حدث خطأ داخلي" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
