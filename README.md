# FusionLab

FusionLab is a React/Vite application for AI image, video, and audio generation, backed by Supabase.

## Documentation

- [Professional Master Plan: Platform with Engine](docs/PROFESSIONAL_MASTER_PLAN_PLATFORM_WITH_ENGINE_AR.md) — `FL-PMP-001`, the sole executable plan.
- [Documentation authority](docs/README.md)
- [Transfer baseline](docs/TRANSFER_BASELINE.md) — historical repository-transfer record, not an execution plan.
- [Local Engine and Mock Provider](apps/engine-api/README.md) — local-only provider and credit simulation.

## Local setup

Requirements:

- Node.js 22 LTS
- npm 10+
- Access to the intended Supabase project

```sh
git clone <PRIVATE_REPOSITORY_URL>
cd fusionlab-next
npm ci
cp .env.example .env.local
npm run dev
```

`npm run dev` يشغّل مسار التطوير المحلي الواحد:

- Web: `http://127.0.0.1:8080`
- Engine API: `http://127.0.0.1:8787`
- Provider For Test API: `http://127.0.0.1:8790`
- Engine through the Web origin: `http://127.0.0.1:8080/api/engine/healthz`
- Local Admin Control Plane V2: `http://127.0.0.1:8080/admin/v2`
- Local Creative Space: `http://127.0.0.1:8080/projects/local-demo/studio`

المحرك المحلي يرفض `NODE_ENV=production` وأي privileged server credential. لا ينشر أو يربط Production.

Fill `.env.local` locally. Never commit it. Browser-visible configuration uses:

```text
VITE_SUPABASE_PROJECT_ID
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_URL
VITE_GOOGLE_CLIENT_ID
```

Provider credentials such as KIE, OpenRouter, payment, webhook, and Supabase privileged keys belong in the approved server-side secret manager described by `FL-PMP-001`. They must never use the `VITE_` prefix, appear in browser responses, or be committed.

## Verification

```sh
npm run build
npm test
npm run lint
npm run typecheck
npm run test:engine
```

The clean transfer snapshot builds successfully and its current test passes. The inherited lint and dependency-audit baseline is documented in [Transfer Baseline](docs/TRANSFER_BASELINE.md); it is intentionally not hidden or force-fixed during repository migration.

## Deployment

- Vercel configuration is in `vercel.json`.
- Supabase migrations and Edge Functions are under `supabase/`.
- Keep development, staging, and production credentials separate.
- Link Supabase/Vercel from each development machine through their authenticated CLIs; do not copy CLI cache folders into Git.

## Repository safety

The repository intentionally excludes:

- `.env` and `.env.local`
- `node_modules`
- `dist`
- `.vercel`
- `supabase/.temp`
- logs and OS/editor files

The production security and migration sequence is defined only by `FL-PMP-001`. Do not expand billable generation routes before closing its P0 security gates.
