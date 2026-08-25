# FusionLab — AI Gateway / Model Control Plane: خطة إعادة البناء والتكامل الحقيقي

> **Document ID:** `FL-AGCP-001`  
> **الإصدار:** `1.0.0`  
> **التاريخ:** 22 أغسطس 2026 — Asia/Baghdad  
> **الحالة:** `PROPOSED — IMPLEMENT ONLY AFTER EXPLICIT ADOPTION`  
> **النطاق:** تطوير محلي فقط؛ لا مفاتيح مزودين، لا توليد حقيقي، لا Deploy، ولا Migration/Production.  
> **مصدر القرار:** مراجعة مستقلة للمحرك الحالي، Admin V2، ووثائق KIE.ai وOpenRouter الرسمية.  
> **العلاقة بالخطط السابقة:** وثيقة مستقلة تنظّم إعادة بناء التكامل وAdmin. لا تلغي `FL-PCP-002` تلقائياً؛ عند اعتمادها تصبح مرجعاً تنفيذياً أعلى لمسار AI Gateway، وتبقى الأدلة السابقة صالحة فقط حيث لا تتعارض معها.

---

## 1. القرار التنفيذي

لا نُكمل تلميع واجهة Admin الحالية ولا نفعّل KIE/OpenRouter الآن.  
المسار الصحيح هو بناء **AI Gateway / Model Control Plane** واحد يجعل الكتالوج، الحساب، المسار، التكلفة، السعر، والظهور في Creative Space أجزاءً من قرار نشر واحد قابل للتدقيق.

```text
Official reference sources
  → immutable reference catalog
  → provider account + write-only credentials
  → read-only connection verification
  → account availability
  → inactive route candidate
  → provider cost formula + customer-price simulation
  → maker/checker approval
  → atomic release bundle
  → published offer catalog
  → Creative Space + Durable Generation V2 + financial reconciliation
```

**المفتاح لا يفعّل موديلات ولا أسعاراً.** إدخال المفتاح وفحصه بنجاح يعني فقط أن حساب المزود `CONNECTED`. الموديل لا يظهر للمستخدم إلا كـ`PUBLISHED OFFER` بعد اكتمال كل البوابات أعلاه.

---

## 2. الحكم على الوضع الحالي

### ما يحتفظ به المشروع

- أساس Durable Generation V2: الحجز، idempotency، outbox، حالات القبول المجهول، reconciliation، وتاريخ العمليات.
- أساس Commercial Engine: فصل السعر عن الكلفة وتجميد نسخة العرض عند الـQuote.
- أساس Governance: RBAC، AAL2، Change Sets، maker/checker، وسجل تدقيق.
- عقود Offline أولية لـKIE وOpenRouter، يجب تطويرها لا إعادة اختراع المحرك فوقها.

### ما لا يجوز اعتباره جاهزاً

| المجال | الحالة الفعلية | قرار الخطة |
|---|---|---|
| KIE وOpenRouter في Runtime | غير مسجلين كمزودين تشغيليين | لا تفعيل قبل Provider Runtime Gate |
| اختبار API Key | تحقق شكلي في الذاكرة، لا اتصال حقيقي | استبداله بفحص read-only رسمي |
| Secret Manager | ذاكرة محلية/غير دائمة | استبداله بخزنة أسرار write-only وreferences دائمة |
| Admin Catalog/Pricing | Snapshots وMaps غير موصولة بالـQuote/Runtime | استبدالهما بـControl Plane وRelease Bundle |
| Active/Inactive | ليس lifecycle حقيقياً | بناء lifecycle صريح للموديل والعرض |
| Creative Space | Recipes/Modes محلية ثابتة | جعله consumer لـPublished Offer Catalog فقط |
| Webhook/Assets | تحتاج أدلة durable وتقوية gateway | لا تسوية مالية مباشرة من callback |

### فجوة مركزية يجب إغلاقها أولاً

