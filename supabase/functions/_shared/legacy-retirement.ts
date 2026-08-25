/**
 * Historical Edge generation functions are deliberately retired while the
 * Engine V2 path becomes the sole commercial execution boundary. Keeping a
 * hard response preserves auditability without permitting a second financial
 * or provider path to be revived accidentally.
 */
export function legacyPathIsRetired(): boolean {
  return true;
}

export function retiredLegacyPathResponse(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({
    error: "legacy_generation_path_retired",
    code: "ENGINE_V2_REQUIRED",
    message: "This historical Edge path is retired. Use the Engine V2 boundary.",
  }), {
    status: 410,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
