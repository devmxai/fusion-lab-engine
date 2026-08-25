# إغلاق مرحلة Durable Asset Delivery and Financial Settlement

الحالة: **مغلقة محلياً لعقد التخزين الخاص والتسوية المالية الدائمة** — لا Provider حقيقي، ولا Migration، ولا Deploy.

## القرار الهندسي

رصيد العميل ووحدة تكلفة المزود لا يختلطان:

- Ledger العميل يعمل بـWhole Site Credits فقط وبقيد Journal متوازن.
- تكلفة المزود تبقى دليلاً بوحدة Provider Credits داخل `provider_cost_outcomes`، مع تصنيف `DELIVERED` أو `LOSS`.
- لا يتم Capture لرصيد العميل عند نجاح المزود وحده؛ يلزم تخزين أصل خاص وتسليم قابل للوصول أولاً.
- أي فشل غير قابل للإثبات يبقي Customer Hold محمياً وينقل Operation إلى `RECONCILIATION_REQUIRED`.

## ما تم تنفيذه

- جداول PostgreSQL دائمة وغير قابلة للتعديل:
  - `operation_assets`: هوية الأصل الخاص، المصدر، checksum، MIME، الحجم والـmetadata.
  - `operation_deliveries`: دليل إتاحة الأصل للمالك دون تخزين Access Token.
  - `provider_cost_outcomes`: تكلفة المزود وتصنيفها كتكلفة تسليم أو خسارة.
  - `financial_command_bindings`: Command Idempotency للتسوية أو الاسترداد.
- مسار نجاح متسلسل:
  1. جلب أصل المزود من المصدر المسموح فقط.
  2. فحص SSRF والحجم والـMIME والـmagic bytes والمحتوى النشط/الفحص المحلي.
  3. التخزين Private مع Object Key وChecksum حتميين.
  4. `PROVIDER_SUCCEEDED → ASSET_STORED` بدليل دائم.
  5. إصدار Access Grant قصير للمالك فقط ثم `ASSET_STORED → DELIVERED`.
  6. `DELIVERED → SETTLED` في معاملة واحدة: Reservation، Wallet، Ledger Journal، Command Binding، Provider Cost Outcome وOperation Event.
- مسار فشل تسليم مثبت:
  - الأصل الضار أو غير المطابق يُحجر ولا ينشر.
  - Customer Hold يُطلق مرة واحدة فقط.
  - يسجل Release Journal متوازن.
  - تسجل Provider Cost كـ`LOSS`، ثم `DELIVERY_FAILED`.
- مسار فشل غير مثبت:
  - خطأ جلب/تخزين عابر أو غير مصنف لا يعمل Refund تلقائياً.
  - ينتقل إلى `RECONCILIATION_REQUIRED` مع بقاء Reservation `HELD`.

## أدلة الاختبار

1. أصل SVG من Provider For Test خضع للفحص وخُزن خاصاً، ثم أصبح متاحاً فقط عبر Owner Access Grant.
2. مئة Retry متزامن في خطوة Settlement أنتجت Asset واحداً وDelivery واحداً وSETTLE Journal واحداً وProvider Cost Outcome واحداً.
3. Ledger Settlement متوازن (مجموع القيود صفر)، وحالة العميل النهائية: `available 996 / held 0 / spent 4`.
4. نتيجة مزود مشحونة لكن SVG ضار: حُجر الملف، أُعيدت كريديتات العميل كاملة، وسُجل Provider Loss بتكلفة 2.
5. خطأ جلب غير مثبت: بقيت كريديتات العميل `HELD` ولم ينشأ Financial Command.
6. بعد إغلاق PostgreSQL المحلي وإعادة فتحه في `DELIVERED`، أعاد عشرون Retry تنفيذ Settlement واحدة فقط.

## الحدود المتبقية

- `PrivateMediaPipeline` الحالي يستخدم InMemory Private Store كمرجع محلي؛ واجهته ومفاتيح الهوية جاهزة، لكن التخزين الكائني الإنتاجي الدائم لم يُربط بعد.
- Worker Classes أصبحت مربوطة الآن بـLocal Runtime دوري موثق في مرحلة Runtime التالية؛ PGlite يظل single-connection ولا يثبت فصل عمليات نظام مستقلة.
- لا يوجد Webhook حقيقي من مزود ولا KIE/OpenRouter API Call.
- SQL Contract محلي فقط: لم يُنشأ ملف Migration جديد ولم تطبق أي قاعدة بيانات مشتركة أو Production.
- معالجة Result النصي تحتاج عقد تسليم نصي منفصل؛ حالياً ينتقل إلى Reconciliation بدلاً من معاملته كملف Media.

## البوابة التالية

**Runtime Wiring and Reconciliation Operations**:

1. تشغيل API وOutbox Relay وProvider/Asset/Finance Workers محلياً كعمليات مستقلة فوق PostgreSQL واحد.
2. استبدال InMemory Private Store بتطبيق Object Storage خاص دائم مع نفس الواجهة.
3. جدولة Poll/Retry وLease/Backoff وDead-letter للـProvider وAsset وFinance Commands.
4. واجهات Admin للـOperations، Provider Cost Outcomes، Holds، Reconciliation وFinancial Audit.
5. بعد أدلة Local كاملة وموافقة صريحة: إعداد Supabase Migration منفصلة ثم Staging، وليس Production مباشرة.
