# FusionLab — برنامج تنفيذ Admin SaaS والمزودات وتجربة المنصة

> **Document ID:** `FL-APU-001`<br>
> **الإصدار:** `1.0.0`<br>
> **التاريخ:** 21 أغسطس 2026 — Asia/Baghdad<br>
> **الحالة:** `SUPERSEDED FOR NEW WORK BY FL-PCP-002 — HISTORICAL EXECUTION REFERENCE`<br>
> **السلطة:** برنامج تنفيذ مستقل تنظيمياً وتابع إلزامياً لـ`FL-PMP-001 v1.1.0`<br>
> **النطاق:** Admin SaaS، KIE.ai، OpenRouter، وتجربة المنصة/Creative Space<br>
> **خارج النطاق الحالي:** أي Provider API call، Migration، Deploy، Production change، أو توليد مدفوع

---

## 0. غرض الوثيقة وحدود السلطة

هذه الوثيقة تحول الطلب إلى برنامج بناء قابل للتنفيذ والقياس، لكنها **ليست Master Plan ثانية**. عند أي تعارض تكون السلطة لـ`FL-PMP-001`، ويتوقف التنفيذ ويفتح Change Proposal موثق.

المسارات الثلاثة للبرنامج:

1. إعادة بناء Admin Panel كنظام SaaS واضح وآمن ومتكامل.
2. بناء تكامل KIE.ai وOpenRouter خلف عقود Provider موحدة.
3. إعادة تصميم تجربة المنصة وCreative Space لتخدم المبتدئ والمحترف.

لا تسمح هذه الوثيقة باستعمال الأسرار التي أُرسلت في المحادثات، ولا تخزن Secret أو Token في Git أو المتصفح أو سجل اختبار. جميع الأعمال حتى `APU-G7` محلية وOffline/Fixture-based.

### 0.1 القرارات التنفيذية المثبتة

- يوجد **محرك واحد ومسار توليد واحد** لكل الواجهات.
- المتصفح يطلب Quote ويقبلها ويعرض الحالة؛ لا يقرر السعر ولا يخصم الرصيد ولا يتصل بالمزود مباشرة.
- الـPublisher ليس Provider: مثلاً OpenAI/xAI/Google ناشر أو مالك Model، بينما KIE/OpenRouter Route Provider.
- كل Model يظهر من Catalog موحد، وكل Route يرتبط بنسخة سعر وتاريخ صلاحية وقدرات مثبتة.
- سعر العميل لا يساوي تكلفة المزود ولا يُشتق منها لحظة التنفيذ.
- لا Release للحجز عند نتيجة Submit مجهولة.
- لا Settlement بلا نتيجة موثقة، ولا Refund بلا دليل موثق.
- لا حذف فوري لمحاكي التطوير؛ يعزل أولاً ويُحذف من Runtime التجاري بعد اكتمال البدائل والاختبارات.
- استيراد كل موديلات المزود إلى Admin لا يعني نشرها للمستخدم؛ النشر يتطلب Certification وموافقة.

### 0.2 معادلة العمل الرسمية

```text
Catalog Snapshot
  → Customer Quote Snapshot
  → Reserve Customer Whole Credits
  → Select Certified Route
  → Persist Operation + Dispatch Intent
  → Provider Submit
  → Verify Callback/Poll Result
  → Private Asset Ingest
  → Reconcile Actual Provider Cost
  → Settle Customer Reservation
  → Profit and Exception Analytics
```

---

## 1. ملخص المراجعة الحالية

### 1.1 ما يصلح للبناء عليه

- توجد عقود محلية جيدة للـLedger، الإصدارات غير القابلة للتعديل، maker-checker، التدقيق، المصالحة، وإيقاف التشغيل.
- يوجد Provider-neutral execution contract أولي واختبارات Fixtures لـProvider For Test وOpenRouter Video.
- توجد أسس Creative Space وDomain Graph وxyflow ومسار Quote/Reserve/Execute محلي.
- توجد شاشات Legacy تغطي أجزاء من التسعير والمحتوى، ويمكن استعمالها كمصدر متطلبات فقط.

### 1.2 الفجوة المعمارية

الحالة الحالية ليست Admin SaaS موحداً:

- `/admin` كبير ويكتب في جداول Supabase مباشرة من الواجهة.
- `/admin/v2` واجهة محلية صغيرة، وبعض بياناتها في الذاكرة فقط.
- هوية Admin وأدواره يمكن تمثيلها عبر Headers قادمة من المتصفح.
- Change Sets وCredentials وAudit المحلية تضيع عند إعادة التشغيل.
- Secret محلي مخزن كنص داخل Process Map؛ هذا نموذج اختبار لا Secret Manager.
- هناك أكثر من مصدر Catalog وأكثر من Pricing Engine وأكثر من Generation History.
- `Publisher` و`Provider` و`Route` متداخلة، فلا يمكن عرض سعر GPT Image عبر KIE بصورة صحيحة.
- Studio وCreative Space وAudio لا تمر جميعها في مسار Backend موحد.
- OpenRouter الحالي Video Adapter محدود وغير مسجل كتكامل تجاري Certified.
- KIE الحالي Edge Function خاص بالمزود، وليس Adapter داخل Engine الموحد.

### 1.3 موانع P0 المكتشفة

يُحظر تشغيل مزود حقيقي قبل إغلاق الآتي:

1. `start-generation` يحرر حجز العميل عند timeout/network error بعد محاولة Submit؛ قد يكون KIE قبل المهمة وخصمها. الحالة الصحيحة `SUBMISSION_UNKNOWN`، بلا Release ولا Retry تلقائي.
2. `complete-generation` يعتبر بعض نصوص الخطأ دليلاً على Refund؛ النص وحده غير كافٍ. الصفر لا يعتد به إلا من terminal provider record مربوط بالـtask/route/account مع evidence hash، أو Refund Evidence موثق خاص بالمسار.
3. استجابة حالة KIE الحالية تسقط `creditsConsumed`؛ لذلك لا توجد Actual COGS أو مصالحة موثوقة.
4. Submit يسبق تثبيت Operation/Dispatch Intent الدائم؛ وهذا يمنع التعافي الآمن من الانقطاع.
5. KIE Market لا يرسل حالياً `callBackUrl` ولا يوجد Verified Webhook Inbox كامل.
6. Admin V2 يثق في Headers للهوية/AAL/Roles؛ يجب اشتقاقها Server-side من Session موثق.
7. Credentials/Approvals/Audit ليست Durable في التطبيق المرجعي الحالي.
8. الكتابة المباشرة من Browser في Catalog/Pricing تخالف maker-checker ومبدأ أقل صلاحية.
9. `complete-generation` الحالي يستدعي `settle_credits` قبل حفظ Generation/إثبات الأصل المسلّم؛ فشل الـinsert اللاحق لا يعكس التسوية، فينتج خصم بلا durable delivered asset. يجب أن تصبح التسوية بعد `ASSET_STORED → DELIVERED` فقط.

هذه الموانع تسبق أي لصق API Key أو Canary.

### 1.4 فجوات P1

- عقد `ProviderModel` لا يحمل Schema القدرات/المدخلات/المخرجات/وحدات الكلفة.
- Quote غير مربوط ربطاً صريحاً بنسخة Product + Variant + Route + Customer Price.
- لا توجد Raw Catalog Snapshots موقعة بالـSHA256 ولا Diff/Approval قبل النشر.
- لا توجد Unified Generation Timeline تجمع المال والمزود والنتائج والأصول.
- لا توجد Queue مركزية لـUnknown Submit وUnknown Cost وUnmatched Provider Charge.
- بعض الصفحات Monolithic، وتسجل Studio prompts في console.
- لا يوجد Network-deny test يمنع Provider calls أثناء التطوير المحلي.

---

## 2. النموذج المعياري للـCatalog

العلاقات ثابتة ولا تُختصر إلى شجرة ملكية مضللة:

```text
Publisher → Model Family → Canonical Model

Provider → Provider Account
Provider → Provider Model ↔ Canonical Model
Provider Model → Hosting Endpoint(s)

Provider Route = Provider Account
               + Provider Model
               + Hosting Endpoint or certified endpoint policy
               + Capability/Variant
               + Provider Cost Version
               + Certification
```

