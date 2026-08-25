import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyInternalWorkloadRequest } from "../_shared/internal-workload-auth.ts";
import { logSafeEdgeError, logSafeEdgeEvent } from "../_shared/safe-edge-log.ts";
import { legacyPathIsRetired, retiredLegacyPathResponse } from "../_shared/legacy-retirement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";
const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash-preview-tts", // Fusion Voice (standard)
  "gemini-3.1-flash-tts-preview",  // Fusion Voice Pro (latest, supports audio tags)
]);
const OFFICIAL_GEMINI_FLASH_TTS_VOICES = new Set([
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede",
  "Autonoe", "Callirrhoe", "Charon", "Despina", "Enceladus",
  "Erinome", "Fenrir", "Gacrux", "Iapetus", "Kore",
  "Laomedeia", "Leda", "Orus", "Puck", "Pulcherrima",
  "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar",
  "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi",
]);

// Billable actions require internal caller validation
const BILLABLE_ACTIONS = new Set(["synthesize"]);

function pcmToWav(rawB64: string, rawMime: string): { audioBase64: string; mimeType: string } {
  const rateMatch = rawMime.match(/rate=(\d+)/);
  const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;
  const channels = 1;
  const bitsPerSample = 16;

  const binaryStr = atob(rawB64);
  const pcmBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    pcmBytes[i] = binaryStr.charCodeAt(i);
  }

  const dataSize = pcmBytes.length;
  const headerSize = 44;
  const wavBuffer = new Uint8Array(headerSize + dataSize);
  const view = new DataView(wavBuffer.buffer);

  wavBuffer.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, 36 + dataSize, true);
  wavBuffer.set([0x57, 0x41, 0x56, 0x45], 8);
  wavBuffer.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  wavBuffer.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, dataSize, true);
  wavBuffer.set(pcmBytes, 44);

  let wavB64 = "";
  const chunkSize = 8192;
  for (let i = 0; i < wavBuffer.length; i += chunkSize) {
    wavB64 += String.fromCharCode(...wavBuffer.subarray(i, i + chunkSize));
  }
  wavB64 = btoa(wavB64);

  return { audioBase64: wavB64, mimeType: "audio/wav" };
}

function resolveModel(body: Record<string, unknown>): { model: string; error: string | null } {
  const requested =
    typeof body.prebuiltModel === "string"
      ? body.prebuiltModel
      : typeof body.model === "string"
      ? body.model
      : null;

  if (!requested) {
    return { model: DEFAULT_MODEL, error: null };
  }

  if (!ALLOWED_MODELS.has(requested)) {
    return { model: DEFAULT_MODEL, error: `Model '${requested}' is not allowed. Allowed: ${Array.from(ALLOWED_MODELS).join(", ")}` };
  }

  return { model: requested, error: null };
}

function validateOfficialVoice(voiceName: string): string | null {
  if (!OFFICIAL_GEMINI_FLASH_TTS_VOICES.has(voiceName)) {
    return `Unsupported voice '${voiceName}'`;
  }
  return null;
}

