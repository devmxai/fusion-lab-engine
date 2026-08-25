# RISK-001 — Initial Risk Register

| الحقل | القيمة |
|---|---|
| Status | `ACTIVE` |
| Owner | Product Owner + domain owners — names required |
| Updated | 2026-08-11 Asia/Baghdad |

| ID | الخطر | Likelihood | Impact | الاحتواء الحالي | Owner | الحالة |
|---|---|---:|---:|---|---|---|
| `R-001` | credentials شاركت خارج Secret Manager | High | Critical | لا تكرر؛ rotate/revoke؛ spend/audit review | Security | `OPEN P0` |
| `R-002` | Browser يستطيع التأثير في terminal/settlement | High | Critical | freeze paid expansion؛ server-owned V2 path | Engine/Security | `OPEN P0` |
| `R-003` | public generations/temp media | High | Critical | inventory؛ private pipeline + compatibility plan | Data/Security | `OPEN P0` |
| `R-004` | timeout يطلق refund بعد احتمال provider acceptance | Medium/High | Critical | Submission Unknown + no blind retry design | Engine/Finance | `OPEN P0` |
| `R-005` | time-only cleanup وsubscription wallet zeroing | Medium | Critical | disable unsafe automation before paid rollout | Finance/Data | `OPEN P0` |
| `R-006` | Service Role كسر مشترك داخلي | High | Critical | rotate؛ replace with purpose identity/HMAC | Security | `OPEN P0` |
| `R-007` | لا restore drill أو VPS inventory | Medium | Critical | Gate 0 blocks paid rollout | Operations | `OPEN P0` |
| `R-008` | لا CI وtest coverage شبه صفر | High | High | baseline captured؛ Gate 2 pipeline | Engineering | `OPEN P1` |
| `R-009` | lint baseline 112 errors/25 warnings | High | Medium/High | touched-module zero-new-debt؛ planned cleanup | Engineering | `OPEN P1` |
| `R-010` | 1.1 MB main JS وlarge pages | High | Medium | code splitting/performance budgets لاحقًا | Frontend | `OPEN P1` |
| `R-011` | Node 22 repo مقابل Node 24 Vercel | Medium | High | pin runtime/environment contract | Operations | `OPEN P1` |
| `R-012` | Management token permissions غير كافية لبعض الجرد | High | High | assign scoped machine identity/owner | Operations | `OPEN P1` |

## قاعدة القبول

لا يقبل Risk يخالف محظورات الخطة. كل residual Critical/High يحتاج control/test/owner/review date، ولا يحول إلى `ACCEPTED` بسبب موعد أو صغر الفريق.
