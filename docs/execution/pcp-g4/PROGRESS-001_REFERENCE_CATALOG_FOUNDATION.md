# PCP-G4 — Reference Catalog Foundation (Local)

**الحالة:** `IN PROGRESS — LOCAL FOUNDATION PASS`  
**النطاق:** لا مفاتيح، لا استدعاء خارجي، لا Generation، لا Route، لا Offer، ولا Migration/Production.

## ما تم بناؤه

1. `Reference Catalog` مستقل عن `Provider Account` و`Route Candidate` و`Published Offer`.
2. مستورد OpenRouter مرجعي يطبع موديلات المصدر إلى `REFERENCE_ACTIVE` فقط:
   - يقبل شكل `supported_parameters` الصحيح كمصفوفة أو كـobject.
   - يحافظ على modalities، بما فيها `embedding`.
   - يستبعد aliases المتحركة (`~`) و`:free` من القائمة ذات التسعير الثابت.
3. Bundle OpenRouter يغطي أشكال المصادر العامة، والصور، والفيديو عبر reader مُحقن؛ لا يستطيع تنفيذ request تلقائي أو الوصول إلى secret.
4. مستورد KIE يقبل فقط descriptors مستخرجة من صفحة docs رسمية مع URL ودليل hash؛ لا يقبل model ID مخمناً.
5. Snapshot مرجعي immutable يحفظ source URLs ووقت الرصد وraw/manifest hashes وparser version.
6. Store يحسب diff من snapshot السابق (`ADDED`/`CHANGED`/`REMOVED`) ولا يحذف السجل التاريخي.
7. مسار Admin منفصل `REFERENCE_CATALOG_SNAPSHOT`:
   - `Draft → Validate → Simulate → Approve → Publish` مع maker/checker مستقلين.
   - يمر إلى durable Provider Control Plane كـ`CATALOG_SNAPSHOT` مع كل `REFERENCE_MODEL` التابعة له، في transaction واحدة بعد publish.
   - publish لا ينشئ runtime route أو pricing أو customer offer.
8. endpoint محلي محمي بالجلسة:
   - `GET /v1/dev/admin-v2/catalog/reference-snapshots`
   - `POST /v1/dev/admin-v2/catalog/reference-snapshots`
9. persistence schema v4 يحفظ snapshots المرجعية ويعيدها بعد restart، بلا secrets.
10. شاشة Admin الإنجليزية تعرض `Reference Catalog` كطبقة مستقلة: provider/family/model/capabilities/مراجعة Snapshot، مع وسم صريح `REFERENCE ONLY`.
11. Intake OpenRouter موثّق ومحقون: كل واحد من sources العامة (`models` و`images` و`videos`) يحمل raw SHA-256 ووقت الرصد والحجم وETag/content type عند توافرهما. لا يستطيع بناء snapshot من intake جزئي أو متجاوز لحد الحجم؛ يسجل المصدر الفاشل صراحةً بدلاً من إسقاطه بصمت.

## ما ثبت محلياً

- اختبارات importer/intake المرجعية تمر (9/9): importers، مصادر OpenRouter الثلاثة، رفض snapshot الجزئي، وevidence لكل مصدر.
- TypeScript يمرّ لـ Engine API وproviders وadmin-control-plane وprovider-control-plane.
- اختبار صريح يثبت أن اعتماد Snapshot مرجعي لا يخلق KIE/OpenRouter route ولا عرضاً للمستخدم، لكنه يثبت الـSnapshot وموديلاتها داخل Control Plane عبر restart.

## تدقيق المصادر الرسمية — 22 أغسطس 2026

- OpenRouter يعرّف قائمة النماذج العامة عبر `GET /api/v1/models`، وقائمة
  الصور عبر `GET /api/v1/images/models`، وقائمة الفيديو عبر
  `GET /api/v1/videos/models`. قائمة النموذج تعطي discoverability فقط؛
  أما قيود الـendpoint الدقيقة وأبعاد التكلفة فتأتي من سجل endpoint الخاص
  بالنموذج عند توفره. لذلك لا يمكن تحويل `pricing` أو `supported_parameters`
  الظاهرين في قائمة عامة إلى Route أو سعر عميل تلقائياً.
- OpenRouter يعرّف aliases وvariants مثل `:free` ويحل بعض الأسماء إلى slug
  canonical؛ لذا لا يجوز تسعير alias متحرك كسعر ثابت أو دمجه بصمت مع
  canonical model.
- KIE يعلن كتالوجه عبر `https://docs.kie.ai/llms.txt` وصفحات وثائق عائلية،
  وليس عبر universal model-list documented endpoint. لا يسمح المستورد إلا
  بصفحة موجودة في index رسمي، مع model ID ظاهر في request example وhash
  للدليل الخام.
- هذا التدقيق كان قراءةً لوثائق عامة فقط: لم تُرسل credentials، ولم يُقرأ
  رصيد، ولم يُستورد catalog حي، ولم يُنفذ أي request generation.

### مصادر التدقيق

- https://openrouter.ai/docs/api/api-reference/models/get-models
- https://openrouter.ai/docs/api/api-reference/images/list-image-models
- https://openrouter.ai/docs/api/api-reference/video-generation/list-videos-models
- https://openrouter.ai/docs/api/api-reference/images/list-image-model-endpoints
- https://docs.kie.ai/
- https://docs.kie.ai/llms.txt

## المتبقي لإغلاق G4

1. بناء KIE documentation descriptor pack من صفحات docs الرسمية الحية، مع parser version ودليل raw hash لكل model/SKU. لا أسماء أو أسعار مخمّنة.
2. تنفيذ **عملية Intake مصرح بها** لالتقاط المصادر الرسمية إلى raw evidence. يسجل كل مصدر على حدة مع ETag/وقت الرصد/الحجم/hash، ويجعل فشل مصدر image أو video مرئياً بدلاً من اعتماد snapshot جزئي صامت. هذه العملية لا تُشغّل الآن ولا تستعمل generation key؛ بعض endpoints الرسمية قد تتطلب مفتاح إدارة/قراءة عند توفّره.
3. توسيع Reference Model ليحفظ immutable capability schema وendpoint-evidence pointers، لا أسماء parameters فقط؛ فالـCreative Space لا يبنى من model list العامة.
4. واجهة Admin الإنجليزية لعرض `Reference Catalog` حسب provider/family/modality والحالة وdiff، مع زر review فقط — بلا Active user offer.
5. جلب endpoint-level pricing/capability records يبقى ضمن G5/G6؛ لا يكفي catalog model list لإصدار سعر أو route.

## قرار الأمان

لا توجد حالياً أي قائمة product ثابتة تدّعي أنها كتالوج KIE أو OpenRouter الفعلي. تظهر الموديلات للمشرف فقط بعد Snapshot موثق؛ وتظهر للمستخدم فقط بعد Route + Pricing + Release Bundle في البوابات اللاحقة.