يوجد اليوم أكثر من مصدر حقيقة: `ProviderRouteCatalog` و`Commercial Registry` وAdmin runtime maps. لا يجوز ربط أي Provider حقيقي حتى يحل **Release Bundle ذري** محل هذا التشتت؛ النشر يجب أن يبدّل Runtime Registry وCommercial Registry وPublished Offer Catalog معاً أو لا يبدّل أيّاً منها.

---

## 3. المبادئ غير القابلة للتفاوض

1. **مسار توليد واحد:** المتصفح لا يتصل بأي Provider؛ كل تنفيذ يمر عبر Durable Generation V2.
2. **لا أرقام مخترعة:** تكلفة مجهولة ليست صفراً، وفشل مزود لا يساوي تلقائياً عدم خصم.
3. **لا إعادة إرسال عمياء:** timeout/500 بعد POST يتحول إلى `SUBMISSION_UNKNOWN` ثم reconciliation، لا retry ولا refund تلقائي.
4. **لا أسرار في قاعدة بيانات أعمال أو API قراءة أو logs:** تخزن `credentialReference` فقط؛ السر write-only.
5. **Webhook إشارة وليس تسوية:** يتحقق من raw body والتوقيع والوقت، يدخل Inbox دائم unique، ثم يجلب العامل الحالة الرسمية إن أمكن.
6. **Reference لا يعني Available ولا Active:** هذه ثلاث حالات منفصلة.
7. **السعر الرسمي، كلفة المزود الفعلية، Cash COGS، وسعر العميل طبقات مستقلة.**
8. **لا نشر جزئي:** كل أمر إداري قابل للتدقيق، idempotent، يحمل reason وintent hash، ويحتاج maker/checker حيث يلزم.
9. **English-first:** واجهة إنجليزية مستقلة LTR في المرحلة الأولى؛ العربية RTL مستقلة لاحقاً، بلا مزج داخل شاشة واحدة.
10. **لا استدعاءات Provider حقيقية قبل Gate خارجي وموافقة صريحة وميزانية Canary محددة.**

---

## 4. نموذج النظام المستهدف

### 4.1 كيانات مستقلة

| الكيان | وظيفته | لا يجوز خلطه مع |
|---|---|---|
| `ReferenceModel` | تعريف رسمي مرجعي للموديل وقدراته | حساب المستخدم أو سعر FusionLab |
| `ProviderAccount` | حساب مزود مستقل وسياساته وحالته | الموديل المرجعي |
| `CredentialReference` | مرجع secret/version/state فقط | قيمة المفتاح |
| `AccountAvailability` | دليل توفر endpoint/model للحساب | تفعيل العرض للمستخدم |
| `RouteCandidate` | Model + Account + protocol + endpoint + adapter | سعر العميل أو النشر |
| `ProviderCostVersion` | معادلة كلفة موثقة وفعالة زمنياً | customer price |
| `CustomerPriceVersion` | سعر FusionLab بوحدة Whole Credits | تكلفة المزود |
| `PublishedOffer` | المنتج الوحيد المرئي للمستخدم | route draft |
| `ReleaseBundle` | حزمة ذرية للنسخ والاعتمادات | تعديل مباشر داخل runtime |

### 4.2 حالات lifecycle

```text
Provider Account: DISCONNECTED → VERIFYING → CONNECTED → DEGRADED/SUSPENDED/REVOKED

Reference Model: DISCOVERED → NORMALIZED → REVIEWED → REFERENCE_ACTIVE → DEPRECATED/REMOVED

Offer: INACTIVE → DRAFT_SELECTED → CONTRACT_VALIDATED → PRICED → IN_REVIEW
       → APPROVED → CANARY_VALIDATED → PUBLISHED → PAUSED/RETIRED
```

`PUBLISHED` فقط يظهر في Creative Space. `PAUSED` يمنع quotes/dispatch الجديدة مع بقاء history والعمليات المثبتة سليمة.

### 4.3 النسخ التي تثبت في Quote وProvider Attempt

```text
providerId, providerAccountId, routeId, providerModelId,
adapterKey, adapterVersion, credentialVersion,
providerCostVersion, customerPriceVersion, releaseBundleId
```