مثال توضيحي:

```text
Publisher: OpenAI
Model Family: GPT Image
Canonical Model: GPT Image 1.5
Provider Model: kie/gpt-image/...
Hosting Endpoint: KIE Market endpoint
Provider Route: KIE account + model + endpoint + capability/price/certification
Provider Account: KIE Production Account A
```

### 2.1 كيانات إلزامية

- `Publisher`: صاحب النموذج/العلامة.
- `ModelFamily`: العائلة التي يفهمها المستخدم.
- `CanonicalModel`: تعريف FusionLab المستقر للنموذج.
- `Capability`: image/video/audio/text، input/output schema، constraints.
- `Provider`: KIE أو OpenRouter.
- `ProviderAccount`: الحساب ومفتاحه وحدوده ورصيده وسياسة استخدامه.
- `ProviderModel`: معرف المزود الخام ونسخة Metadata.
- `HostingProviderEndpoint`: المنفذ الفعلي/المستضيف، قدراته وسعره وخصوصيته ومنطقته؛ مهم خصوصاً عندما يمر OpenRouter إلى أكثر من مستضيف للنموذج نفسه.
- `ProviderRoute`: account + model + endpoint أو endpoint policy + capability، مع protocol، sync/async، webhook، SLA، region، cost guard.
- `ProviderCostVersion`: السعر المنشور للمزود بوحدته الأصلية.
- `CustomerPriceVersion`: سعر FusionLab بوحدة Whole Credits.
- `RouteCertification`: أدلة Contract/Finance/Security/Quality/Canary.
- `CatalogSnapshot`: المصدر الخام، وقت الجلب، hash، diff، حالة الموافقة.

### 2.2 فصل طبقات السعر

تعرض شاشة التسعير أربع قيم مستقلة:

1. **Provider Published Rate:** ما يعلنه المزود ووحدته الأصلية.
2. **Provider Actual Cost:** ما أبلغت به العملية الفعلية، مثل `creditsConsumed` أو `usage.cost`.
3. **Internal Cash COGS:** قيمة التكلفة النقدية من Funding Lots/FX/رسوم الحساب.
4. **FusionLab Customer Price:** Whole Credits المقبولة في Quote العميل.

```text
actual generation COGS = provider book cost
                       + paid retries/failures/provider loss
                       + storage/CDN
                       + variable worker/moderation/delivery

operation economic value = consumed credit-lot value + approved subsidy
contribution profit amount = operation economic value - actual generation COGS
contribution margin bps = contribution profit amount
                        / operation economic value × 10,000
```

Payment/FX، fraud/refund reserve، allocated discounts/subsidy وبقية Contribution Cost تعرض منفصلة وفق `FL-PMP-001 §14`؛ لا تسمى قيمة الفرق وحدها Margin.

لا يُسمح بقاعدة «المزود يخصم 2 فنخصم 4» ككود ثابت. يمكن أن تكون النتيجة 4، لكن عبر Customer Price Version منشورة، بينما Actual Provider Cost تسجل منفصلة.

- تحفظ قيمة استخدام المزود الخام كـdecimal string وبوحدتها الأصلية.
- يحول `UsageExtractorVersion` الخاص بكل Route القيمة إلى atomic integer وفق `nativeScale` منشور.
- لا يستخدم IEEE floating-point للمال أو وحدات المزود.
- لا يفترض أن KIE credit أو OpenRouter cost يساوي USD ثابتاً؛ Cash COGS يأتي من Funding Lots/FX/fees/rewards الفعلية.

### 2.3 حالات النشر

Catalog import lifecycle:

```text
DISCOVERED → NORMALIZED → REVIEWED → APPROVED_SNAPSHOT
```

Route certification lifecycle المعياري:

```text
DRAFT → VALIDATED → CANARY → CERTIFIED → PUBLISHED
→ SUSPENDED → RETIRED

certification.scope = LOCAL_TEST_ONLY | PRODUCTION
```

- `DISCOVERED` يظهر في Admin فقط، ولا يعني Route state.
- نجاح fixtures/offline يضيف Evidence label ضمن `VALIDATED` وscope=`LOCAL_TEST_ONLY`، ولا ينشئ state اسمها `OFFLINE_CERTIFIED`.
- `PUBLISHED` وحده يظهر للمستخدم.
- أي SKU أو وحدة سعر مجهولة تجعل Route غير قابلة للنشر.
- تغير Metadata أو سعر المزود ينشئ Draft/Diff ولا يغير السعر الحي صامتاً.

---

## 3. المسار الأول — Admin SaaS الاحترافي

### 3.1 هيكل المعلومات

```text
Overview
├─ Business snapshot
├─ Provider health and balances
├─ Financial exceptions
└─ Approval/action center

Customers
├─ Users
├─ Workspaces and memberships
├─ Subscriptions and trials
├─ Wallet and ledger timeline
└─ Support timeline

Revenue
├─ Plans and entitlements
├─ Pricing Workbench
├─ Credit packages
├─ Payments/refunds
├─ Promotions
└─ Margin analytics

AI Catalog
├─ Providers
├─ Provider accounts
├─ Publishers and model families
├─ Provider models and capabilities
├─ Routes and certifications
└─ Catalog imports/diffs

Operations
├─ Generation history
├─ Queue and orchestration
├─ Reconciliation
├─ Treasury
├─ Assets/delivery
└─ Incidents and kill switches

Governance
├─ Approval inbox
├─ Change sets
├─ Roles and access
├─ Audit log
└─ Secret Manager

Content
├─ Tool cards
├─ Templates/recipes
├─ Banners
└─ Localization
```

### 3.2 مبادئ الواجهة

- أسماء أفعال مفهومة: «غيّر سعر GPT Image» بدلاً من «أنشئ مسودة» وحدها.
- كل شاشة تعرض: الحالة، السبب، التأثير، آخر تعديل، صاحب التعديل، والخطوة التالية.
- Beginner mode يشرح المصطلحات؛ Expert mode يكشف JSON/schema/diff والأدلة.
- Search عام، Filters محفوظة، Bulk actions خاضعة للموافقة، Export مراقب.
- RTL/LTR كامل، Keyboard navigation، contrast وفق WCAG 2.2 AA، وReduced Motion.
- Desktop density قابلة للاختيار، وMobile read/approve آمن بلا إدارة أسرار.

### 3.3 Overview

يحتوي على مؤشرات قابلة للانتقال إلى أصلها:

- Active users/workspaces/subscriptions.
- Gross credit sales، settled customer credits، actual COGS، realized margin.
- Provider balance/health/rate limit/credential expiry.
- نجاح وفشل وP95 latency حسب Provider/Route/Model.
- `SUBMISSION_UNKNOWN` و`COST_UNKNOWN` وUnmatched charges.
- Reconciliation freshness وفرق دفتر العميل/المزود.
- Approvals المتأخرة وIncidents المفتوحة.

لا تعتمد البطاقة على رقم Aggregate بلا رابط إلى العمليات المكونة له.

### 3.4 Providers وModels

شاشة Provider تعرض:

- الحسابات والبيئة والحالة، دون إظهار السر.
- Scopes، limits، balance freshness، آخر catalog sync، webhooks.
- Families/Models/Routes، القدرات، التكلفة المنشورة، واعتماد كل Route.
- زر Suspend/Kill مضبوط السبب والزمن والموافقات.

شاشة Model Catalog تعرض Sort/Filter حسب:

- Provider، Publisher، family، modality، certification، published state.
- تكلفة المزود، سعر FusionLab، هامش متوقع، وصلاحية السعر.
- Model واحد يمكن أن يملك Routes متعددة دون خلط أسماء الشركات.

### 3.5 Pricing Workbench

تكون Wizard من ست خطوات:

1. اختيار Family/Model/Variant/Route.
2. عرض Provider rate card ووحداته ومصدره وتاريخه.
3. محاكاة التكلفة عبر presets واقعية والحد الأعلى.
4. إدخال FusionLab Whole Credits وعرض margin bands.
5. مراجعة Diff وتأثيره على Plans/Quotes القائمة.
6. Maker submit → Checker approve → effective_at publish.

