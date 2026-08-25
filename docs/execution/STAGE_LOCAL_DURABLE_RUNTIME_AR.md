# إغلاق مرحلة Local Durable Runtime Wiring

الحالة: **مغلقة محلياً** — Runtime دوري فوق PGlite وProvider For Test فقط؛ لا Migration ولا مزود مدفوع ولا Deploy.

## ما تم تنفيذه

- `LocalDurableRuntime` يفتح PostgreSQL محلياً على القرص ويطبق عقد SQL المحلي.
- Relay دوري يطالب Outbox Lease، يكتب Inbox Receipt، ينشئ Attempt دائم ثم يعمل Ack أو Retry/Dead-letter.
- Provider Attempt Worker وAsset/Delivery/Finance Worker يعملون في دورة مستقلة منطقياً داخل Runtime واحد.
- السيرفر المحلي يشغل الـRuntime اختيارياً عند `ENGINE_DURABLE_RUNTIME_ENABLED=true`.
- حالة تشخيص محلية فقط متاحة في `/v1/dev/durable/status`، ولا تعرض أسراراً أو محتوى عمليات.
- متغيرات Local فقط:
  - `ENGINE_DURABLE_DB_PATH`
  - `ENGINE_DURABLE_TICK_MS`
  - `ENGINE_DURABLE_RUNTIME_ENABLED`

## دليل التنفيذ

1. Generation محلية كاملة انتقلت من Outbox إلى Provider ثم Asset الخاص ثم Delivery ثم Settlement.
2. Runtime أُغلق بعد `SUBMISSION_UNKNOWN` ثم فُتح من نفس مجلد PostgreSQL؛ استعاد العملية وأكمل `SETTLED` من دون Submit ثانٍ.
3. Outbox النهائي `ACKED`، وعدد Submit للمزود بقي واحداً.

## القيد المقصود

PGlite مناسب لإثبات PostgreSQL المحلي والتخزين على القرص، لكنه single-connection. لذلك لا يدعي هذا الإغلاق تشغيل Processes مستقلة متنافسة. فصل API وRelay وWorkers على مستوى نظام التشغيل يتطلب PostgreSQL خارجي حقيقي، ويؤجل إلى Staging بعد موافقة Migration صريحة.

## ما لم يتغير

- واجهة Creative Space ما زالت على Compatibility fixtures. أمّا `Generation V2` فيتحول إلى Runtime الدائم حين يُحقن في السيرفر المحلي؛ وثيقة الحد العام تشرح ذلك بدقة.
- Private Object Store ما زال InMemory reference، رغم أن سجل الأصل والتسوية دائمان في PostgreSQL المحلي.
- لم تُستخدم مفاتيح KIE/OpenRouter أو Supabase أو Vercel، ولم يحدث اتصال مدفوع أو نشر.

## البوابة التالية

1. تنفيذ Asset Access Gateway مرخص ودائم واختبار إعادة تشغيله.
2. ترحيل Creative Space إلى V2 تدريجياً من دون خلق مسار مالي ثانٍ.
3. بعد ذلك فقط: Migration Staging مستقلة ومراجعة أمنية/مالية قبل أي Production.