بهذا لا تتأثر عملية قديمة عند تغيير موديل أو مفتاح أو سعر لاحقاً.

---

## 5. خطة التنفيذ ذات البوابات

لا تبدأ بوابة قبل إغلاق السابقة بدليل قابل لإعادة التشغيل. كلمة “موجود” لا تعني “مغلق”.

### AGCP-G0 — تثبيت نقطة البداية واتخاذ القرار

**الهدف:** منع البناء فوق مسارات متضاربة أو تغييرات غير موثقة.

| ID | العمل | دليل الإغلاق |
|---|---|---|
| `AGCP-0001` | تسجيل baseline للـworktree بدون سحق تغييرات المستخدم | baseline + file inventory |
| `AGCP-0002` | جرد كل generation/admin/catalog/pricing entry point وتصنيفه canonical/test-only/legacy | disposition matrix |
| `AGCP-0003` | مقارنة `FL-PCP-002` مع هذه الخطة وإنشاء قرار تعارض واحد | adoption/change decision |
| `AGCP-0004` | تثبيت أوامر test/typecheck القابلة لإعادة التشغيل | verification evidence |

**إغلاق:** لا مسار Provider قابل للاستدعاء خارج Generation V2، وكل legacy معلن ومعزول أو محجوب.

### AGCP-G1 — Control Plane دائم ومصدر حقيقة واحد

**الهدف:** إكمال قاعدة البيانات والعقود للكيانات في §4 قبل بناء واجهات جديدة.

| ID | العمل |
|---|---|
| `AGCP-0101` | Repositories دائمة للـProvider/Account/ReferenceModel/Route/Offer/ReleaseBundle |
| `AGCP-0102` | immutable versions، effective dating، optimistic concurrency، command idempotency |
| `AGCP-0103` | audit chain دائم مع قفل/رأس تسلسلي آمن للتوازي والتحقق بعد restart |
| `AGCP-0104` | Change Set bridge: لا تصبح Version منشورة إلا نتيجة approval مستقل |
| `AGCP-0105` | read models آمنة للإدارة بلا أسرار أو مفاتيح |
| `AGCP-0106` | model/price/route diff قابل للمراجعة البشرية |

**إغلاق:** يمكن تمثيل ثلاثة مزودين، حسابين لنفس المزود، وRoutes متعددة بلا تعديل schema؛ ولا ينتج Command مكرر أو write جزئي.

### AGCP-G2 — Secret Manager وProvider Account Setup الحقيقي

**الهدف:** جعل زر Setup عملية حقيقية لكن بلا generation أو استنزاف credits.

| ID | العمل |
|---|---|
| `AGCP-0201` | `SecretStore` interface مع Local encrypted test implementation وproduction adapter design |
| `AGCP-0202` | write-only credential input، redaction، rotation، revoke، وcredential versions |
| `AGCP-0203` | حفظ reference/state/dates/actor فقط في Control Plane |
| `AGCP-0204` | KIE verification: `GET /api/v1/chat/credit` فقط |
| `AGCP-0205` | OpenRouter verification: `GET /api/v1/key` فقط |
| `AGCP-0206` | فصل KIE generation key عن webhook HMAC؛ وفصل OpenRouter generation key عن management key الاختياري |
| `AGCP-0207` | balance snapshots وhealth/limits من دون اختلاق held/spent أو entitlement |

**إغلاق:** Setup حقيقي يغيّر account إلى `CONNECTED` بعد read-only verification، ولا يظهر سر ولا يتم إنشاء Task/Generation.

### AGCP-G3 — Reference Catalog موثق بلا مفتاح

**الهدف:** إظهار موديلات حقيقية كـInactive قبل الاتصال بالحساب، مع دليل المصدر والسعر الصحيحين.