الحواجز:

- لا Floating-point في المال أو Whole Credits.
- لا تعديل In-place؛ كل سعر Version immutable.
- Quote يحفظ نسخة السعر والقدرات والمدة والمخرجات المتوقعة.
- السعر الجديد لا يغير Quote مقبولة لم تنته صلاحيتها.
- حد أدنى للهامش، وحد أعلى للتكلفة، وCurrency/FX snapshot.
- Price rollback يعني نشر Version جديدة، لا حذف التاريخ.

### 3.6 Users وSubscriptions

- User 360: العضويات، الخطة، entitlements، wallet، ledger، operations، support events.
- أي Adjustment مالي عبر سبب، Evidence، idempotency key، maker-checker، وAudit.
- Impersonation إن سُمح به يكون read-only افتراضياً، بوقت محدود وبانر دائم وتدقيق كامل.
- Subscription state machine واضحة؛ لا تخلط Billing status مع Entitlement status.
- حذف المستخدم لا يحذف السجل المالي أو التدقيقي؛ يطبق retention/anonymization وفق السياسة.

### 3.7 Generation History والمصالحة

لكل عملية Timeline واحدة:

```text
Quote → Reservation → Route decision → Dispatch intent → Provider submit
→ Provider events → Verification → Asset ingest → Delivery → Settlement
→ Actual cost → Reconciliation
```

تظهر:

- Correlation IDs بدون أسرار.
- requested model/route وactual provider/model.
- customer credits quoted/reserved/settled/released.
- provider published estimate وactual cost وcash COGS.
- webhook/poll evidence hashes.
- asset status، failure class، retries، operator actions.

Exception queues إلزامية:

- `SUBMISSION_UNKNOWN`
- `PROVIDER_SUCCESS_RESULT_MISSING`
- `PROVIDER_SUCCESS_COST_UNKNOWN`
- `CUSTOMER_SETTLED_PROVIDER_UNMATCHED`
- `PROVIDER_CHARGE_WITHOUT_OPERATION`
- `DELIVERED_WITHOUT_SETTLEMENT`
- `REFUND_EVIDENCE_REQUIRED`

### 3.8 Backend وحدود الثقة

```text
Admin Web
  → Admin BFF/API
      → AuthN/AuthZ/AAL policy
      → Command handlers
      → Approval workflow
      → Domain services
      → Durable repositories/outbox/audit
```

- لا direct Browser-to-table reads/writes لبيانات Admin. القراءة الحساسة تمر عبر BFF projections مع field masking وtenant filters وpagination وexport policy؛ وكل mutation عبر Command workflow.
- لا ثقة بـ`x-admin-actor` أو roles قادمة من العميل.
- Authentication من Session/JWT موثق، وAuthorization Server-side لكل command.
- SUPER_ADMIN لا يتجاوز maker-checker في التغيير المالي أو الأسرار.
- Queries وCommands منفصلة، وكل Command يملك idempotency key وAudit event.
- Writes المالية في Transaction واحدة مع Outbox حيث يلزم.
- Audit append-only ومقاوم للعبث ومخفي منه PII غير الضروري.

### 3.9 Secret Manager

- الواجهة Write-only؛ لا يوجد Reveal للسر بعد الحفظ.
- قاعدة البيانات تخزن `secret_ref` وmetadata فقط؛ القيمة في Vault/KMS مناسب.
- Encryption in transit/at rest، rotation، versioning، expiry، scope، owner، last-used.
- Logs/errors/traces تمنع secret/token/header/body redaction تلقائياً.
- «فحص الاتصال» لا يطلق Generation. يجب أن يكون Metadata/Key-status فقط وبعد تفويض صريح.
- Generation key، Management key، webhook secret، وtreasury access أسرار منفصلة.
- Credential activation يحتاج Maker/Checker وAAL2 وHealth proof غير مدفوع حيث يدعمه المزود.

### 3.10 نموذج التخزين المنطقي

هذه عائلات بيانات مستهدفة وليست تصريحاً بإنشاء Migration الآن:

```text
Identity: users / workspaces / memberships / roles / sessions
Commerce: plans / subscriptions / entitlements / wallets / ledger_entries
Catalog: publishers / families / canonical_models / capabilities
Providers: providers / accounts / provider_models / hosting_endpoints / routes / certifications
Pricing: provider_cost_versions / customer_price_versions / quote_snapshots
Operations: operations / dispatch_attempts / provider_events / result_assets
Finance: provider_usage / cash_cogs / funding_lots / reconciliation_cases
Governance: change_sets / approvals / secret_refs / audit_events / incidents
```

- كل جدول Tenant-aware حيث ينطبق، وله policy وصول Server-side/RLS دفاعية.
- الإصدارات المالية والـCatalog المنشورة append-only.
- Raw provider payloads تحفظ منقحة ومشفرة وبـretention محدد، لا داخل سجلات الواجهة.
- أي Schema فعلي يحتاج ADR وMigration plan وrollback ودليل Gate مستقل وفق `FL-PMP-001`.

---

## 4. المحرك المالي الموحد

### 4.1 حالات العملية

تتبنى هذه الوثيقة `FL-PMP-001 §41.2` و`STM-001` حرفياً؛ لا تنشئ Transition Matrix منافسة:

```text
DRAFT → QUOTED → RESERVED → QUEUED → DISPATCHING
→ SUBMITTED → RUNNING → PROVIDER_SUCCEEDED
→ ASSET_STORED → DELIVERED → SETTLED
```

مسارات الاستثناء المعيارية:

```text
DISPATCHING → SUBMISSION_UNKNOWN
SUBMITTED/RUNNING → PROVIDER_FAILED
PROVIDER_SUCCEEDED → DELIVERY_FAILED
* → RECONCILIATION_REQUIRED
eligible pre-acceptance → CANCELLED
```

حالة Reservation مستقلة:

```text
HELD → SETTLED
HELD → RELEASED
HELD → MANUAL_REVIEW
```

- `DISPATCH_INTENT_PERSISTED` دليل/حدث يسبق Submit وليس Operation state منافسة.
- القيم الخام مثل provider refund/status unknown تحفظ في Provider Event/Attempt؛ وتنتج الانتقال المعياري المناسب المبني على Evidence.
- `VERIFIED` خطوة تحقق، و`INGESTED` يقابل نجاح الانتقال إلى `ASSET_STORED`؛ لا تستبدلان حالات الماستر.
- لا Settlement قبل private ingest، وفحص الملكية/الوصول، والانتقال إلى `DELIVERED`.

### 4.2 الثوابت المالية

- `available + reserved` لا يتغير بسبب Reservation وحدها.
- Settlement لا يتجاوز Reservation/Quote المقبولة مطلقاً؛ تغيير هذا يحتاج Master Change Proposal ولا ينفذ كـTop-up ضمن العملية.
- كل Ledger mutation متوازن وله operation/idempotency/reference/evidence.
- Provider retry لا يعيد Customer debit ولا يعيد Submit غير الآمن.
- Timeout بعد إرسال محتمل = Unknown، وليس Failed.
- Provider success بلا cost أو result = Reconciliation hold، لا افتراض مجاني ولا Settlement.
- حق العميل مستقل عن خسارة المزود: إن دفع النظام للمزود ولم يسلّم نتيجة صالحة، يحرر العميل وفق عقد الماستر وتسجل `Provider Loss` على الشركة.
- `SUBMISSION_UNKNOWN` أو `COST_UNKNOWN` أو `RESULT_MISSING` غير المحسومة تبقي Reservation في `HELD/MANUAL_REVIEW`؛ reconciliation ليست مبرراً للخصم النهائي.
- Customer price يبقى كما في Quote؛ Actual cost تؤثر في COGS/margin لا في خصم رجعي عشوائي.
- منع الرصيد السلبي يطبق Transactionally مع concurrency locking.

### 4.3 الجدار المالي

يتكون من:

