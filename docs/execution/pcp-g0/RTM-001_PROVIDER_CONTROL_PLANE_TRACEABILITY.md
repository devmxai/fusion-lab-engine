# PCP-G0 — RTM-001: Provider Control Plane Traceability

> **Plan:** `FL-PCP-002`  
> **Gate:** `PCP-G0`  
> **Status:** `ACTIVE`

| Requirement | Gate | Proof required |
|---|---|---|
| مسار generation واحد | G0/G1/G11 | Inventory, route tests, legacy retirement tests |
| لا خصم/إرسال مزدوج | G1/G6/G9 | Idempotency, crash/restart and double-click tests |
| لا refund عند قبول مجهول | G1/G5 | Provider timeout and reconciliation tests |
| Secret Manager حقيقي | G3 | Write-only, restart, rotation and redaction tests |
| موديلات قبل المفتاح بلا بيانات وهمية | G4 | Immutable reference snapshots and source evidence |
| API key تعني Connected فقط | G3/G8 | Account state and UI E2E tests |
| تسعير دقيق لكل SKU | G6 | Formula, simulation and quote-version tests |
| Active model يظهر للمستخدم فقط بعد publish | G7/G9 | Atomic release and Published Offer integration tests |
| KIE protocol/webhook/cost صحيح | G4/G5/G10 | Official contract fixtures and canary evidence |
| OpenRouter catalog/routing/cost صحيح | G4/G5/G10 | Official contract fixtures and canary evidence |
| Admin SaaS English-first واضح | G8 | UI E2E, accessibility and no mixed-language checks |
| Deploy آمن وقابل للتشغيل | G10 | Topology, runbooks, drill and formal approval |

