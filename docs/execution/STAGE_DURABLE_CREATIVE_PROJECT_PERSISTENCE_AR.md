# Creative Space: حفظ مشروع دائم محلياً

| Field | Value |
|---|---|
| Status | `LOCAL IMPLEMENTED / NOT PRODUCTION APPROVED` |
| Scope | مشروع Creative Space ومالك الجلسة فقط |
| Provider calls | `NONE` |
| Migration / Deploy | `NONE` |

## ما أُغلق

- جدول `fusion_engine.creative_projects` يحفظ وثيقة مساحة العمل مع `owner_id` و`version`.
- `GET/PUT /v2/projects/:projectId` لا يسمحان بقراءة مشروع مستخدم آخر.
- كل حفظ يتطلب نسخة المشروع التي قرأها العميل؛ التعارض `409` يعيد تحميل النسخة الأحدث بدلاً من الكتابة فوقها.
- React Flow ليس مصدر الحقيقة؛ الوثيقة هي Graph domain فقط.
- أصل النتيجة يحفظ `deliveryAssetId` فقط. رابط `blob:` مؤقت للمتصفح لا يخزن؛ يعاد طلب معاينة خاصة قصيرة الأجل بعد الفتح.
- وثيقة العملية تفرق بين `customerCredits`/`providerEstimateCredits` في الـQuote وبين `customerChargedCredits`/`providerActualCredits` المثبتة. عند قراءة وثيقة محلية قديمة، أي قيمة نهائية غير موجودة تبقى `null` ولا تُستنتج من السعر التقديري أو من الصفر.

## دليل محلي

- `apps/engine-api/src/generation-v2/routes.test.ts`: ملكية، تعارض الإصدار، وعزل الأصول/العمليات.
- `src/features/creative-space/creative-space.test.ts`: عدم حفظ Blob URL مع إبقاء معرّف الأصل.

## حدود صريحة

- هو PGlite وملف محلي للتطوير، وليس PostgreSQL/Supabase production أو نسخاً احتياطياً أو HA.
- هوية `local-user` موقعة محلياً وليست Google/Supabase identity.
- مسودات أدوات الإدخال تبقى محلية مؤقتاً؛ مصدر حقيقة المشروع نفسه أصبح المحرك.