- Quote signature + expiry.
- Whole-credit ledger immutable.
- Reserve-before-dispatch.
- provider spend/rate/concurrency caps.
- route max-price/max-duration/max-output guards.
- durable dispatch intent/outbox.
- webhook replay protection وconstant-time verification.
- unknown-state quarantine.
- balance/usage reconciliation.
- alerting + kill switches منفصلة حسب Provider/Account/Route/Model.

---

## 5. المسار الثاني A — تكامل KIE.ai

> نتيجة البحث مبنية على وثائق KIE الرسمية فقط، ومن دون أي API call أو استهلاك كريدت.

### 5.1 العقود الرسمية المستخدمة

- Server-side Bearer authentication فقط.
- Market submit: `POST /api/v1/jobs/createTask` بجسم يتضمن `model` و`input` و`callBackUrl`.
- Task status: `GET /api/v1/jobs/recordInfo?taskId=...`.
- الحالات الطبيعية: `waiting/queuing/generating/success/fail`، وتُحوّل إلى حالات FusionLab دون فقدان القيمة الخام.
- `creditsConsumed` هو الدليل الأساسي للكلفة الفعلية عندما يرجعه المسار.
- Account balance: `GET /api/v1/chat/credit`، ويُستخدم للمصالحة/الخزانة لا لتسعير العميل.
- Webhook HMAC: `Base64(HMAC-SHA256(taskId + "." + timestamp, webhookHmacKey))` مع فحص timestamp وconstant-time comparison ومنع replay. التوقيع يثبت `taskId.timestamp` فقط، ولا يثبت سلامة بقية حقول الجسم.
- Rate limits المعروفة توضع في Account policy، مع polling backoff/jitter لا Browser polling.
- عند تعارض retention بين وثائق المزود، تعتمد المنصة المدة الأقصر والأكثر تحفظاً حتى توضيح موثق.

### 5.2 حزم التنفيذ المستهدفة

```text
KieTransport
KieCatalogSnapshotImporter
KieMarketAdapter
KieVeoAdapter
KieSunoAdapter
KieChatAdapter
KieFileAdapter
KieBalanceClient
KieWebhookVerifier
KieResultNormalizer
KieUsageExtractorVersion
```

وجود Adapter خاص ببروتوكول مختلف لا يعني بناء Engine جديد؛ جميعها تطبق العقود الموحدة:

```text
listModels / quoteCostBasis / submit / getStatus
/ verifyWebhook / normalizeUsage / normalizeResult / cancel(if supported)
```

### 5.3 Catalog KIE

KIE يدعم عائلات تتغير مع الزمن، مثل:

- Images: Seedream، Imagen/Nano Banana، Flux، Grok Imagine، GPT Image، Ideogram، Qwen، Recraft وغيرها.
- Video: Grok، Kling، Seedance، Hailuo، Wan، Runway، Veo، PixVerse وغيرها.
- Audio: ElevenLabs، Gemini TTS، Suno.
- LLM: عائلات GPT/Claude/Gemini/Grok/Codex بحسب توفر KIE.

هذه قائمة Discovery وليست Product Catalog ثابتة. لا تُكتب أسماء الموديلات والأسعار يدوياً في UI. لعدم وجود API رسمي واحد مضمون لكل Catalog/Rate Card، يكون الاستيراد:

1. حفظ Raw snapshot من المصادر الرسمية المسموح بها.
2. تطبيع IDs والقدرات وinput schema وcost unit.
3. إظهار Diff في Admin.
4. مراجعة بشرية للأسعار والـSKU.
5. Certification لكل Route.
6. نشر subset معتمد فقط.

### 5.4 قواعد Submit/Callback/Cost

- كل Adapter يفحص HTTP status وKIE body `code` والحالة معاً؛ أي code/state غير معروف يصبح `PROVIDER_STATUS_UNKNOWN`، ولا يعامل Success أو No-charge.
- Operation وDispatch Intent وcallback correlation تُحفظ قبل محاولة Submit.
- لا نفترض Idempotency عند KIE إن لم توثقه الصفحة الخاصة بالمسار.
- Transport timeout بعد إرسال محتمل ينتج `SUBMISSION_UNKNOWN`.
- لا يعاد Submit تلقائياً في Unknown. إن ضاعت استجابة Submit فلا يوجد `taskId` يمكن Poll به ولا lookup موثق بواسطة idempotency key.
- Recovery ينتظر Verified callback إلى correlation URL؛ إن وصل يستعيد `taskId` ثم يسمح بـrecordInfo polling. إن لم يصل يبقى الحجز معلقاً وتفتح مراجعة KIE logs/balance/manual evidence. لا Poll ولا Retry قبل استعادة `taskId`.
- Callback endpoint عشوائي/موقع، ويقبل الرسالة بعد HMAC + timestamp + replay check فقط.
- Verified callback مجرد Wake-up موثق لـ`taskId`: يحفظ Raw منقحاً في Inbox، ثم **يجب دائماً** أن يجلب worker `recordInfo` بالمفتاح الخادمي قبل Delivery أو Settlement أو Refund أو تسجيل Actual Cost.
- لكل Route/Protocol `UsageExtractorVersion` مستقل؛ Market قد يستخدم `creditsConsumed`، وبعض Chat/LLM flows قد تستخدم `credits_consumed`، ولا يوجد مستخرج KIE عالمي مفترض.
- قيمة الاستخدام الخام تحفظ decimal string ثم تحول إلى atomic integer بواسطة `nativeScale` المثبت لإصدار Route؛ الحقل الغائب/المجهول ينتج `COST_UNKNOWN`.
- Actual usage يحفظ atomically مع terminal provider record والعملية ودليل المصدر.
- Success مع غياب النتيجة أو الكلفة ينتقل إلى exception، لا إلى تسليم/تسوية تلقائية.
- قيمة استخدام صفر لا تثبت No-charge إلا من terminal provider record لحالة fail/refunded، مرتبطة بالـroute/account/task ومحفوظ raw evidence hash. `404 task not found` أو صفر أثناء الانتظار ليس دليلاً.
- Refund يثبت بالدليل النهائي أعلاه أو Refund evidence موثق لذلك Route؛ لا يعمم Code مثل 531 خاص بمسار Suno على كل KIE.
- ملفات النتائج تُسحب Server-side إلى Private Asset Store خلال نافذة retention الآمنة؛ لا تعتمد المنصة على URL المزود كأصل دائم.

### 5.5 readiness الخاص بـKIE

لا يتجاوز Route `VALIDATED` مع `certification.scope=LOCAL_TEST_ONLY` حتى ينجح Offline أولاً:

- Contract fixtures لكل نموذج/variant مستخدم.
- HMAC valid/invalid/expired/replay tests.
- Submit accepted/failed/timeout-before-send/unknown-after-send.
- Actual cost present/zero/missing/malformed.
- protocol-specific usage field/native scale/decimal conversion.
- Result retention/private ingest tests.
- Rate limit/backoff/circuit-breaker tests.
- Financial golden cases وreconciliation cases.

ثم، وبعد موافقة مستقلة صريحة فقط، يتم Metadata/credential validation وCanary محدود بميزانية وقتل تلقائي ضمن `APU-G8` والبوابة المعيارية المقابلة في `FL-PMP-001`.

---

## 6. المسار الثاني B — تكامل OpenRouter

> نتيجة البحث مبنية على وثائق OpenRouter الرسمية فقط، ومن دون أي API call أو استهلاك كريدت.

### 6.1 بروتوكولات OpenRouter المنفصلة

- Chat/general: `/api/v1/chat/completions` عبر JSON أو SSE.
- Images: `/api/v1/images` مع نتيجة base64/stream و`usage.cost` حيث يتوفر.
- Video: `/api/v1/videos` async مع task status/result/webhook.
- TTS: `/api/v1/audio/speech`.
- STT: `/api/v1/audio/transcriptions`.
- Generation audit: `/api/v1/generation?id=...`.
- Key status: `/api/v1/key`.
- Credits/treasury: `/api/v1/credits` ويتطلب صلاحيات/Management Key منفصلة حسب الوثائق.

Video Adapter الموجود حالياً مجرد Fixture-tested بداية محدودة؛ لا يعني أن OpenRouter متكامل أو Certified.