// The Gemini TTS API uses natural language prompting, NOT bracket tags.
// Stage directions like *يضحك* and pauses via "..." are embedded inline
// in the transcript and interpreted naturally by the model.

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Build a Gemini TTS prompt that follows the OFFICIAL prompting guide
 * (https://ai.google.dev/gemini-api/docs/speech-generation#prompting-guide).
 *
 * Critical principles:
 *  - Gemini TTS has NO API params for speakingRate/pitch/stability — they MUST
 *    be expressed in natural language in the SAME line as the "Say:" prefix
 *    so the model treats them as direct delivery instructions.
 *  - Do NOT prepend persona text that overrides the chosen voice's natural
 *    timbre (e.g. always saying "متحدث عربي أصلي" makes every voice sound the
 *    same, masking Puck/Charon/Enceladus/etc. character differences).
 *  - The user's style hint must be the PRIMARY directive, placed immediately
 *    before the transcript using Google's recommended "Say <directives>:" form.
 *  - Audio tags ([whispers], [laughs], …) are inline modifiers — never wrap
 *    them in extra Arabic explanation that the model might read aloud.
 */
function buildTTSPrompt(opts: {
  spokenText: string;
  isProModel: boolean;
  styleInstruction?: string;
  dialectHint?: string;
  emotionHint?: string;
  toneHint?: string;
  speakingRate?: number;
  stability?: number;
}): string {
  const {
    spokenText,
    isProModel,
    styleInstruction = "",
    dialectHint = "",
    emotionHint = "",
    toneHint = "",
    speakingRate = 1.0,
    stability = 0.7,
  } = opts;

  // Build a single, concise English directive line. Google's docs explicitly
  // recommend English audio-tag / direction wording for non-English transcripts
  // ("If your transcript is not in English, for best results we recommend that
  // you still use English audio tags").
  const directives: string[] = [];

  if (dialectHint && dialectHint.trim()) {
    directives.push(`in an authentic ${dialectHint.trim()} delivery`);
  }

  if (styleInstruction && styleInstruction.trim()) {
    // User's free-form style is the strongest signal — pass it through verbatim
    // so the model honors specific cues like "صوت إعلاني حماسي" or "نبرة ساخرة".
    directives.push(`with this performance direction: ${styleInstruction.trim()}`);
  }

  if (toneHint && toneHint.trim()) {
    directives.push(`tone: ${toneHint.trim()}`);
  }

  if (emotionHint && emotionHint.trim()) {
    directives.push(`emotion: ${emotionHint.trim()}`);
  }

  // Map slider values to NATURAL-LANGUAGE pace words.
  // The thresholds are tighter than before so any slider movement away from 1.0
  // is reflected audibly (the previous >1.3 / <0.8 thresholds rarely triggered).
  if (speakingRate >= 1.6) directives.push("at a very fast pace");
  else if (speakingRate >= 1.25) directives.push("at a noticeably faster pace");
  else if (speakingRate >= 1.1) directives.push("slightly faster than normal");
  else if (speakingRate <= 0.6) directives.push("at a very slow, deliberate pace");
  else if (speakingRate <= 0.8) directives.push("at a noticeably slower pace");
  else if (speakingRate <= 0.9) directives.push("slightly slower than normal");

  // Stability → expressiveness (low stability = more dynamic range/variation).
  if (stability <= 0.3) directives.push("with very expressive, dynamic emotional variation");
  else if (stability <= 0.5) directives.push("with expressive variation");
  else if (stability >= 0.9) directives.push("with a steady, consistent tone throughout");
  else if (stability >= 0.75) directives.push("with a stable tone");

  // Compose the final "Say …:" line per Google's official examples.
  // Example from docs: `Say in an spooky voice: "By the pricking of my thumbs..."`
  const directiveLine = directives.length > 0
    ? `Say ${directives.join(", ")}:`
    : "Say:";

  // Brief inline-tags reminder ONLY when relevant (kept short so the model
  // doesn't echo it). Pro model uses English bracket tags; Standard uses
  // Arabic *...* stage directions.
  const hasBracketTags = /\[[^\]]+\]/.test(spokenText);
  const hasStarTags = /\*[^*]+\*/.test(spokenText);
  const hasPauses = /\.{3,}/.test(spokenText);

  const reminders: string[] = [];
  if (isProModel && hasBracketTags) {
    reminders.push("Bracketed tags like [whispers] [laughs] [shouting] are performance modifiers — perform them, do not speak the bracket text.");
  }
  if (hasStarTags) {
    reminders.push("Words between asterisks like *يضحك* are stage directions — perform the action (real laugh, whisper, sigh, etc.), do not read the asterisk text.");
  }
  if (hasPauses) {
    reminders.push("Sequences of dots ( ... ) indicate silent pauses.");
  }

  // Final prompt structure:
  //   1) one-line reminder block (only if needed)
  //   2) the "Say <directives>:" line
  //   3) a blank line
  //   4) the transcript itself, on its own — quoted so the model treats it as
  //      the literal thing to read.
  const lines: string[] = [];
  if (reminders.length > 0) {
    lines.push(reminders.join(" "));
    lines.push("");
  }
  lines.push(directiveLine);
  lines.push("");
  lines.push(spokenText);

  return lines.join("\n");
}

