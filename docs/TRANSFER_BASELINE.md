# FusionLab Transfer Baseline

> Verified: 11 August 2026  
> Purpose: reproducible baseline for the clean private-repository migration.

## Repository preparation

- Clean Git history; the previous `.git` directory is not included.
- `.env`, `node_modules`, `dist`, `.vercel`, and `supabase/.temp` are excluded.
- `.env.example` contains placeholders only.
- The canonical `FL-PMP-001` Professional Master Plan is the sole executable plan under `docs/`; superseded plans and drafts were removed from the working tree and remain available only through Git history.
- Gitleaks 8.30.1 directory scan: no leaks found.

## Dependency installation

- `package-lock.json` was regenerated to match `package.json`.
- `npm ci`: passes.
- Non-breaking `npm audit fix`: applied to the clean snapshot.

## Build and tests

- `npm run build`: passes.
- `npm test`: passes; current suite contains one test.
- Production bundle warning: the main JavaScript chunk is approximately 1.11MB before gzip and needs code-splitting during product development.

## Known inherited issues

- `npm run lint`: currently fails with 112 errors and 25 warnings.
- The largest groups are existing explicit `any` types, React Hook dependency warnings, and conditional Hooks in `StudioPage.tsx`.
- `npm audit --omit=dev`: two moderate React Router advisories remain. Resolving them requires a controlled router upgrade and regression testing.
- Full audit also reports development-tool advisories involving the current Vite/esbuild line; a forced major upgrade was not performed during transfer.

These issues do not prevent the current production build, but they are tracked by the security, platform-foundation, and GA gates in `FL-PMP-001`.