### 6.2 الحزم المستهدفة

```text
OpenRouterTransport
OpenRouterCatalogSnapshotImporter
OpenRouterKeyStatusClient
OpenRouterAccountCreditsClient
OpenRouterGenerationUsageClient
OpenRouterChatAdapter
OpenRouterImageAdapter
OpenRouterVideoAdapter
OpenRouterTtsAdapter
OpenRouterSttAdapter
OpenRouterWebhookVerifier
OpenRouterResultNormalizer
```

### 6.3 Catalog وPricing

المصادر الرسمية المرشحة للاستيراد المصرح لاحقاً:

- `/api/v1/models?output_modalities=all` للفهرسة العامة، وليس وحده سعراً/قدرة نهائية.
- `/api/v1/models/{author}/{slug}/endpoints` للتسعير والقدرة على مستوى General hosting endpoint.
- `/api/v1/images/models`
- `/api/v1/images/models/{author}/{slug}/endpoints` للتسعير والقدرة على مستوى Image endpoint؛ قدرات النموذج العليا Union وليست ضماناً لكل endpoint.
- `/api/v1/videos/models` بما فيها capabilities و`pricing_skus`
- مرشحات speech/transcription الرسمية.

عملية Sync:

```text
Raw JSON + source URL + fetched_at + SHA256
→ normalized draft
→ capability and SKU validation
→ diff
→ maker/checker approval
→ immutable published catalog/cost version
```

السعر ليس رقماً واحداً. يجب دعم وحدات مستقلة مثل:

- input/output/cache/reasoning tokens.
- per request/image.
- per video second أو SKU resolution/duration.
- per audio second/character حسب المسار.
- أي رسوم endpoint/provider إضافية موثقة.

أي SKU مجهولة أو formula غير مكتملة توقف نشر Route. ولا ينشر Route ما لم يرتبط السعر والقدرة بـHosting Endpoint محدد أو Endpoint policy لها Maximum مثبت ومعتمد.

### 6.4 Routing وActual Usage

- يحفظ `requested_model` و`actual_model` و`actual_hosting_provider`.
- `actual_hosting_provider` يأتي من Response/Generation evidence؛ عند غيابه يسجل `UNKNOWN` ولا يستنتج من Route المتوقع.
- يحمل كل Route `cost_guard`: `PROVIDER_MAX_PRICE | PINNED_ENDPOINT_MAX | INTERNAL_CERTIFIED_MAX | UNSUPPORTED`.
- تستخدم provider routing preferences و`max_price` فقط عندما تثبت Capability Matrix دعمها لذلك البروتوكول؛ إرسال حقل غير مدعوم لا يثبت تطبيق الحد.
- Route في `UNSUPPORTED` أو بلا Maximum مثبت لا ينشر.
- `Customer Reservation = accepted Customer Quote exactly`، بينما `Provider Treasury Commitment = maximum certified cost across allowed fallbacks`. اختلاف fallback لا يرفع Customer Hold.
- `usage.cost` وGeneration audit هما مدخل Actual COGS؛ لا يغيران Customer Quote المقبولة.
- Zero Completion Insurance سياسة مفيدة، لكنها لا تكفي وحدها لـ`CONFIRMED_NO_CHARGE`؛ يسجل Actual usage/cost evidence للعملية.
- Responses النصية/inline/base64 تتحول إلى Result contract موحد، والوسائط تُخزن خاصاً.
- Retry-After وHTTP classes وstream disconnect وpartial usage حالات مستقلة في Adapter.
- لا تفترض المنصة Submit idempotency غير موثق.
- Webhook video يقرأ `X-OpenRouter-Signature: t=<unix_seconds>,v1=<64-hex>`، ويبني signed bytes من UTF-8(`${timestamp},`) متبوعاً حرفياً بـraw request-body bytes، ثم يتحقق بـHMAC-SHA256 عبر workspace signing secret وtiming-safe comparison ويرفض `|now-t| > 300s`.
- يجب أن يساوي `X-OpenRouter-Idempotency-Key` القيمة `<data.id>-<data.status>`، مع Unique Inbox constraint لمنع replay.
- تربط المنصة generation ID/model/result URL بالعملية المتوقعة وتحفظ raw evidence hash بعد التنقيح؛ أي اختلاف يصبح reconciliation/security event.

### 6.5 إعداد حساب OpenRouter في Admin

تكون الحقول منفصلة ومفسرة:

- Generation API Key + spend limit.
- Allowed modalities/models/providers.
- Management Key عند الحاجة لإدارة credits، ولا يُطلب افتراضياً.
- Catalog sync permission.
- Treasury mode: disabled / read-only / full حسب الحاجة والموافقة.
- Webhook secret/configuration.
- Environment، budgets، rate limits، max concurrency.

تعرض الحدود كقيم مستقلة:

- Provider-side key limit من `/api/v1/key`: `VERIFIED/UNVERIFIED` مع `limit/limit_remaining` الملاحظين.
- OpenRouter account credits/balance من صلاحية الخزانة المناسبة.
- FusionLab internal budget/circuit breaker، وهو لا يثبت أن Cap طبق لدى المزود.

الحساب الذي لم يثبت Provider-side cap لا يصبح `Ready` إلا عبر Risk Exception صريحة ومحدودة.

لصق Generation Key وحده لا يعني اكتمال Treasury أو Catalog أو Webhooks. تعرض UI Checklist: `Draft → Credential stored → Metadata verified → Offline validated (LOCAL_TEST_ONLY) → Canary approved → Certified/Published (PRODUCTION)`.

### 6.6 readiness الخاص بـOpenRouter

- Contract fixtures لكل protocol.
- SSE disconnect/duplicate/final usage tests.
- Image inline/base64 validation.
- Video async/webhook/unknown-submit tests.
- TTS/STT binary/multipart/error tests.
- pricing formula golden tests لكل unit/SKU.
- requested-vs-actual route audit.
- max-price/fallback/rate-limit tests.
- usage/generation reconciliation and unknown-cost tests.
- Canary matrix definition لكل Candidate Route وكل billable SKU/variant مؤثر وحدود تمثيلية؛ تجربة واحدة لا تعتمد البروتوكول كله.

---

## 7. المسار الثالث — تجربة المنصة وCreative Space

### 7.1 المبادئ

- منتج واحد، Domain Graph واحد، وOperation Engine واحد.
- المستخدم المبتدئ يرى Standard Assisted View؛ المحترف يستطيع Node/Advanced View دون تغيير البيانات.
- توليد الوسائط يتم فقط من Published + Certified models.
- الواجهة تعرض السعر النهائي قبل Generate وحالة الحجز/الإطلاق بوضوح.
- لا اتصال بالمزود من Browser، ولا secret، ولا business pricing formula في bundle.

### 7.2 App Shell

```text
Top Bar: project / autosave / undo-redo / collaborators / export
Left Rail: create / assets / templates / history / project settings
Canvas: bounded graph workspace
Right Inspector: selected asset/node properties
Prompt Composer: contextual generation controls
Bottom Status: uploads / operations / credits / exceptions
```

على Mobile تتحول Inspector/Composer إلى Bottom Sheets ودون ازدواج state.

### 7.3 Prompt Composer

الاستلهام من Higgsfield **وظيفي فقط**: إظهار الضوابط المناسبة للنموذج المختار، دون نسخ التصميم أو الأصول.

المكونات:

- intent/recipe picker.
- provider-agnostic model family picker.
- prompt textarea مع history/variables.
- reference assets ودور كل مرجع.
- Dynamic controls من Capability Schema: ratio، resolution، duration، frames، sound، seed…
- Simple/Advanced toggle.
- live quote: Customer credits، المتوقع، ما يدخل/يخرج.
- Generate CTA بحالات disabled/quoting/reserving/submitting/unknown/running.

العرض المرجعي Desktop `360–420px` وقابل للطي، مع ضبط Responsive حسب المساحة لا حسب رقم ثابت فقط.

### 7.4 سلوك العملية للمستخدم