| ID | العمل |
|---|---|
| `AGCP-0301` | Catalog snapshot framework: raw source hashes، parser version، observedAt، diff، deprecation |
| `AGCP-0302` | KIE importer من documentation/Market/Pricing الرسمية؛ لا أسماء أو IDs غير موثقة |
| `AGCP-0303` | OpenRouter importer لـmodels/images/videos/TTS/STT وendpoint-specific metadata |
| `AGCP-0304` | normalizer للـpublisher/family/version/canonical slug/aliases/modalities |
| `AGCP-0305` | حفظ capabilities، schema hashes، endpoints، billing dimensions، source links |
| `AGCP-0306` | account overlay: OpenRouter `/models/user` بعد المفتاح؛ KIE دليل availability صريح بلا ادعاء endpoint غير موثق |

**إغلاق:** كل model ظاهر يحمل source evidence وsnapshot version؛ `:free` وaliases المتغيرة وremoved models لها lifecycle منفصل ولا تعامل كسعر ثابت.

### AGCP-G4 — Provider Integration Runtime وعقود البروتوكولات

**الهدف:** resolver تشغيلي يختار Adapter حسب route/account/version، لا حسب providerId وحده.

| ID | العمل |
|---|---|
| `AGCP-0401` | Provider Runtime Resolver وتثبيت route/account/credential/adapter versions على attempt |
| `AGCP-0402` | error taxonomy موحد: definitive reject/retryable/unknown/charged failure |
| `AGCP-0403` | Durable webhook inbox + authoritative status fetch + replay/restart tests |
| `AGCP-0404` | hardened asset gateway: DNS/private-IP، redirects، timeout، size/MIME/streaming/hashing |
| `AGCP-0405` | KIE protocol adapters منفصلة: Market ثم كل protocol مختار ومثبت schema؛ لا Adapter شامل وهمي |
| `AGCP-0406` | KIE polling/webhook: الحالات `waiting/queuing/generating/success/fail` ودليل `creditsConsumed` |
| `AGCP-0407` | OpenRouter composite adapters بحسب modality/endpoint، مع response/router metadata/generation evidence |
| `AGCP-0408` | إصلاح OpenRouter `max_price` كـobject حسب البعد وبوحدات USD الصحيحة، لا رقم واحد |

**إغلاق:** Fault/crash/restart tests تثبت عدم double submit، وعدم refund عند unknown، وعدم settlement من callback غير موثوق؛ لا اتصال خارجي في هذه البوابة.

### AGCP-G5 — التسعير والمالية والخزينة

**الهدف:** ضمان أن مبلغ العميل وكلفة المزود يقاسان بشكل مستقل ودقيق لكل SKU.

| ID | العمل |
|---|---|
| `AGCP-0501` | Billing formula لكل dimension: tokens, image count/size/quality, video duration/resolution/audio, requests وغيرها |
| `AGCP-0502` | Provider cost snapshots، effective dates، freshness guard، ومصفوفة SKU دقيقة |
| `AGCP-0503` | Customer price versions + P50/P90/P95/P99/worst-case margin simulation |
| `AGCP-0504` | Quote Engine يقرأ released price/cost versions لا runtime maps |
| `AGCP-0505` | provider actual cost وCash COGS وcustomer charge وplatform loss/reconciliation cases |
| `AGCP-0506` | treasury snapshots، funding lots، low balance/runway alerts، account spend caps |
| `AGCP-0507` | invariants: failed/no charge releases once; failed/charged refunds customer + platform loss; unknown stays held |

**إغلاق:** لا ينشر Route إذا كان أي cost dimension مجهولاً، ولا تتغير Quote قديمة بعد نشر سعر جديد، وتقارير الأدلة تعيد جمع ledger/provider evidence بلا فرق غير مبرر.

### AGCP-G6 — Atomic Release Bundle وPublished Offer API

**الهدف:** جعل النشر هو الجسر الذري الوحيد بين الإدارة والمحرك والواجهة.

