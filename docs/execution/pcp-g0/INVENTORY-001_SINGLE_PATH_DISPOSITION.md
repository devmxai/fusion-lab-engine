# PCP-G0 — INVENTORY-001: Single-Path Disposition Matrix

> **Plan:** `FL-PCP-002`  
> **Gate:** `PCP-G0`  
> **Status:** `PASS — DISPOSITION APPROVED`  
> **External provider calls:** none

## Canonical path

```text
Creative Space browser
→ /api/engine/v2/quotes
→ /api/engine/v2/operations
→ Durable Generation V2
→ Provider Runtime Resolver
→ Provider Adapter
→ Durable delivery, ledger and reconciliation
```

Only this path may become commercial. A browser never selects credentials, provider account, raw endpoint, provider price or settlement result.

## Entry-point inventory

| Entry point | Current purpose | Disposition | Required action |
|---|---|---|---|
| `apps/engine-api/src/generation-v2/routes.ts` | Engine quote, operation, asset and project boundary | `CANONICAL` | Extend only through PCP contracts |
| `apps/engine-api/src/durable-worker/*` | Durable execution, provider attempts, delivery and settlement | `CANONICAL` | Harden in PCP-G1, then bind to release bundles |
| `apps/engine-api/src/local-provider/*` | Local Provider For Test and legacy compatibility routes | `TEST_ONLY` | Keep fixtures; prevent commercial UI/runtime selection |
| `apps/provider-test-api/*` | Deterministic provider simulator | `TEST_ONLY` | Keep isolated from any published catalog |
| `supabase/functions/start-generation` | Historical generation orchestrator | `LEGACY_DISABLED` | Return a hard retirement response; never route commercial work |
| `supabase/functions/kie-ai` | Historical KIE direct adapter | `LEGACY_DISABLED` | Return a hard retirement response; never call KIE |
| `supabase/functions/gemini-tts` | Historical direct TTS adapter | `LEGACY_DISABLED` | Return a hard retirement response; never call provider |
| `supabase/functions/complete-generation` | Historical settlement endpoint | `LEGACY_DISABLED` | Return a hard retirement response; ledger only through Engine V2 |
| `supabase/functions/system-jobs` | Historical system jobs | `LEGACY_DISABLED` | Return a hard retirement response pending replacement |
| `src/lib/local-provider-client.ts` | Development fixture client | `TEST_ONLY` | No import from production Creative Space path |
| `src/features/creative-space/*-quote-client.ts` | Browser client to Engine V2 | `CANONICAL_BROWSER_CLIENT` | Replace hard-coded local offers in PCP-G9 |
| `src/pages/AdminV2Page.tsx` | Admin read surface | `CONTROL_PLANE_UI` | Rebuild atop durable control plane in PCP-G8 |

## Provider registration inventory

| Provider record | Current state | Disposition |
|---|---|---|
| Provider For Test | Registered in Engine and Runtime | Test-only adapter |
| KIE.ai | Static onboarding profile and partial offline adapter | Not registered, not executable |
| OpenRouter | Static onboarding profile and partial offline adapters | Not registered, not executable |

## Assertions required by this disposition

1. No source under `src/` may call a Supabase generation function.
2. No `/v2/*` operation may be dispatched through a legacy edge function.
3. No legacy edge function may initiate a provider call or mutate commercial generation/ledger state.
4. Provider For Test never appears in Published Offer Catalog.
5. No KIE/OpenRouter adapter is registered before an active Release Bundle selects it.

## Next gate dependency

This inventory authorizes PCP-G1 to convert the legacy disposition into code-enforced retirement behavior and to add regression tests. It does not authorize deletion of historical code until PCP-G11.