- عند Generate يعرض UI Quote المقبولة ورقم Operation.
- `SUBMISSION_UNKNOWN` لا يعرض Failure مضلل أو يعيد الخصم؛ يعرض «جارٍ التحقق، لا تعِد الإرسال».
- Progress مبني على provider events الفعلية، لا animation وهمي يوحي بنسبة دقيقة.
- Failure يشرح هل تم Release أم بقيت العملية للمراجعة.
- Result لا يعتبر Delivered حتى Private ingest وصلاحية العرض.
- History واحدة من Studio وCreative Space وAudio/Video.
- exhausted credits/subscription/payment gating يشرح السبب والإجراء المتاح قبل أي Reservation، بلا submit مخفي.
- Prompt history مشفرة ومحددة retention ويمكن حذفها وفق السياسة؛ لا تدخل logs أو analytics الخام.
- Autosave يحفظ project/domain graph بإصدارات، مع offline/reconnect وconflict recovery واضحة.
- Collaboration permissions تطبق على القراءة والتعديل والتوليد والأصول، ولا تعتمد UI visibility وحدها.

### 7.5 Design System والجودة

- Tokens موحدة للألوان/المسافات/typography/radius/elevation/motion.
- animations سريعة عادة `150–220ms` مع reduced-motion.
- Skeletons بدل layout jumps، وoptimistic UI فقط للأفعال غير المالية.
- Virtualization للقوائم الكبيرة وlazy loading للأصول.
- keyboard shortcuts موثقة، focus visible، screen-reader labels.
- RTL/LTR، Arabic/English content expansion، وعرض أرقام/عملات مضبوط.
- الأداء المستهدف يقاس على جهاز متوسط لا جهاز المطور فقط.

### 7.6 تفكيك الصفحات الكبيرة

تُقسم الصفحات إلى:

```text
feature shell
├─ route loader/query
├─ command hooks
├─ view model
├─ presentational sections
├─ state machine
└─ contract/e2e tests
```

يُمنع نسخ pricing/provider/operation logic إلى Component جديد أثناء إعادة التصميم.

---

## 8. سياسة Provider For Test

القرار المرحلي:

1. يُعاد تعريفه داخلياً باسم **Development Simulator**.
2. يُخفى من Catalog التجاري وAdmin الخاص بالحسابات الحقيقية.
3. لا يمكن نشره أو اختياره في Production أو في Product Model picker.
4. تبقى Fake transports وfixtures وclock/webhook/replay/unknown-state scenarios للاختبارات.
5. تُستخرج منه أي خدمة عامة إلى Provider-neutral Engine.
6. بعد نجاح KIE/OpenRouter offline validation وإتمام Canary/Certification المصرح، يزال Adapter المحلي من Runtime wiring.
7. تبقى Fixtures في test packages دائماً؛ حذف وسيلة الاختبار ليس هدفاً.

شروط إزالة Runtime المحلي:

- لا import له من app composition production.
- كل السيناريوهات المالية تعمل بـfixtures مستقلة.
- KIE/OpenRouter contracts تغطي success/failure/unknown/refund/cost/replay.
- network-deny suite تمر بلا أي خروج شبكي.
- product catalog لا يحتوي `local` route.

---

## 9. ترتيب التنفيذ والبوابات

لا تعمل المسارات الثلاثة كجزر. الترتيب أدناه هو المسار الهندسي الملزم.

الرموز `APU-G0..APU-G8` بوابات داخل هذا البرنامج فقط، ولا تعيد ترقيم Gates المعيارية في `FL-PMP-001` ولا تتجاوز حالة `GATE 0 HOLD` الحالية. الانتقال الخارجي يحتاج أيضاً اجتياز البوابة المعيارية المقابلة.

### APU-G0 — Freeze وEvidence Baseline

**الحالة الحالية:** `LOCAL IMPLEMENTATION COMPLETE — لا يغيّر قرار Gate 0 HOLD`.

**الهدف:** منع أي استنزاف وإثبات نقطة البداية.

الأعمال:

- تثبيت scope وRTM وrisk register وowners.
- إضافة Network-deny في الاختبارات والتشغيل المحلي.
- جرد كل generation/pricing/catalog/credential paths.
- منع prompt/secret logging وتنظيف ما يخرق ذلك.
- توثيق P0 KIE وAdmin trust findings كتذاكر قابلة للتتبع.
- حفظ baseline للاختبارات والبناء دون تغيير قاعدة أو Production.

**الخروج:** لا اتصال Provider ممكن في الاختبار، ولا P0 مجهول الملكية.

### APU-G1 — Canonical Domains وProvider-neutral Engine

**الحالة الحالية:** `LOCAL IMPLEMENTATION COMPLETE — لا يعني اعتماد أي Route أو Provider`.

**الهدف:** عقل مركزي واحد قبل بناء الشاشات.

الأعمال:

- تثبيت Catalog taxonomy والـIDs.
- توسيع Provider contracts للقدرات والنتائج والكلفة والأحداث.
- تثبيت Operation state machine وUnknown semantics.
- تثبيت Quote/customer price/provider cost contracts.
- Durable repository/outbox/inbox interfaces.
- استخراج الاعتماد على LocalMock من service composition.

**الخروج:** كل Test Fixtures تمر عبر نفس Engine contracts، بلا كود KIE/OpenRouter داخل Business core.

### APU-G2 — Admin Foundation

**الحالة الحالية:** `IN PROGRESS — أُغلق محلياً مصدر الثقة بالـbrowser headers، وبقيت الديمومة والهوية الإنتاجية وواجهات الأوامر المؤهلة لاحقة`.

**الهدف:** Shell وBackend آمنان ودائمان.

الأعمال:

- Admin BFF/API، verified identity، RBAC/ABAC، AAL2.
- durable approvals/change sets/audit repositories.
- Design System وnavigation والبحث والـaction center.
- إزالة الثقة بالـbrowser headers والكتابة المباشرة للجداول.
- route protection واختبارات privilege escalation.

**الخروج:** Admin read-only shell يعمل على بيانات حقيقية محلية، وكل command محمي ومُدقق.

### APU-G3 — Catalog وSecret Manager وProviders

**الحالة الحالية:** `IN PROGRESS — كاتالوغ engine محلي وread-only inventory مكتملان؛ لا import أو Secret أو publish أو اتصال مزود`.

**الهدف:** الإدارة الواضحة لـPublisher/Model/Provider/Route/Credential.

الأعمال:

- Catalog schema وsnapshot/diff/publish workflow.
- Provider/Account/Model/Route screens.
- write-only credential references وrotation metadata.
- capability-driven forms وroute certification evidence.
- عزل Development Simulator من Product Catalog.

**الخروج:** يمكن إعداد حساب مزود في Draft بلا Secret leakage وبلا API call.

### APU-G4 — Pricing وFinance وReconciliation

**الهدف:** إغلاق دائرة الكريدت والكلفة والربح.

الأعمال:

- Pricing Workbench والإصدارات والموافقة.
- unified quote/reservation/settlement integration.
- actual provider cost وcash COGS/funding lots.
- User 360 wallet/ledger.
- Generation history والتسويات وexception queues.
- financial kill switches وbudgets.

**الخروج:** كل golden financial case متوازن وقابل للتتبع من UI إلى Ledger.

### APU-G5 — KIE Offline Integration

**الحالة الحالية:** `LOCAL OFFLINE PASS — VALIDATED + LOCAL_TEST_ONLY فقط؛ لا KIE API call أو credential أو route published أو Canary`.

**الهدف:** تكامل كامل من Fixtures موثقة، بلا KIE call.

الأعمال:

- transports/adapters/catalog snapshots/webhook verifier.
- تصحيح P0: unknown submit، actual cost، refund evidence، durable intent.
- private ingest وcallback inbox/recovery.
- Admin readiness checklist.

**الخروج:** KIE contract suite كاملة وRoute في `VALIDATED` مع `scope=LOCAL_TEST_ONLY` فقط؛ لا `CERTIFIED/PUBLISHED` ولا Production readiness.

### APU-G6 — OpenRouter Offline Integration

