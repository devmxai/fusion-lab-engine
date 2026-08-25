# Gate 0 Evidence and Decision

| الحقل | القيمة |
|---|---|
| Gate | `0 — Governance and Incident Containment` |
| Plan | `FL-PMP-001 v1.1.0` |
| Decision | `HOLD` |
| Production paid expansion | `STOP` |
| Safe local containment work | `GO` |
| Evidence date | 2026-08-11 Asia/Baghdad |

## Evidence checklist

| Requirement | Evidence | النتيجة |
|---|---|---|
| canonical single plan | docs authority + plan v1.1.0 | `PASS` |
| repository/application inventory | `INVENTORY-001` | `PASS — local baseline` |
| Release 1 scope/critical path | `DEL-001` | `DRAFT PASS` |
| risk register | `RISK-001` | `PASS — risks remain open` |
| initial traceability | `RTM-001` | `PASS` |
| no obvious tracked credential signatures | name-only tracked-file scan | `PASS — CI scanner still required` |
| baseline test | Vitest: 1 file/1 placeholder test passed | `PASS but insufficient` |
| local test provider | independent API process, Bearer credential, Adapter/Registry, canonical contracts, fixed quotes, dual ledgers and five lifecycle scenarios | `PASS — local only` |
| engine-provider HTTP E2E | real socket request/response, task polling, authenticated result download, signature/size validation, SHA-256, storage and settlement | `PASS — local only` |
| external provider consumption during mock E2E | successful quote-to-settlement flow through Vite proxy; external calls = 0 | `PASS — local only` |
| local provider guardrails | production mode and privileged KIE/Gemini/OpenAI/OpenRouter/HMAC/Service Role and administrative credentials rejected; official provider calls and storage upload bypassed in DEV | `PASS — local only` |
| browser terminal completion boundary | `complete-generation` requires fresh Worker HMAC, uses service-role access only after verification and derives the owner from its stored reservation; browser bridge rejects non-local terminal completion | `PASS — local code only; no Edge deployment evidence` |
| provider and scheduler internal-call boundary | `start-generation` signs provider requests; `kie-ai`, `gemini-tts`, `complete-generation` and `system-jobs` verify Workload HMAC and no longer accept Service Role in `x-internal-caller` | `PASS — local code only; managed secret, signed scheduler and Edge deployment evidence remain open` |
| provider task ownership boundary | `kie-ai` looks up `generation_jobs` with `task_id` and authenticated `user_id` before every status query | `PASS — local source enforcement; adversarial database/Edge evidence remains open` |
| sensitive Edge logging boundary | shared `safe-edge-log` emits only event, scalar context and error type; provider payload/message logging was removed | `PASS — local unit test; deployed log-sink retention/redaction evidence remains open` |
| legacy scheduled financial mutations | `system-jobs` returns `held` for subscription-expiry and stale-reservation cleanup; it performs reconciliation only | `PASS — local compatibility hold; historical DB functions/cron evidence remains open` |
| browser generation/media writes | queue updates are display-only; browser library evidence writes/deletes and Studio/Audio public uploads are blocked pending a signed worker | `PASS — local source containment; RLS/private-storage and worker deployment evidence remain open` |
| legacy Admin mutation boundary | `AdminPage` and `UserManagement` no longer execute direct RPC/table mutations; regression test rejects their return | `PASS — local UI containment; Admin V2 durable identity, storage and command adapters remain open` |
| Edge manual-auth contract | the five `verify_jwt=false` functions are regression-checked for their user-JWT or Workload-HMAC fail-closed paths, legacy header removal and no browser CORS access to workload headers | `PASS — local source contract; deployed Edge configuration/secrets/adversarial evidence remain open` |
| Gate 2 contract preparation | API-001 OpenAPI endpoint, strict public DTOs, EVT-001 typed event catalog, STM-001 CAS/evidence transitions and ADR-001..008 | `TESTED LOCAL DRAFT — NOT GATE APPROVAL` |
| current local verification | typecheck + 368 Vitest tests + 7 Playwright E2E + desktop/mobile Axe WCAG A/AA + Engine build + Provider Test build + Vite build | `PASS — local only` |
| CI baseline | GitHub workflow runs typecheck/unit/build, Chromium E2E and Gitleaks; lint reports separately until inherited lint debt is closed | `PARTIAL LOCAL — NO REMOTE RUN EVIDENCE YET` |
| durable execution primitives | scoped idempotency, outbox lease/recovery/dead-letter and concurrent inbox dedupe/conflict | `PASS — in-memory local adapter only` |
| whole-credit ledger reference | bigint balanced journals, lots/allocations, reserve/settle/release/expire/adjust, 100-repeat idempotency and exact projection rebuild | `PASS — local domain; Gate 3 and DB evidence pending` |
| commercial registry and quote | immutable Family/Recipe/Route/Capability/Billing/Cost/Price/Policy snapshots, rational DSL, hard margin floor and full quote version pinning | `PASS — Provider For Test local only; Gate 4 not passed` |
| private media pipeline | SSRF/origin/DNS/IP guard, MIME + magic validation, malware quarantine, private access grants, resumable uploads and anonymous asset denial | `PASS — local reference only; Gate 5 not passed` |
| durable orchestration reference | atomic reserve/operation/outbox, relay and attempt leases, Inbox, unknown/manual review, exact settlement/provider loss and 99% reconciliation target | `PASS — Provider For Test local reference only; Gate 6/KIE not passed` |
| Provider Treasury and OpenRouter contract | funding lots/fee allocation, shadow/runway/limits/circuit, Exact equivalence hard gate, async video fixtures and raw-body HMAC | `PASS — local fixtures only; no OpenRouter route certified and Gate 7 not passed` |
| Admin Control Plane V2 reference | AAL2/RBAC, maker-checker lifecycle, immutable versions, write-only credentials, hash-chain audit, runtime route kill switch and ledger adjustment | `PASS — local in-memory only; legacy direct mutations remain and Gate 8 not passed` |
| Creative Space foundation | project-owned domain graph, xyflow adapter, bounded viewport, desktop/mobile Composer, tap Bindings, local media cards, refresh recovery, exact mock billing, WCAG checks and 100-card desktop/mobile budgets | `PASS — local reference only; TUS/server persistence and Gate 9 remain pending` |
| Payment sandbox foundation | provider-neutral adapter, server-created checkout, exact raw-body HMAC, timestamp/delivery/event dedupe, immutable amount match and purchased Lot grant only after verified webhook | `PASS — local sandbox only; Legal/Gates 3,8 and production payment provider pending` |
| Plan/subscription sandbox | immutable Plan Versions, pinned subscriber terms/limits/model eligibility, exact-period renewal dedupe and Subscription-only expiry preserving Purchased Lots | `PASS — in-memory sandbox only; Legal/Gates 3,8 and production scheduler pending` |
| Refund/chargeback sandbox | immutable Invoice economics, signed full reversals, exact-Lot compensating withdrawal, consumed-credit receivable and chargeback fraud review | `PASS — local sandbox policy only; Legal/accountant/provider evidence pending` |
| production build | Vite build passed; 1.1 MB main chunk warning | `PASS with P1 debt` |
| lint | 112 errors, 25 warnings | `FAIL` |
| credentials rotated/revoked | no revocation evidence | `FAIL P0` |
| named owners/backups | `RACI-001` MISSING | `FAIL` |
| Supabase/VPS/provider complete inventory | [EXT-001 local baseline](./EXT-001_LOCAL_EXTERNAL_INVENTORY.md); VPS/provider/production policies remain unknown | `FAIL — EXTERNAL READ-ONLY EVIDENCE REQUIRED` |
| backup/PITR restore rehearsal | no timed restore report | `FAIL P0` |
| global provider/billing kill switches | not proven | `FAIL P0` |

