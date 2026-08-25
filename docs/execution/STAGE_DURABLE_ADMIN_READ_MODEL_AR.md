# إغلاق مرحلة Durable Admin Read Model

الحالة: **مغلقة محلياً للقراءة والتدقيق فقط** — لا توجد أوامر مالية أو Provider calls أو Migration أو Deploy.

## ما تم تنفيذه

- إضافة قراءات Admin محمية بجلسة Admin الحالية وAAL2/RBAC القائم:
  - `GET /v1/dev/admin-v2/durable/overview`
  - `GET /v1/dev/admin-v2/durable/operations/:operationId`
- الملخص يعرض من PostgreSQL الدائم:
  - عدادات حالات العمليات.
  - Customer Holds وManual Review.
  - عمليات Reconciliation.
  - Provider Cost Outcomes (`DELIVERED` أو `LOSS`).
- سجل العملية يعرض بدون أسرار:
  - Operation Events والإصدارات.
  - Attempts وحالة Submit/Poll.
  - Reservation وحالة Ledger.
  - Asset/Delivery evidence.
  - Provider Cost Outcome وJournals المتوازنة.

## الحماية

- القراءة بلا Session موقعة تُرفض.
- لا يوجد endpoint لتعديل Hold أو Settlement أو Provider Cost Outcome.
- لا يخزن Access Token أو Provider API Key في هذه الـprojections.
- العملية غير الموجودة تعيد `404` صريحاً.

## البوابة التالية

ترحيل `Generation V2` إلى Runtime الدائم يتطلب أولاً جدول Quote Metadata دائم يحفظ:

1. Provider ID والـProvider-neutral request المجمد.
2. Project/recipe/pinned price metadata اللازمة لعرض Quote بعد restart.
3. Request Hash وربط Generation Intent وIdempotency ضمن المعاملة نفسها.

بعد هذه القاعدة فقط يمكن تحويل مسار API العام من دون الاعتماد على Maps أو إنشاء مسار مالي ثانٍ.