**الحالة الحالية:** `LOCAL OFFLINE PASS — VALIDATED + LOCAL_TEST_ONLY فقط؛ لا OpenRouter API call أو credential أو route published أو Canary`.

**الهدف:** Chat/Image/Video/TTS/STT خلف العقود الموحدة، بلا Provider call.

الأعمال:

- adapters لكل protocol وcatalog/pricing importer.
- usage/generation reconciliation.
- routing/max-price/actual-provider audit.
- credential/management/treasury separation.

**الخروج:** OpenRouter contract suite كاملة وRoutes في `VALIDATED` مع `scope=LOCAL_TEST_ONLY` فقط؛ لا `CERTIFIED/PUBLISHED`.

### APU-G7 — Platform وCreative Space UX

**الحالة الحالية:** `LOCAL OFFLINE PASS — flows مكتملة ضد Provider For Test/Fixtures فقط؛ لا Route تجاري ولا Provider API call أو Deploy`.

**الهدف:** تحويل العقود المستقرة إلى تجربة موحدة.

الأعمال:

- App Shell، Prompt Composer، capability controls.
- unified history/asset browser/operation feedback.
- Standard/Advanced views وMobile sheets.
- Arabic/English، accessibility، performance، responsive E2E.
- إيقاف Legacy write paths بعد parity evidence.

**الخروج:** المستخدم يكمل flows كاملة ضد Simulator/Fixtures بلا شبكة ولا مال.

### APU-G8 — External Validation وControlled Cutover

**هذه البوابة غير مصرح بها ضمن العمل الحالي.** تبدأ بقرار مكتوب منفصل يحدد المزود والحساب والميزانية والوقت، وبعد سماح البوابات المعيارية في الماستر بلان.

الترتيب عند التصريح:

1. تدوير/إنشاء مفاتيح جديدة محدودة الصلاحية والإنفاق؛ لا استعمال أسرار المحادثة.
2. حفظها عبر Secret Manager فقط.
3. Metadata/key-status validation غير مولد حيث يدعم المزود.
4. Catalog snapshot + diff + approval.
5. Canary صغير لكل Candidate Route ولكل billable SKU/variant مؤثر مع representative boundary cases وspend cap؛ لا يعتمد Canary واحد بروتوكولاً أو عائلة كاملة.
6. مقارنة Quote/Reservation/Provider cost/Result/Settlement/Reconciliation.
7. شهادة Finance + Security + Engineering.
8. نشر تدريجي route-by-route مع kill switch.
9. إزالة Development Simulator من Product Runtime بعد استقرار المسارات.

**الخروج:** لا Route تجاري بلا أدلة Canary ومصالحة وتوقيعات البوابة.

### 9.1 الربط بالبوابات المعيارية والأدلة

`APU-G*` لا تعني أن Master Gate اجتيزت. كل قرار يسجل `LOCAL PASS | HOLD | REJECTED`، و`LOCAL PASS` لا يمنح سلطة Migration/Provider/Production.

| بوابة البرنامج | المتطلبات/الربط المعياري الأدنى | مالك الدليل | الموافقون الأدنى | دليل الخروج |
|---|---|---|---|---|
| `APU-G0` | Master Gates 0–1 | Release + Security | Product + Security + Engineering | inventory، RTM، network deny، P0 owners |
| `APU-G1` | Master Gate 2؛ ويحترم عقود 3–5 | Architecture/Engine | Security + Finance + Data | ADR/API/Event/STM contracts + tests |
| `APU-G2` | Master Gate 2 وlocal preparation لـGate 8 | Admin Platform | Security + Product | identity trust، RBAC، command/audit tests |
| `APU-G3` | Master Gates 1، 2، 4، 8 | Catalog/Platform | Security + Finance | catalog snapshots، secret refs، route drafts |
| `APU-G4` | Master Gates 3، 4، 6/7، 8 | Finance Systems | Finance + Security + Engineering | ledger/pricing/reconciliation evidence |
| `APU-G5` | Master Gates 3–6 | Provider Integration | Finance + Security + Operations | KIE offline contract pack |
| `APU-G6` | Master Gates 3–7 | Provider Integration | Finance + Security + Operations | OpenRouter offline contract pack |
| `APU-G7` | Master Gates 9–11 وبقية dependencies | Product Design + Frontend | Product + Security + Accessibility reviewer | journey/a11y/performance/E2E evidence |
| `APU-G8` | Master release/certification gates بحسب Route | Release Manager | كامل `RACI-001` بما فيه Product/Finance/Security/Operations/Legal عند اللزوم | limited canary، reconciliation، rollback، signatures |

كل Evidence artifact يحمل version/hash/date/owner/reviewers/decision وروابط الاختبارات. لا تكفي لقطة شاشة أو عبارة «يعمل».

### 9.2 قيد المتانة في الوضع المحلي الحالي

حظر Migration الحالي يعني:

- يسمح بتصميم schemas/contracts/repositories وin-memory/fixture reference adapters فقط.
- لا تعتبر Approvals/Audit/Secrets/Ledger/Operations `Durable` لمجرد نجاح الذاكرة المحلية.
- تبقى أي `APU-G` يتطلب persistence/RLS/transactions في `HOLD` حتى يصدر إذن Schema/Migration مناسب وفق الماستر.
- عند الإذن، يطبق Expand→Backfill→Verify→Shadow→Cutover؛ لا تغير هذه الوثيقة قرار «لا Migration الآن».

---

## 10. مصفوفة الاختبار الإلزامية

### 10.1 المال

- property tests لتوازن Ledger.
- concurrent reservations/settlements/idempotency replay.
- quote expiry/version pinning.
- provider estimate vs actual cost vs customer debit.
- zero/missing/late/malformed cost.
- refund evidence حسب Route.
- funding lot/FX/fees/margin calculations بأعداد صحيحة/decimal آمن.

### 10.2 التنفيذ

- timeout before send / after possible send.
- duplicate callback، out-of-order event، replay، forged signature.
- provider success missing result/cost.
- network partition وprocess restart بعد كل transition.
- rate limit/Retry-After/backoff/circuit breaker.
- asset URL expiration، origin validation، private ingest failure.

### 10.3 الأمن

- browser header forgery وrole escalation.
- tenant isolation/RLS/API authorization.
- CSRF/XSS/SSRF/path traversal/upload abuse.
- secret leakage في HTML/JS/log/trace/error/export.
- maker=checker denial، AAL downgrade، expired session.
- audit immutability وPII redaction.

### 10.4 Admin/UX

- Pricing Wizard E2E وimpact preview/approval/rollback-as-new-version.
- provider/model filters والتصنيف Publisher vs Provider.
- User 360 وledger drill-down.
- unified operation timeline/exception action.
- RTL/LTR، keyboard، screen reader، WCAG 2.2 AA.
- mobile/tablet/desktop visual regression.
- large catalog/history virtualization and performance.

### 10.5 Network-deny

CI/local test environment يمنع DNS/HTTP الخارجي افتراضياً. تسمح Fixtures بـlocalhost/in-process فقط. أي محاولة نحو `api.kie.ai` أو `openrouter.ai` تفشل الاختبار فوراً وتنتج Evidence.

---

## 11. الأمن والتشغيل

### 11.1 RBAC المقترح

- `SUPPORT_VIEWER`: قراءة Customer timeline المنقحة.
- `SUPPORT_OPERATOR`: عمليات دعم غير مالية محدودة.
- `CATALOG_EDITOR`: Draft catalog/model changes.
- `PRICING_MAKER` / `PRICING_APPROVER`: اقتراح السعر والموافقة عليه بشخصين مختلفين.
- `FINANCE_MAKER` / `FINANCE_APPROVER`: التعديلات/التسويات الاستثنائية والموافقة المنفصلة.
- `ROUTE_MAKER` / `ROUTE_APPROVER`: إعداد Route/Certification ونشرها منفصلان.
- `SECURITY_MAKER` / `SECURITY_APPROVER`: credential/policy/rotation actions منفصلة.
- `CONTENT_EDITOR` / `CONTENT_PUBLISHER`: تحرير المحتوى ونشره منفصلان.
- `PROVIDER_OPERATOR`: صحة الحساب/route والعمليات.
- `AUDITOR`: قراءة evidence دون mutation.
- `PLATFORM_ADMIN`: تشغيل عام ضمن حدود الفصل.

