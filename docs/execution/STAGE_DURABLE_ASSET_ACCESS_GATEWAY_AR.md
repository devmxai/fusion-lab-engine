# إغلاق مرحلة Durable Asset Access Gateway

الحالة: **مغلقة محلياً** — PGlite وPrivate In-Memory Store وProvider For Test فقط؛ لا Provider API مدفوع ولا Migration ولا Deploy.

## ما تم تنفيذه

- تضاف أحداث تدقيق append-only في `asset_access_events` للـGrant والقراءة المسموحة أو المرفوضة؛ يخزن Hash للـtoken فقط، وليس الـtoken.
- V2 يعرض في العملية `assetId` وmedia metadata فقط. لا يعرض Provider result URL أو private object key.
- إنشاء Grant: `POST /v2/assets/:assetId/access-grants`، بمدة من 1 إلى 900 ثانية.
- قراءة الأصل: `GET /v2/assets/:assetId/content` باستخدام Header `x-fusion-asset-grant`، لا Query string حتى لا يتسرب token عبر روابط أو telemetry.
- الوصول يثبت ملكية الأصل في PostgreSQL قبل إنشاء/استخدام grant، ثم يثبت صلاحية الـgrant في Private Object Store.

## دليل التنفيذ

- Generation V2 محلية تصل إلى `SETTLED` ثم تعيد Asset ID فقط.
- Grant خاطئ يعيد `403`، وGrant صحيح يعيد bytes الأصل وContent-Type الصحيح.
- سجل التدقيق يثبت `GRANT_ISSUED` و`READ_ALLOWED` و`READ_DENIED`.

## الحدود المتعمدة

- هو عقد Local API مملوك لـ`local-user`. تبديله بمصادقة المستخدم الحقيقية/RBAC سيجعل `ownerId` من Session موثقة، لا من payload أو Header يرسله العميل.
- التخزين In-Memory؛ لا يبقى الأصل أو grants بعد restart. السجل المالي وحالة العملية يبقيان دائميْن، لكن استبدال التخزين بـObject Storage دائم شرط قبل أي Staging.
- لا توجد URLs موقعة أو redirect إلى Storage. واجهة Creative Space ستقرأ المحتوى عبر `fetch` وتحوله إلى Blob URL بعد ترحيلها إلى V2.

## البوابة التالية

ترحيل Creative Space تدريجياً إلى V2: Quote، Intent واحد، polling للحالة، وقراءة asset عبر هذه البوابة. لا يزال Provider For Test فقط حتى انتهاء كتالوجات KIE/OpenRouter offline وموافقة اختبار الاتصال المنفصل.