async function handleTTSRequest(
  body: Record<string, unknown>,
  GOOGLE_API_KEY: string,
  corsHeaders: Record<string, string>,
  resolvedModel: string,
): Promise<Response> {
  const {
    text,
    voiceName = "Kore",
    speakingRate = 1.0,
    pitch: _pitch = 0, // accepted but unused — Gemini TTS has no pitch param
    stability = 0.7,
    dialectHint = "",
    emotionHint = "",
    toneHint = "",
    styleInstruction = "",
  } = body as Record<string, any>;

  const voiceValidationError = validateOfficialVoice(voiceName);
  if (voiceValidationError) {
    return new Response(
      JSON.stringify({ error: voiceValidationError, model: resolvedModel }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!text?.trim()) {
    return new Response(
      JSON.stringify({ error: "Text is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const spokenText = normalizeText(text);

  if (!spokenText) {
    return new Response(
      JSON.stringify({ error: "Text is empty." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const isProModel = resolvedModel === "gemini-3.1-flash-tts-preview";

  const fullPrompt = buildTTSPrompt({
    spokenText,
    isProModel,
    styleInstruction,
    dialectHint,
    emotionHint,
    toneHint,
    speakingRate,
    stability,
  });

  const contents = [{ parts: [{ text: fullPrompt }] }];

  const requestBody = {
    contents,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  };

  logSafeEdgeEvent("gemini_tts_requested", { model: resolvedModel, voice_name: voiceName, text_length: text.length });

  const response = await fetch(
    `${GEMINI_API}/${resolvedModel}:generateContent?key=${GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    await response.text();
    logSafeEdgeEvent("gemini_tts_provider_error", { status: response.status });
    return new Response(
      JSON.stringify({ error: `Gemini API error: ${response.status}` }),
      { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const audioPart = candidate?.content?.parts?.find(
    (p: { inlineData?: { mimeType: string } }) => p.inlineData?.mimeType?.startsWith("audio/")
  );

  if (!audioPart?.inlineData) {
    logSafeEdgeEvent("gemini_tts_audio_missing", { model: resolvedModel });
    return new Response(
      JSON.stringify({ error: "No audio generated" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const rawMime = audioPart.inlineData.mimeType as string;
  const rawB64 = audioPart.inlineData.data as string;

  const lowerMime = rawMime.toLowerCase();
  if (lowerMime.startsWith("audio/l16") || lowerMime.startsWith("audio/pcm")) {
    const wavResult = pcmToWav(rawB64, rawMime);
    return new Response(
      JSON.stringify({ ...wavResult, model: resolvedModel, voiceName }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ audioBase64: rawB64, mimeType: rawMime, model: resolvedModel, voiceName }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (legacyPathIsRetired()) return retiredLegacyPathResponse(corsHeaders);

  const rawBody = await req.text();
  let body: Record<string, any>;
  try {
    body = JSON.parse(rawBody) as Record<string, any>;
  } catch {
    return new Response(
      JSON.stringify({ error: "invalid_json" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── JWT Auth Check ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "Missing authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY");
  if (!GOOGLE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "GOOGLE_API_KEY is not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { action } = body;

    const { model: resolvedModel, error: modelValidationError } = resolveModel(body as Record<string, unknown>);
    if (modelValidationError) {
      return new Response(
        JSON.stringify({ error: modelValidationError, allowed: Array.from(ALLOWED_MODELS) }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── SECURITY: Block direct client calls to billable actions ──
    if (BILLABLE_ACTIONS.has(action)) {
      const internalAuthorized = await verifyInternalWorkloadRequest({
        method: req.method,
        path: new URL(req.url).pathname,
        timestamp: req.headers.get("x-fusionlab-workload-timestamp"),
        signature: req.headers.get("x-fusionlab-workload-signature"),
        body: rawBody,
        secret: Deno.env.get("INTERNAL_WORKER_HMAC_KEY"),
      });
      if (!internalAuthorized) {
        logSafeEdgeEvent("gemini_direct_billable_call_blocked", { action });
        return new Response(
          JSON.stringify({
            error: "Direct TTS calls are not allowed. Use start-generation endpoint.",
            code: "DIRECT_CALL_BLOCKED",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ─── Generate TTS (billable - internal only) ───
    if (action === "synthesize") {
      return await handleTTSRequest(body, GOOGLE_API_KEY, corsHeaders, resolvedModel);
    }

    // ─── Preview (free - allowed from client, but with strict input limits) ───
    if (action === "preview") {
      const {
        voiceName = "Kore",
        previewText,
        styleInstruction: prevStyle = "",
        dialectHint: prevDialect = "",
        emotionHint: prevEmotion = "",
        toneHint: prevTone = "",
        stability: prevStability = 0.7,
      } = body;

      const voiceValidationError = validateOfficialVoice(voiceName);
      if (voiceValidationError) {
        return new Response(
          JSON.stringify({ error: voiceValidationError, model: resolvedModel }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Hard cap on preview text length to prevent abuse of free endpoint
      const PREVIEW_MAX_CHARS = 200;
      const safePreviewText = typeof previewText === "string" ? previewText.slice(0, PREVIEW_MAX_CHARS) : "";
      const previewRawText = safePreviewText || "مرحباً، أنا صوتك الجديد. كيف أبدو؟";

      const previewPrompt = buildTTSPrompt({
        spokenText: normalizeText(previewRawText),
        isProModel: resolvedModel === "gemini-3.1-flash-tts-preview",
        styleInstruction: prevStyle,
        dialectHint: prevDialect,
        emotionHint: prevEmotion,
        toneHint: prevTone,
        speakingRate: 1.0,
        stability: prevStability,
      });

      const requestBody = {
        contents: [{ parts: [{ text: previewPrompt }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      };

      const response = await fetch(
        `${GEMINI_API}/${resolvedModel}:generateContent?key=${GOOGLE_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        await response.text();
        logSafeEdgeEvent("gemini_preview_provider_error", { status: response.status });
        return new Response(
          JSON.stringify({ error: `Preview error: ${response.status}` }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();
      const audioPart = data.candidates?.[0]?.content?.parts?.find(
        (p: { inlineData?: { mimeType: string } }) => p.inlineData?.mimeType?.startsWith("audio/")
      );

      if (!audioPart?.inlineData) {
        return new Response(
          JSON.stringify({ error: "No audio in preview" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const prevMime = audioPart.inlineData.mimeType as string;
      const prevB64 = audioPart.inlineData.data as string;

      const prevLowerMime = prevMime.toLowerCase();
      if (prevLowerMime.startsWith("audio/l16") || prevLowerMime.startsWith("audio/pcm")) {
        const wavResult = pcmToWav(prevB64, prevMime);
        return new Response(
          JSON.stringify({ ...wavResult, model: resolvedModel, voiceName }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ audioBase64: prevB64, mimeType: prevMime, model: resolvedModel, voiceName }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use: synthesize, preview" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    logSafeEdgeError("gemini_tts_request_failed", e);
    return new Response(
      JSON.stringify({ error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
