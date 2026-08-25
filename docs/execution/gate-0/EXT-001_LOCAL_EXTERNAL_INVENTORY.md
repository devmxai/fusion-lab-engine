# EXT-001 — Local External-Service Inventory Baseline

| Field | Value |
|---|---|
| Status | `LOCAL BASELINE COMPLETE / EXTERNAL EVIDENCE PENDING` |
| Scope | `Read-only workspace inspection only` |
| Production change | `NONE` |
| Secrets recorded | `NONE` |

## Observed local configuration

- Git remote points to the configured FusionLab GitHub repository.
- The workspace contains one GitHub workflow: `.github/workflows/ci.yml`.
- The Supabase configuration identifies one project reference; its value is intentionally not repeated here.
- Five configured Edge Function routes have platform JWT verification disabled: `kie-ai`, `start-generation`, `complete-generation`, `gemini-tts`, and `system-jobs`.
- The workspace contains six Edge Function directories and 52 historical migration files.
- No `.vercel/project.json` link exists in this working copy.
- GitHub CLI, Supabase CLI, and Vercel CLI are not installed locally.

## Interpretation

This is not a remote inventory and does not prove current cloud configuration, deployments, database grants, storage policies, cron jobs, provider balances, backup/PITR state, or secret validity. The disabled JWT routes remain a confirmed security review item; no configuration was changed under the local-only boundary.

## Required external evidence before Gate 0 can move

1. Revoke and replace every token disclosed outside managed secret storage; record only rotation timestamps and scoped owner identities, never token values.
2. Obtain read-only exports/screenshots for Supabase functions, deployments, database grants/RLS, storage policies, cron, backup/PITR, and audit logs.
3. Obtain Vercel project/environment/deployment inventory and GitHub branch-protection/CI evidence.
4. Obtain provider account/credit/kill-switch inventory without putting provider credentials into this repository.
5. Run and record a timed restore rehearsal before any financial migration or Production cutover.

## Boundary

No token from chat history is valid operational evidence. The next person performing cloud inventory must use a newly rotated, least-privilege identity in the appropriate official console or CLI session.