لا Role منفردة تملك إضافة Secret ونشر Route وتغيير السعر وإجراء Adjustment والتصديق على نفسها.

### 11.2 Kill switches

مستويات مستقلة:

- global generation.
- provider.
- provider account.
- protocol/route.
- canonical model/variant.
- new quotes فقط أو submit فقط.
- auto-retry/reconciliation workers.

كل Switch يملك reason/actor/timestamp/expiry/approval/audit، ولا يمحو العمليات القائمة.

### 11.3 Observability

- structured events بلا prompt/secret/PII غير لازم.
- metrics حسب route/account/model/state.
- traces تربط operation/dispatch/provider event/asset/ledger دون إدراج payload حساس.
- SLOs: quote latency، submit acknowledgement، completion freshness، reconciliation lag، webhook processing.
- alerts مبنية على نسبة/ميزانية/فترة، لا على ضجيج كل failure منفرد.

---

## 12. ما يُحذف وما يُحتفظ به

### يُحذف أو يُغلق بعد وجود البديل

- جميع Browser direct mutations إلى Pricing/Catalog/Content/Storage/Finance؛ تستبدل بـBFF commands وsigned upload intents حيث يلزم.
- browser-provided admin identities/roles/AAL.
- plaintext in-memory credential store.
- duplicate client-side pricing engines والفallback prices.
- KIE-specific business flow خارج Provider adapter.
- product/runtime bindings إلى Provider For Test.
- fragmented generation histories.
- prompt/secret console logging.
- أي hardcoded model list تُعامل كمصدر الحقيقة.

### يُحتفظ به ويُعاد استعماله

- immutable ledger/version/maker-checker concepts بعد جعلها Durable.
- provider-neutral orchestration contracts بعد توسيعها.
- fixtures وفحوص HMAC/unknown states.
- Domain Graph وxyflow adapters.
- private asset pipeline contracts.
- Legacy screens كمصدر parity requirements، لا كمسار كتابة نهائي.

الحذف يتم عبر Strangler + parity evidence + rollback، وليس دفعة واحدة.

---

## 13. مخرجات البرنامج

### Architecture وGovernance

- ADRs للـCatalog taxonomy، provider adapter، money units، secrets، identity trust، unknown state.
- RTM محدث يربط كل مطلب/خطر/اختبار/Gate.
- threat model وdata flow وRACI وrunbooks.

### Backend

- Admin BFF/API + durable repositories.
- unified Catalog/Pricing/Operation/Ledger/Reconciliation services.
- KIE/OpenRouter adapters وحزم fixtures.
- webhook inbox/outbox/private ingest/exception queues.

### Frontend

- Admin SaaS shell وكل الوحدات المذكورة.
- Pricing Workbench، Provider/Model Catalog، User 360، Generation Timeline.
- Secret Manager UX.
- Creative Space shell وPrompt Composer وUnified History.

### Evidence

- local network-deny report.
- financial golden/property/concurrency results.
- security/RBAC/secret tests.
- accessibility/performance/visual E2E.
- provider offline validation packs (`scope=LOCAL_TEST_ONLY`).

---

## 14. Definition of Done

يعتبر البرنامج مكتملاً فقط عندما:

1. لا يوجد مسار توليد يتجاوز `Quote→Reserve→Queue→Dispatch→Provider Verify→Private Ingest→ASSET_STORED→DELIVERED→Reconcile→Settle`.
2. لا توجد قراءة حساسة أو mutation إدارية مباشرة من Browser إلى الجداول/Storage؛ تمر عبر BFF/Commands والسياسات.
3. كل Admin command موثق، مصرح، idempotent، ومدقق.
4. Publisher/Model/Provider/Route منفصلة وتظهر بوضوح للمشغل.
5. `final customer debit ⇔ confirmed valid delivery`. حالات `SUBMISSION_UNKNOWN/COST_UNKNOWN/RESULT_MISSING` غير المحسومة تبقى `HELD/MANUAL_REVIEW` وليست debit؛ وجود reconciliation case وحده لا يبرر Settlement.
6. كل Provider charge مرتبط بعملية أو exception queue.
7. actual provider cost لا يختلط بسعر العميل.
8. KIE وOpenRouter ينجحان في العقود Offline، ثم Canary مصرح لكل Candidate Route وكل billable SKU/variant مؤثر قبل النشر.
9. لا Secret في Git/browser/logs، والمفاتيح محدودة وقابلة للدوران والإيقاف.
10. Creative Space وAdmin يمران في Backend ومحرك واحد.
11. Simulator غير ظاهر تجارياً وغير موصول بـProduction Runtime.
12. كل Legacy direct mutation، بما فيها Content publishing وStorage، مغلقة بعد parity evidence؛ الرفع عبر signed intent والنشر عبر command workflow.
13. Reconciliation وalerts وkill switches مجربة.
14. RTL/LTR وaccessibility وresponsive/performance gates ناجحة.
15. يوقع كامل أصحاب الصلاحية في `RACI-001` وGate المعيارية، بما فيهم Product/Finance/Security/Engineering/Operations/Legal حيث يلزم، ولا يوجد P0/P1 مانع.

---

## 15. المحظورات الحالية

- `PROHIBITED`: أي KIE/OpenRouter Generation أو API call في مرحلة المراجعة الحالية.
- `PROHIBITED`: استعمال Tokens سبق إرسالها في محادثة أو وضعها في `.env`/Git.
- `PROHIBITED`: Migration/Supabase/Vercel/Deploy/Production change.
- `PROHIBITED`: حذف Provider For Test قبل نقل الاختبارات وعزل Runtime.
- `PROHIBITED`: اعتبار Fixture certification دليلاً على Production readiness.
- `PROHIBITED`: نشر كل Model مكتشف تلقائياً.
- `PROHIBITED`: Refund أو Release مبني على نص خطأ غير موثق.
- `PROHIBITED`: Retry تلقائي لعملية `SUBMISSION_UNKNOWN`.
- `PROHIBITED`: تخزين Secret قابل للاسترجاع من Admin UI.

---

## 16. المصادر الرسمية التي بُنيت عليها المراجعة

### KIE.ai

- [KIE Documentation](https://docs.kie.ai/)
- [KIE llms.txt documentation index](https://docs.kie.ai/llms.txt)
- [Get task detail](https://docs.kie.ai/market/common/get-task-detail)
- [Get account credits](https://docs.kie.ai/common-api/get-account-credits)
- [Webhook verification](https://docs.kie.ai/common-api/webhook-verification)
- [KIE pricing](https://kie.ai/pricing)

### OpenRouter

- [Authentication](https://openrouter.ai/docs/api_reference/authentication)
- [Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)
- [General model endpoints](https://openrouter.ai/docs/api/api-reference/endpoints/list-endpoints)
- [Image models](https://openrouter.ai/docs/api/api-reference/images/list-image-models)
- [Image model endpoints](https://openrouter.ai/docs/api/api-reference/images/list-image-model-endpoints)
- [Image generation](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [Text-to-speech API](https://openrouter.ai/docs/api/api-reference/speech/create-audio-speech)
- [Speech-to-text API](https://openrouter.ai/docs/api/api-reference/transcriptions/create-audio-transcriptions)
- [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [Video generation](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)
- [Current key and observed limits](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
- [Remaining credits](https://openrouter.ai/docs/api/api-reference/credits/get-credits)
- [Generation details](https://openrouter.ai/docs/api/api-reference/generations/get-generation)
- [Zero Completion Insurance](https://openrouter.ai/docs/guides/features/zero-completion-insurance)

### UX reference

- [Higgsfield Canvas introduction](https://higgsfield.ai/canvas-intro)
- [Higgsfield model-aware generation controls](https://higgsfield.ai/academy/courses/cinema-studio-complete-tour/video-generation)

هذه المصادر Inputs لعقود التنفيذ وليست بديلاً عن Snapshot مؤرخ وCanary معتمد عند `APU-G8` والبوابة المعيارية المقابلة.
