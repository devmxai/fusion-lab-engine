# إغلاق مرحلة Durable Provider Attempt Lifecycle

الحالة: **مغلقة محلياً لعقد Submit/Lookup/Poll الدائم** — لا تسوية مالية للمستخدم، ولا Provider حقيقي، ولا Migration أو Deploy.

## ما تم تنفيذه

- توسعة `operation_attempts` داخل PostgreSQL لتخزين:
  - نسخة Provider Request الدائمة و`request_hash`.
  - `version` مستقل مع Trigger يفرض زيادته مرة واحدة في كل Update.
  - Provider Idempotency Key وهوية Provider Task الفريدة.
  - `response_hash` وعدادات Lookup/Poll.
  - Provider Actual Credits وCharge Status ورابط النتيجة وكود الخطأ.
- CAS مزدوج على Operation وAttempt داخل معاملة واحدة لكل انتقال مؤثر.
- بروتوكول Write-ahead آمن للإرسال:
  1. `DISPATCHING` يُنقل أولاً إلى `SUBMISSION_UNKNOWN` ويحفظ دليل التعرض.
  2. العامل الذي نجح في CAS وحده يحق له استدعاء `submit`.
  3. أي عامل أو Restart لاحق لا يستدعي `submit` ثانية؛ يبدأ بـ`lookupByIdempotency`.
  4. قبول المزود يُستعاد إلى `SUBMITTED` بنفس Provider Idempotency Key.
  5. إذا تعذر إثبات القبول بعد الحد المضبوط ينتقل المسار إلى `RECONCILIATION_REQUIRED` ولا يخمن.
- Polling دائم يدعم:
  - `SUBMITTED → RUNNING → PROVIDER_SUCCEEDED` مع التكلفة الفعلية ورابط النتيجة.
  - Failure مؤكد بلا Charge إلى `PROVIDER_FAILED` مع Provider Cost يساوي صفرًا.
  - Failure مع Charge أو نجاح ناقص دليل التكلفة/النتيجة إلى `RECONCILIATION_REQUIRED`.
- كل انتقال Operation يمر عبر `requireLegalTransition` ويكتب Operation Event ودليل Hash في معاملة الانتقال نفسها.

## أدلة الاختبار

1. عشرون Worker Retry متزامناً نفذت Provider Submit واحداً، Attempt واحدة، Provider Task واحدة وSuccess Event واحداً.
2. محاكاة Submission Accepted ثم Response Timeout حفظت `SUBMISSION_UNKNOWN`.
3. بعد إغلاق PostgreSQL المحلي وفتحه من القرص، استعاد Worker جديد المهمة بواسطة Lookup وأكملها بنجاح من دون Submit ثانٍ.
4. مزود لا يثبت القبول بعد ثلاث عمليات Lookup انتقل إلى Reconciliation وبقي Submit مرة واحدة.
5. رفض Definitive قبل قبول المهمة حُفظ كفشل مؤكد مع `CONFIRMED_NO_CHARGE` وActual Provider Credits صفر.
6. فشل Provider For Test أعاد رصيد المزود كاملاً، وحُفظت أدلة الفشل والتكلفة الصفرية.
7. فشل مزود يبلغ عن Charge لم يحرر Customer Hold؛ بقي Reservation بحالة `HELD` وانتقل إلى Reconciliation.

## القرار المالي المقصود

هذه المرحلة تحفظ **دليل تكلفة المزود فقط**. لم تنفذ Capture أو Release لرصيد المستخدم. هذا فصل متعمد للمسؤوليات:

- النجاح عند المزود لا يعني بعد أن الأصل تم تخزينه وتسليمه.
- الفشل غير المؤكد لا يسمح باسترداد تلقائي قد يسبب خسارة للموقع.
- Customer Hold لا يتحول إلى Capture/Release إلا في مرحلة Financial Settlement الدائمة التالية وبJournal متوازن وCommand Idempotency مستقل.

## الحدود المتبقية

- Worker Class مكتمل ومختبر، لكنه غير موصول بعد بعملية Background Scheduler داخل Runtime الحالي.
- لم ينفذ Private Asset Ingest أو Delivery في هذا المسار الدائم.
- لم تنفذ التسوية أو الاسترداد الدائمان لرصيد المستخدم.
- الاختبار يستخدم Provider For Test فقط؛ لا KIE/OpenRouter API Call أو مفتاح حقيقي.
- SQL ما زال Contract محلياً؛ لم ينشأ ملف `supabase/migrations` ولم يطبق على أي بيئة مشتركة أو Production.

## بوابة المرحلة التالية

**Durable Asset Delivery and Financial Settlement**:

1. جلب الأصل والتحقق من مصدره وحجمه ونوعه ثم تخزينه Private قبل أي تسوية.
2. `PROVIDER_SUCCEEDED → ASSET_STORED → DELIVERED` بأدلة دائمة وInbox/Outbox Idempotency.
3. نجاح التسليم: Capture سعر المستخدم مرة واحدة، Release الفرق، Journal متوازن، ثم `SETTLED`.
4. فشل Provider المؤكد بلا Charge: Release كامل مرة واحدة مع Journal متوازن.
5. فشل Delivery بعد Provider Charge: Release المستخدم وتسجيل Provider Loss في حساب منفصل.
6. Reconciliation يبقي Hold محمياً إلى قرار موثق؛ لا Timeout Refund عشوائي.
7. اختبارات Crash بين كل Commit وAck، و100 Retry لكل Command مالي، ثم Runtime wiring محلي.