## Execution boundary requested by Product Owner

- مسار تطوير واحد على نسخة المشروع الحالية فقط.
- لا Database Migration جديدة أو مطبقة ضمن الوضع الحالي.
- لا Supabase/Vercel/Production change أو deploy.
- حزمة Migration المحلية التجريبية أزيلت، وأعيد اعتماد الواجهة عليها إلى حالته السابقة.
- مخاطر قاعدة البيانات تبقى `OPEN` وموثقة؛ لا تدّعى معالجتها ما دام تغيير Schema محظورًا.

## Confirmed containment priorities

1. Rotate/revoke exposed credentials through named owner and managed secret storage.
2. Capture real Supabase/VPS/provider/cron/storage/grants inventory read-only.
3. Prove backup and restore before financial migrations.
4. Add fail-closed P0 compatibility changes: no client terminal writes، no user job writes، no time-only refund، no public media.
5. Add CI checks and adversarial tests before any Production cutover.

## Decision rationale

Gate 0 لا يمر لأن secret rotation، restore drill، named ownership، kill switches والجرد الخارجي غير مكتملة. يسمح باستمرار العمل المحلي الآمن على الاحتواء والاختبارات والعقود. يمنع نشر مسار مدفوع جديد أو توسيع Production حتى تتحول موانع P0 إلى Evidence موقعة.

## Required approvals to change decision

- Product Owner.
- Engineering Lead.
- Security Owner.
- Finance Owner للمسار المدفوع.

كل موافقة تحتاج اسمًا وتاريخًا ورابط دليل؛ لا تعتمد موافقة مجهولة أو آلية.