| ID | العمل |
|---|---|
| `AGCP-0601` | Release compiler يجمع snapshots، account/credential version، route، adapter، cost، customer price، approvals، evidence |
| `AGCP-0602` | validate ثم persist ثم atomically switch active pointers ثم outbox/read-model rebuild |
| `AGCP-0603` | ربط Provider Runtime Registry وCommercial Registry وPublished Offer Catalog بالحزمة نفسها |
| `AGCP-0604` | rollback يعيد pointers إلى bundle سابقة فقط؛ emergency pause مستقل fail-closed |
| `AGCP-0605` | consumer-safe Published Offer API بلا account secrets/internal cost |

**إغلاق:** لا Offer بلا route+price+credential+evidence صالحة، وفشل النشر لا يترك حالة نصف منشورة، وrollback بعد restart مجرّب.

### AGCP-G7 — SaaS Admin واضح وEnglish-first

**الهدف:** بناء UI تشغيلي مفهوم، كل إجراء فيه أمر Backend حقيقي وليس تنقلاً أو Fixture.

```text
Overview
Providers: Connections · Accounts · Credentials · Health
AI Catalog: Reference Models · Inactive Candidates · Active Offers · Snapshots
Pricing: Provider Costs · Customer Prices · Margin Simulator · Approvals
Operations: Generations · Attempts · Exceptions · Reconciliation
Customers: Wallets · Ledger · Subscriptions
Commerce: Plans · Credit Packages · Payments
Governance: Approval Inbox · Change Sets · Releases · Audit · Roles
```

| ID | العمل |
|---|---|
| `AGCP-0701` | Provider setup wizard: select → paste key → test → result → next action |
| `AGCP-0702` | Catalog screens تفصل Reference/Unavailable/Inactive/In review/Published/Paused |
| `AGCP-0703` | Route detail يشرح provider ID، account، capabilities، provider cost، FusionLab price، blockers، evidence freshness |
| `AGCP-0704` | Pricing editor + margin simulator + maker/checker inbox |
| `AGCP-0705` | Operations/reconciliation/treasury views بربط مباشر إلى Operation وAttempt وLedger evidence |
| `AGCP-0706` | إجراءات destructive/revoke/pause/rollback: confirmation، reason، RBAC، audit |
| `AGCP-0707` | English copy كامل LTR؛ localization architecture للعربية RTL دون مزج |

**إغلاق:** لا زر Setup/Sync/Test/Price/Approve/Publish بلا command وخطأ مفهوم واختبار E2E؛ لا secret في UI read state أو analytics؛ accessibility/responsive paths مغطاة.

### AGCP-G8 — Creative Space الديناميكي

**الهدف:** انتقال المستخدم من Recipes ثابتة إلى عروض منشورة فقط.

| ID | العمل |
|---|---|
| `AGCP-0801` | استبدال `local/test-*` literals بـPublished Offer API |
| `AGCP-0802` | بناء controls من capability/schema المنشورة، مع Standard وProfessional فوق العقد نفسه |
| `AGCP-0803` | exact quote قبل confirmation وتثبيت bundle/route/price versions في intent |
| `AGCP-0804` | منع double click/retry باستخدام idempotency وإظهار timeline مفهوم |
| `AGCP-0805` | إخفاء paused/retired من الطلبات الجديدة مع حفظ history وdelivery |

**إغلاق:** لا يستطيع العميل اختيار route/account/price غير منشورة، ولا يظهر موديل خارج Published Offer Catalog.

### AGCP-G9 — تحقق خارجي مرخّص وCanary محدود

**الهدف:** التحول من ثقة Offline إلى اتصال فعلي مضبوط بلا إهدار credits.

1. **Connection test فقط** بعد أن يزود المستخدم المفتاح عبر Setup: KIE balance read؛ OpenRouter current key read. لا generation.
2. **Canary لكل Route/SKU** فقط بإذن صريح، Budget وحد أقصى معروفين، وطلب واحد معلوم الكلفة.
3. مطابقة كاملة: submit → status/webhook/poll → asset → usage → provider cost → ledger → customer result.
4. أي فرق أو unknown يوقف Route وينشئ Reconciliation Case؛ لا توسع تلقائي.

