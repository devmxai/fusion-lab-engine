# إغلاق مرحلة Durable Generation V2 Boundary

الحالة: **مغلقة محلياً** — Provider For Test وPGlite فقط؛ لا اتصال بـKIE/OpenRouter، ولا Migration أو Deploy.

## ما تم تنفيذه

- `POST /v2/quotes`، عند تشغيل الـRuntime المحلي، يسجل Quote دائماً في PostgreSQL مع:
  - `requestHash`، المشروع، الوصفة وProvider ID.
  - Provider-neutral request template المجمد.
  - Pricing Snapshot والـversions الظاهرة للمستخدم.
- `POST /v2/operations` يستهلك ذلك الـQuote بالمعاملة الذرية نفسها التي تحجز Credit واحداً فقط وتنشئ Outbox/Attempt.
- `GET /v2/operations/:id` يعيد Projection قابلاً للاستعادة بعد restart: الحالة، أحداثها، أرصدة العميل والمزود، ودليل التسليم الآمن (`assetId` فقط).
- لا يعاد كشف Provider result URL أو private object key من واجهة V2.
- رصيد التطوير المحلي لـ`local-user` ينشأ مرة واحدة فقط عبر `ledger_journals.command_id` ثابت؛ restart أو طلبان متزامنان لا يصدران Credits إضافية.

## دليل التنفيذ

- اختبار HTTP ينشئ Quote V2 ثم يرسل نفس Intent/Idempotency مرتين؛ يعيد نفس `operationId`.
- العامل المحلي يكمل العملية إلى `SETTLED`، وتظهر `customerChargedCredits=4` و`providerChargedCredits=2` ودليل Delivery.
- اختبار Quote Metadata يعيد فتح PGlite ثم ينشئ العملية من السجل المجمد، لا من Map.

## الحدود المتعمدة

- Provider For Test هو العقد الوحيد الذي يتم تشغيله محلياً؛ حقل `scenario` جزء من Fixture الاختبار ولا يذهب إلى API حقيقي.
- أصل النتيجة محفوظ في private in-memory store محلياً؛ واجهة تنزيل/عرض أصل مرخصة ودائمة ليست ضمن هذه المرحلة.
- مسارات Space المفردة (`/v1/dev/space-*`) تبقى Compatibility local fixtures. مسار V2 هو الحد العام الموصول بالـRuntime عند حقنه.
- لا يمثل هذا دليلاً على منافسة متعددة العمليات؛ PGlite single-connection محلياً فقط.

## البوابة التالية

1. بناء Asset Access Gateway: authorization مالك المشروع، signed delivery/read grant، audit وexpiry من دون كشف URL المزود.
2. ترحيل Creative Space تدريجياً إلى V2 بعد اختبار العرض الحقيقي للأصل.
3. بعد ذلك فقط تستكمل كتالوجات KIE/OpenRouter offline وتبقى Disabled حتى إدخال Key وموافقة اختبار اتصال منفصلة.
