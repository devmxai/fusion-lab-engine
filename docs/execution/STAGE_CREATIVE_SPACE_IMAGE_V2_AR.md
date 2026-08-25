# إغلاق شريحة Creative Space Image على V2 الدائم

الحالة: **مغلقة محلياً لمسار الصورة** — Provider For Test فقط؛ لا API مدفوع ولا Migration ولا Deploy.

## ما تم تنفيذه

- عميل الصورة يطبع استجابة V2 الدائمة (`quote + operation`) ويحافظ على توافق الاستجابة المحلية القديمة أثناء الانتقال.
- التأكيد يستخدم `Idempotency-Key` و`generationIntentId` نفسيهما؛ لا يوجد زر Run عام أو مسار حجز ثانٍ.
- بعد `SETTLED` يطلب المتصفح Access Grant قصير العمر، يقرأ bytes عبر Header خاص، ويعرضها Blob URL داخل الجلسة فقط.
- الـCanvas والعارض يفهمان Blob URL ولا يمران به عبر Engine proxy ولا يحفظانه كرابط مزود/تخزين.
- استعادة Operation تعيد Quote snapshot المجمد من PostgreSQL؛ لا تعتمد على Map في السيرفر.

## التحقق

- TypeScript الكامل نجح.
- بناء الواجهة نجح.
- اختبارات Generation V2 وCreative Space الأساسية نجحت في التحقق المستهدف.

## قيد مقصود

Blob URL صالح للجلسة المتصفح فقط، لذلك لا يعامل كـURL دائم داخل مشروع محفوظ. التخزين الدائم وAsset refresh بعد restart شرط مستقل قبل Staging.

## التالي

تطبيق العقد نفسه على الفيديو، ثم الصوت/المتقدم، مع الحفاظ على اختلافات Media Type وBindings فقط، لا تغيير قواعد الحجز أو التسوية.