**إغلاق:** canary evidence ناجح لكل Route منشورة، مع rollback/pause/key rotation drills، وموافقة منفصلة لأي Deploy أو traffic إنتاجي.

### AGCP-G10 — إزالة التوازي والإغلاق

**الهدف:** عدم بقاء أي bypass أو واجهة قديمة تخلق مساراً مالياً ثانياً.

- حذف أو hard-retire مسارات Supabase/Browser المباشرة القديمة بعد migration المعتمد فقط.
- إزالة pricing maps وfixtures من production catalog؛ يبقى Provider For Test test-only مع network isolation.
- حذف Admin القديم بعد انتقال كل read/write flows إلى Control Plane.
- جرد `rg` وroute inventory وE2E يثبت أن أي Generation تجاري يمر بالمحرك الوحيد.

**إغلاق:** لا production-callable legacy path، والوثائق وrunbooks وdashboard تشير إلى AI Gateway فقط.

---

## 6. تفاصيل Provider الخاصة

### KIE.ai

- الكتالوج العام يأتي من docs/Market/Pricing ويخزن كسجل reference موثق، لا من قائمة hard-coded.
- اختبار الحساب الوحيد في البداية هو endpoint الرصيد read-only. مفتاح generation لا يساوي HMAC webhook key؛ بدون الثاني يكون الحساب `POLLING_ONLY` لا webhook-ready.
- KIE عدة بروتوكولات، لا Adapter واحد: Market, Veo, Suno, Runway, image/chat وغيرها تبنى واحداً واحداً فقط عند اختيارها كـRoute مدعوم.
- النجاح المالي لا يثبت إلا بـtask-bound `creditsConsumed` أو دليل رسمي مكافئ. لا يعمم refund code من منتج مثل Suno على كل KIE.
- روابط النتائج مؤقتة؛ الاستلام والتخزين الآمن جزء من Route contract، لا تفصيل واجهة.

### OpenRouter

- Reference catalog يشمل model/endpoint/modality وpricing dimensions، ولا يعتمد “أقل سعر للموديل” كضمان للكلفة.
- مفتاح generation يختبر بـ`GET /api/v1/key`. Management key اختياري ومنفصل لمراقبة credits، ولا يستخدم للتوليد.
- `/models/user` overlay يثبت ما هو متاح للحساب بعد الاتصال؛ الموديل reference لا يصبح available تلقائياً.
- routing policy تثبت endpoint/provider options و`max_price` المفصل حسب dimensions؛ لا تطبق `:latest` أو aliases المتغيرة كسعر ثابت.
- generation evidence وRouter Metadata تدخل reconciliation ولا يفسر HTTP error وحده كـno-charge.

---

## 7. مصفوفة اختبارات الإغلاق

| السيناريو | النتيجة الإلزامية |
|---|---|
| 100 تأكيد لنفس intent | Operation واحد وحجز واحد |
| crash/timeout بعد POST | `SUBMISSION_UNKNOWN`، لا resend ولا refund أعمى |
| فشل مزود مع zero-cost evidence | release واحد لحجز العميل |
| فشل مزود بكلفة مؤكدة | refund/release للعميل + `PLATFORM_LOSS` |
| webhook مزور/قديم/مكرر/restart | لا settlement ولا عملية مكررة |
| publish يفشل في منتصف المعاملة | لا pointer/offer/runtime جزئي |
| تغيير سعر أو مفتاح | العملية القديمة تبقى على نسخها المثبتة |
| asset redirect/private IP/oversize/MIME خاطئ | رفض قبل delivery |
| double click من Creative Space | يعيد نفس العملية ولا يولّد ثانية |
| pause أو rollback | يمنع quotes/dispatch الجديدة فقط |

تشمل كل بوابة: unit + contract fixtures + fault injection + restart/concurrency + security + typecheck. لا يعلن نجاح شامل إذا تعذر تشغيل suite بسبب dependency/tooling؛ يسجل العائق صراحة ويصلح أولاً.

---

## 8. ترتيب التنفيذ والاعتماديات

