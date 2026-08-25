# حوكمة الكتالوج والتسعير الدائمة محلياً

| Field | Value |
|---|---|
| Status | `LOCAL CONTRACT IMPLEMENTED / PRODUCTION HOLD` |
| Scope | Catalog snapshots, pricing change sets, maker/checker evidence and audit trail |
| External calls | `NONE` |
| Provider/model activation | `NONE` |

## ما أصبح دائماً في محرك Local

- يحفظ المحرك نسخة كتالوج (`Catalog Snapshot`) وفرقها الدالّي، ونسخ التغييرات (`Change Sets`) بما فيها سياسة التسعير، وسلسلة تدقيق append-only في PostgreSQL المحلي.
- كل عملية كتابة تستخدم رقم revision متفائل؛ إذا سبقها محرك محلي آخر تفشل العملية بـ`ADMIN_STATE_VERSION_CONFLICT` بدلاً من الكتابة فوقها بصمت.
- تجزئة سجل التدقيق تستخدم JSON canonical، لذا تبقى السلسلة قابلة للتحقق بعد عبور JSONB وإعادة تشغيل المحرك.
- يوجد اختبار إعادة تشغيل فعلي ينشئ Snapshot و`PRICING_POLICY` draft، يغلق المحرك، ثم يستعيدهما مع سلسلة تدقيق صحيحة.
- تعرض `/admin/v2` الآن قراءات مقنّعة للـCustomers/User 360، سجل العمليات والاستثناءات، Pricing Workbench، Change Sets وسجل التدقيق. الـWorkbench يعرض وحدة كلفة المزود ونسخة سعر العميل وحدّ الهامش كطبقات منفصلة؛ ولا يحسب Cash COGS أو ربحاً قبل وجود Funding/FX/fees وactual-cost موثقين.
- طابور الاستثناءات يميّز الآن، حيث توجد أدلة المحرك، بين `SUBMISSION_UNKNOWN` وغياب دليل نتيجة المزود وعدم اكتمال evidence النجاح واحتياج دليل الاسترداد وغياب دليل التسليم. لا يولّد هذا التصنيف Refund أو Retry أو Release تلقائياً.
- إسقاط Route الإداري يعرض الآن الطبقات الكاملة للعقد: Publisher وModel Family وCanonical Model وProvider Account وProvider Model وHosting Endpoint وCapability Schemas وCost Version وGuard وUsage Extractor وSource Snapshot. هذا عرض لعقد محلي فقط؛ لا يكشف Secret ولا يعتمد أو ينشر Route خارجي.
- يقدّم `Approval Inbox` إسقاطاً Server-owned للقرار التالي والدور المطلوب وفصل maker/checker لكل Change Set. لا يمنح هذا الإسقاط صلاحية كتابة: أوامر المرحلة تبقى محمية بـAAL2 وRBAC وidempotency وaudit، وجلسة الواجهة المحلية Viewer فقط.
- يقيّم `Route Release Gates` كل Route بقرار `BLOCKED_LOCAL` وأسباب صريحة: `LOCAL_TEST_SCOPE` و`NOT_PUBLISHED` و`NO_ACTIVE_CREDENTIAL` و`EXTERNAL_VALIDATION_NOT_AUTHORIZED`. لا يوجد مسار تجاوز من الواجهة، ولا يتحول وجود Model أو credential metadata إلى صلاحية نشر.
- مسار إدخال `Catalog Snapshot` أصبح side-effect safe: يبني preview بلا كتابة، ثم يمر بتفويض `DRAFT` وidempotency وإنشاء Change Set، وبعد نجاحها فقط يلتزم الـSnapshot. الطلب المرفوض لا يترك Snapshot يتيمًا؛ يغطيه اختبار API صريح.
- أصبحت شاشة `Provider & Model Control` تقرأ مزوديها وفلاترها من Registry/الكتالوج بدلاً من قائمة UI مغلقة. إضافة مزود جديد إلى الكتالوج تظهره في SaaS Admin كنطاق مستقل لنماذجه ومساراته وتسعيره وأدلته، من دون إعادة تصميم الصفحة أو افتراض KIE/OpenRouter فقط.
- KIE.ai وOpenRouter مسجلان الآن كـProvider Onboarding Profiles فقط، مع روابط الوثائق والكتالوج والتسعير الرسمية وقدرات معلنة. لا تظهر Fixtures الاختبارية كنماذج هذين المزودين، ولا يظهر Route أو سعر أو Release Gate لهما قبل إدخال `Catalog Snapshot` موقّع ومراجع. الحالة الصريحة هي `CATALOG_NOT_IMPORTED` وليست "تعطيلاً" لنموذج ادّعائي. وعند إدخال Snapshot، تعرض لوحة الكتالوج أحدث Snapshot لكل مزود كـ`SNAPSHOT_STAGED / REVIEW ONLY`؛ لا يمثل ذلك Route فعّالاً أو طلباً مسموحاً به.
- أضيف `Catalog Intake Center`: لكل مزود يعرض مرجع الكتالوج والتسعير الرسميين، آخر Snapshot، عدد Routes، ملخص الـdiff، وChange Set المرتبط وحالته. إسقاط Snapshot لا يعيد مصفوفة Routes الخام للمتصفح؛ يرجع الملخصات والتجزئات اللازمة للمراجعة فقط. لا توجد شاشة إدخال JSON حر ولا زر استيراد أو تفعيل من جلسة `ADMIN_VIEWER`.
- أضيفت `Model Pricing Readiness`: لكل Route حالة قرار لا تدّعي الجاهزية (`NEEDS_SNAPSHOT` أو `NEEDS_PRICE_POLICY` أو `PRICING_IN_REVIEW` أو `RELEASE_GATED`) مع فتح دليل Route أو Change Set المرتبط. الفلاتر قراءة فقط ولا تنشئ Snapshot أو سعراً أو نشرًا.
- أضيفت قراءة `Commerce / Subscriptions` إدارية محمية ومقنّعة: كتالوج منتجات الكريدت ونسخ الخطط وحالات checkout/subscription/invoice/reversal المجمعة وقرار reconciliation المحلي. لا ترجع هوية العميل أو رابط checkout أو webhook أو secret، ولا تتيح تحصيلاً أو استرداداً أو تعديل خطة من Admin.
- أضيف `Admin Command Center` كإسقاط خادمي لسياسة الأدوار لكل مورد حساس (`CATALOG_SNAPSHOT` و`PRICING_POLICY` و`ROUTE_CONTROL` و`FINANCIAL_ADJUSTMENT` وغيرها). يعرض maker/validator/simulator/approver/publisher، لكنه لا يمنح صلاحية؛ تظل جلسة التطوير `ADMIN_VIEWER` وطلبات الكتابة منها مرفوضة.
- أعيد عرض `Secret Manager` كدورة اعتماد لكل Provider: write-only ثم test ثم independent activation ثم revoke. الواجهة لا تعرض إلا metadata وfingerprint، ولا تحتوي حقل لصق API key ولا تنفّذ test/activate في جلسة القراءة.

## حدود مقصودة

- لا تحفظ كلمات مرور أو مفاتيح API أو قيم credential؛ تبقى الكتابة حساسة وwrite-only ولا تدخل وثيقة الحوكمة الدائمة.
- لا يوجد API call لـKIE أو OpenRouter، ولا تفعيل Model أو نشر Production في هذه المرحلة.
- هذا PGlite محلي لتطوير العقد فقط، وليس بديلاً عن PostgreSQL/Supabase production مع النسخ الاحتياطي وHA ومخزن أسرار خارجي.

## دليل الإغلاق المحلي

```powershell
npm run build:engine
npx vitest run apps/engine-api/src/admin-v2/durable-routes.test.ts
```

يجب أن ينجح اختبار `restores catalog snapshot, change set and immutable audit evidence after a local Engine restart`.
