# RACI-001 — Ownership and Approval Baseline

| الحقل | القيمة |
|---|---|
| Status | `BLOCKED — named humans and backups missing` |
| Accountable owner | Product Owner — name required |
| Updated | 2026-08-11 Asia/Baghdad |

الأدوار الحالية placeholders وظيفية. لا تكفي كلمة Admin أو Codex كتوقيع إنتاجي. Codex يساعد في التنفيذ والتوثيق والاختبار، لكنه ليس شخص on-call ولا جهة مالية أو قانونية مسؤولة.

| المجال | Responsible | Accountable | Required approval | Named/backup status |
|---|---|---|---|---|
| Product scope/user promise | Product Owner | Product Owner | Product | `MISSING` |
| Architecture/Engine contracts | Engineering Lead | Engineering Lead | Security + domain owner | `MISSING` |
| Ledger/settlement/migration | Finance Systems Owner | Finance Owner | Finance + Security | `MISSING` |
| Secrets/RLS/threat model | Security Owner | Security Owner | Security | `MISSING` |
| Provider routes/cost evidence | Provider Integration Owner | Engineering Lead | Finance + Security | `MISSING` |
| Supabase/data/restore | Data Owner | Engineering Lead | Security + Finance | `MISSING` |
| VPS/queues/observability/on-call | Operations Owner | Engineering Lead | Security | `MISSING` |
| Frontend/a11y/RTL | Frontend + Design | Product Owner | Product | `MISSING` |
| Production release | Release Manager | Product Owner | Engineering + Security + Finance | `MISSING` |
| Incident command | On-call Incident Commander | Engineering Lead | domain owner | `MISSING` |

## الفصل الإلزامي

- منشئ Price/Route Version لا يوافق نشرها منفردًا.
- منفذ financial adjustment أو migration لا يوقع reconciliation منفردًا.
- credential writer لا يملك read-back أو activation منفردًا.
- Release Manager لا يتجاوز Security/Finance veto.

## شرط الإغلاق

يستبدل كل `MISSING` باسم إنسان، حساب عمل، قناة اتصال، timezone، ومسؤول بديل. إلى ذلك الوقت يبقى Gate 0 في `HOLD` ولا يوجد GA/on-call claim.