```text
G0 Baseline/Adoption
  → G1 Durable Control Plane
  → G2 Secrets & Accounts
  → G3 Reference Catalog
  → G4 Provider Runtime
  → G5 Finance & Treasury
  → G6 Atomic Release
  → G7 Admin SaaS
  → G8 Dynamic Creative Space
  → G9 Authorized External Canary
  → G10 Legacy Closeout
```

يمكن عمل wireframes غير وظيفية للـAdmin أثناء G1، لكن لا تنفذ Setup أو Active أو Pricing أو Publish UI قبل وجود الأمر الخلفي والبوابة اللازمة. Provider For Test يبقى حتى تغطي الاختبارات offline كل العقود؛ لا يحذف لمجرد أن واجهة KIE/OpenRouter أصبحت ظاهرة.

---

## 9. Definition of Done النهائي

تعتبر المنصة مكتملة فقط إذا:

- يوجد Control Plane دائم ومحايد للمزودين، وResolver يدعم accounts/routes/adapter versions متعددة.
- KIE وOpenRouter يظهران كمراجع موثقة قبل المفتاح؛ والمفتاح يربط الحساب فقط.
- نموذج محدد لا يصبح user-visible إلا بعد Cost + Price + Simulation + Approval + Atomic Release.
- كل عملية تثبت نسخها، وتحافظ على حقوق العميل والمنصة عند الفشل/القبول المجهول/التسليم الفاشل.
- Admin SaaS واضح، English-first، وعملياته حقيقية ومراجعة وقابلة للتدقيق.
- Creative Space ديناميكي ولا يملك provider-specific أو local-test route literals في مسار الإنتاج.
- لا أسرار مكشوفة، لا browser-to-provider calls، لا legacy bypass، ولا `0` مخترع عند فقدان دليل الكلفة.
- لا اتصال أو generation خارجي قبل إذن صريح، ثم canary محدود ومثبت مالياً.

---

## 10. بروتوكول تنفيذ كل بوابة

1. قراءة هذه الوثيقة ودليل إغلاق البوابة السابقة.
2. تحديد task IDs والملفات ضمن النطاق، مع الحفاظ على تغييرات المستخدم غير المتعلقة.
3. كتابة/تعديل العقود والاختبارات قبل أو مع التنفيذ.
4. تنفيذ التغيير عبر مسار واحد فقط.
5. تشغيل الاختبارات المناسبة وتسجيل الأوامر والنتائج الفعلية.
6. إنشاء Evidence file: تغييرات، invariants، security، external calls، مخاطر مفتوحة، وقرار `PASS/HOLD`.
7. تحديث لوحة التقدم فقط عند وجود دليل قابل لإعادة الفحص.

### لوحة التقدم عند الإنشاء

| البوابة | الحالة |
|---|---|
| `AGCP-G0` | `NOT STARTED — ADOPTION REQUIRED` |
| `AGCP-G1` إلى `AGCP-G8` | `NOT STARTED` |
| `AGCP-G9` | `NOT AUTHORIZED` |
| `AGCP-G10` | `NOT STARTED` |

---

## 11. المصادر الرسمية المرجعية

- KIE: [Documentation](https://docs.kie.ai/), [LLM index](https://docs.kie.ai/llms.txt), [Market](https://kie.ai/market), [Pricing](https://kie.ai/pricing), [Account credits](https://docs.kie.ai/common-api/get-account-credits), [Task details](https://docs.kie.ai/market/common/get-task-detail), [Webhook verification](https://docs.kie.ai/common-api/webhook-verification).
- OpenRouter: [Models](https://openrouter.ai/docs/guides/overview/models), [Current API key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key), [Routing/provider selection](https://openrouter.ai/docs/guides/routing/provider-selection), [Image](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [Video](https://openrouter.ai/docs/guides/overview/multimodal/video-generation), [Generation evidence](https://openrouter.ai/docs/api/api-reference/generations/get-generation), [Credits](https://openrouter.ai/docs/api/api-reference/credits/get-credits).

