# إغلاق مرحلة PostgreSQL Durable Worker Coordination

الحالة: **مغلقة محلياً لعقود Relay/Inbox/Attempt/CAS** — لم يُربط Provider حقيقي ولم تُطبق Migration خارج الاختبار المحلي.

## ما تم تنفيذه

- Outbox دائم يدعم:
  - `PENDING → LEASED → ACKED`.
  - استعادة Lease المنتهي بعامل آخر.
  - Retry مؤرخ بواسطة `available_at`.
  - حد محاولات ثم `DEAD_LETTER` مع `last_error_code`.
  - رفض Ack/Reject من عامل لا يملك الـLease.
- Inbox دائم بمفتاح `(consumer_name, event_id)` وPayload Hash:
  - أول Delivery ينفذ الأثر مرة واحدة.
  - إعادة Delivery بالمحتوى نفسه تصبح `DUPLICATE`.
  - إعادة Event ID نفسه بمحتوى مختلف تُرفض كـConflict.
- Operation State CAS داخل PostgreSQL:
  - كل تغير State يزيد `state_version` مرة واحدة فقط.
  - تغيير Version بلا تغير State مرفوض من Trigger.
  - الانتقال يمر أيضًا عبر `requireLegalTransition` قبل الكتابة.
  - Operation Event ودليل Hash يُكتبان في معاملة الانتقال نفسها.
- Provider Attempt دائم:
  - `UNIQUE(operation_id, attempt_number)`.
  - Provider Idempotency Key فريد.
  - إنشاء Attempt والانتقال `QUEUED → DISPATCHING` في معاملة واحدة.

## أدلة الاختبار

1. عامل A استلم Outbox واستهلك Delivery ثم سقط قبل Ack.
2. بعد انتهاء Lease استلم العامل B الحدث نفسه بمحاولة رقم 2.
3. Inbox أعاد `DUPLICATE` ولم ينشئ انتقال `QUEUED` ثانيًا.
4. العامل B نفذ Ack؛ النتيجة Outbox واحد `ACKED`، Inbox واحد، وQueued Event واحد.
5. مئة Retry لإنشاء Dispatch أنتجت Attempt واحدًا وDispatch Event واحدًا.
6. مفتاح Provider مختلف لنفس Attempt رُفض كـ`ATTEMPT_CONFLICT`.
7. Retry مؤقت ثم المحاولة النهائية نقل Outbox إلى `DEAD_LETTER` ولم يعد قابلًا للمطالبة.
8. Worker يحمل State Version قديمًا رُفض، وبقيت الحالة والـEvents بلا Drift.

## الحدود المتبقية

- اختبارات العاملين تستخدم هويتين منطقيتين فوق اتصال PostgreSQL محلي واحد؛ لم تُشغّل عمليتا OS متوازيتان لأن PGlite single-connection.
- لم يُنفذ Provider submit/poll/webhook داخل هذا العامل بعد.
- لم تُربط التسوية والاسترداد الدائمان بمسار Worker الجديد بعد.
- لم تُنشأ Supabase Migration ولم يُستخدم أي Token أو Provider API.

## المرحلة التالية

**Durable Provider Attempt Lifecycle**:

1. تشغيل Provider Adapter من Attempt دائم لا من HTTP request المستخدم.
2. حفظ `SUBMISSION_UNKNOWN` قبل أي Retry غير مؤكد.
3. Lookup-before-resubmit بنفس Provider Idempotency Key.
4. حفظ Provider task identity وresponse evidence.
5. Poll/webhook Inbox إلى `PROVIDER_SUCCEEDED` أو Failure/Reconciliation.
6. بعد Private Ingest فقط: `ASSET_STORED → DELIVERED → SETTLED` بمعاملات PostgreSQL.
