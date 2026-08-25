# PCP-G8 — English-first Admin Clarity

**Status:** `LOCAL UI FOUNDATION PASS`

## Implemented

- Admin V2 now uses one English LTR interface. Arabic UI copy, Arabic date locales, and RTL dialog directions were removed from this screen.
- Provider setup explains the operational sequence in user-facing terms: secure credential, reference catalog, selected models, pricing, independent review, and controlled release.
- Secret Manager is explicitly metadata-only: no key field, key reveal, external call, or browser-side activation.
- Operations, owner finance, audit, change history, route gates, catalog evidence, pricing workbench, and detail dialogs use consistent English labels.
- Build proof: `tsc -p tsconfig.app.json` and `vite build --mode development` succeed.

## Deliberate limits

- The current session remains local `ADMIN_VIEWER`; no UI button pretends to write, publish, test a credential, or call a provider.
- Setup/write controls require a real AAL2 identity and server endpoints; they are a later integration step, not simulated browser behavior.
- The page still reads legacy/local projections in some sections. G8 is not closed until those projections read Published Offer/Release Bundle state directly.

## Verification note

The Supabase internal-workload signature verifier now copies the decoded signature into a DOM-compatible `ArrayBuffer` before Web Crypto verification, removing the shared-buffer type incompatibility without changing the signed bytes.
