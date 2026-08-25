# DEL-001 — Release 1 Safe Exact Vertical Slice

| الحقل | القيمة |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `DRAFT — Gate 0 approval required` |
| Owner | Product Owner + Engineering Lead — named humans required |
| Reviewers | Security + Finance |
| Updated | 2026-08-11 Asia/Baghdad |

## الهدف

إثبات مسار واحد آمن وقابل للتدقيق من Quote إلى Settlement باستخدام KIE Exact Route واحد، من دون توسيع المنتج قبل إثبات الأمن والمال والاعتمادية.

## وضع التطوير الحالي

- التطوير يتم على نفس نسخة المشروع الحالية وضمن working copy واحدة.
- لا ينشأ تطبيق موازٍ أو Backend ثانٍ أو مسار V1/V2 مزدوج أثناء هذه الدفعة.
- لا تنشأ أو تطبق Database Migration، ولا يغيّر Supabase Production.
- لا ينفذ Vercel/Production deploy أو domain cutover.
- أي عمل يحتاج Schema أو Production يؤجل صراحة حتى يغيّر Product Owner هذا القيد.

```text
P0 containment
→ Platform contracts and isolated staging
→ Whole-credit Ledger V2
→ Registry and deterministic Quote
→ Private media
→ Durable operation/outbox/worker
→ one Certified KIE Exact route
→ Verify/Ingest/Deliver/Reconcile/Settle
→ controlled cohort canary
```

## داخل النطاق

- Gates 0–6 بالترتيب المحدد في الخطة.
- Whole Credits بلا كسر أو ×1000.
- Engine API وWorker skeleton وعقود versioned.
- private upload/result storage.
- Quote ثابت، reservation ذري، operation/attempt/outbox.
- KIE Route واحد يختار في Gate 4 بعد source snapshot وcanary وactual extractor.
- read-only operational investigation، alerts، runbooks وkill switches.
- cohort داخلي أو مصرح له فقط بعد Gate 6.

## خارج النطاق

- OpenRouter production وcross-provider Exact.
- Smart/auto-routing/Unlimited/auto top-up.
- الدفع العام والعروض والحملات.
- Professional Graph وcatalog واسع.
- LLM/Agent production authority.
- أي تعديل يعيد V1 غير الآمن كـrollback.

## المسار الحرج

```text
Gate 0 → Gate 1 → Gate 2 → Gate 3 → Gate 4 ┐
                         └──────→ Gate 5 ───┼→ Gate 6 → Release 1 canary
                                  Gate 3 ───┘
```

## معيار النجاح

1. طلب مكرر 100 مرة ينتج Operation واحدة وProvider Task واحدة كحد أقصى.
2. لا خصم نهائي قبل Asset خاص صالح ومتاح للمستخدم.
3. Settlement لا يتجاوز Quote ويحدث مرة واحدة.
4. crash/redelivery/out-of-order/timeout/submission-unknown تمر بالاختبارات.
5. actual provider cost وcustomer journal وroute versions قابلة لإعادة التشغيل والتدقيق.
6. P0 مغلقة، Gate evidence موقعة، وrollback drill ناجح.

## Stop conditions

- secret exposure، public user media، client terminal authority.
- ledger drift/negative balance/duplicate debit أو provider task.
- unknown cost بلا exposure cap أو Route بلا kill switch.
- restore غير مثبت أو owner غير متاح للمسار الحساس.

## Forecast

لا يثبت تاريخ قبل تعيين named owners وحساب capacity وexternal lead times. يخفض breadth/cohort قبل أي خفض للأمن أو المال.
