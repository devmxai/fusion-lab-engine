# إغلاق مرحلة PostgreSQL Durable Transaction Foundation

الحالة: **مغلقة كقاعدة بيانات محلية واختبار عقد** — غير مفعّلة بعد داخل Runtime المحرك، وغير مطبقة على Supabase أو Production.

## النطاق المغلق

- مخطط PostgreSQL مستقل داخل `packages/durable-execution/sql/001_generation_v2_durability.sql`.
- معاملة ذرية واحدة تنفذ:
  - قفل Quote.
  - التحقق من المالك والـHash والانتهاء.
  - منع إعادة استهلاك Quote.
  - منع تعارض GenerationIntent وIdempotency-Key.
  - قفل Wallet والتحقق من الرصيد.
  - إنشاء Operation بحالة `RESERVED` وإصدار `0`.
  - إنشاء Reservation واحد.
  - نقل Whole Credits من Available إلى Held.
  - كتابة Journal متوازن وEntries غير قابلة للتعديل.
  - كتابة Operation Event ودليل Hash.
  - كتابة Outbox Event في المعاملة نفسها.
  - تحويل Quote إلى `CONSUMED`.
- قيود قاعدة البيانات تمنع:
  - أكثر من Operation للـQuote نفسه.
  - أكثر من Operation للـGenerationIntent نفسه.
  - أكثر من Reservation للـOperation أو Quote.
  - Idempotency binding متعارض ضمن `(owner, route, key)`.
  - تعديل أو حذف Ledger Journal/Entries وOperation Events.
  - Commit لقيد Ledger غير متوازن.

## دليل PostgreSQL المحلي

استخدم الاختبار `postgres-atomic.test.ts` قاعدة PGlite PostgreSQL فعلية، بمعاملات وقيود وTriggers وتخزين Node filesystem حسب الواجهة الرسمية: https://pglite.dev/docs/api وhttps://pglite.dev/docs/filesystems.

نجحت الأدلة التالية:

1. مئة Retry متزامن لنفس Quote ينتج Operation وReservation وOutbox وReserve Journal واحداً.
2. نقص الرصيد يعيد المعاملة بالكامل؛ Quote يبقى `ISSUED` ولا يظهر Operation أو Reservation أو Outbox.
3. قيد Ledger غير المتوازن يُرفض عند Commit.
4. تحديث Journal مالي بعد إنشائه يُرفض من Trigger داخل قاعدة البيانات.
5. بعد إغلاق PostgreSQL المحلي وإعادة فتحه من مجلد القرص، بقيت Operation وReservation وOutbox قابلة للاستعادة.

## ما لم يُنفذ عمدًا

- لم يُنشأ ملف داخل `supabase/migrations` ولم تُطبق Migration على Supabase.
- لم يُستخدم Supabase personal token أو Vercel أو GitHub token.
- لم يحدث Deploy أو اتصال KIE/OpenRouter.
- Runtime الحالي لم يتحول بعد إلى هذا المستودع؛ ما زال Provider For Test يستخدم In-memory adapter في التدفق التشغيلي الحالي.
- PGlite يثبت SQL والمعاملة وإعادة التشغيل محليًا، لكنه single-connection ولا يثبت تنافس عدة Processes أو Workers.

## بوابة المرحلة التالية

المرحلة التالية هي **Engine Durable Repository Wiring**:

1. تحويل LocalMockProviderService إلى Repository interfaces غير مرتبطة بـMap.
2. جعل كل Transition وAttempt وInbox وOutbox claim/ack دائمًا داخل PostgreSQL.
3. تشغيل API وWorker كعمليتين محليتين منفصلتين ضد قاعدة واحدة.
4. تنفيذ crash-after-commit وredelivery واختبار Worker مزدوج.
5. بعد نجاح ذلك فقط، مراجعة SQL أمنيًا وماليًا وتحويله إلى Supabase staging migration بموافقة صريحة؛ Production يبقى ممنوعًا.

## ملاحظة Dependency Audit

إضافة PGlite كانت Dev-only. فحص Production dependencies أظهر تحذيرين Moderate في React Router موجودين خارج هذه المرحلة، ولا توجد High أو Critical ضمن `npm audit --omit=dev`. الإصلاح يحتاج تحديث React Router واختبارات Regression مستقلة، ولم يُطبق تلقائيًا حتى لا يتوسع نطاق المرحلة.
