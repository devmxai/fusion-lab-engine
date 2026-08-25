# FL-UI-FUX-PDR-001 — Domain Projection, Compatibility and Concurrency

> **Status:** Implemented — Gate 1 PASS locally  
> **Date:** 2026-08-24  
> **Plan:** `UI FUX.MD` — Phase 1

## 1. قرار الـSchema

- يبقى مشروع Creative Space على `schemaVersion: 1`.
- `standardProjection` حقل Optional ومؤرخ بعقد داخلي `schemaVersion: 1`؛ لذلك لا توجد حاجة إلى Migration أو نسخ بيانات الآن.
- مشروع v1 القديم من دون `standardProjection` يقرأ كـStandard projection فارغة، ويحافظ على كل بياناته.
- أي `standardProjection` بإصدار غير مفهوم أو حقول غير معتمدة تفشل مغلقة ولا يسمح بحفظ payload تقني داخلها.

## 2. ملكية البيانات

| الطبقة | الحقول | الملكية |
|---|---|---|
| Domain truth | `assets / operations / bindings` | مشتركة بين Standard وSpace ولا تنسخ |
| Server projection | drafts، sessions، gallery order، aliases، trash metadata، library preferences | تحفظ ضمن المشروع |
| Local UI only | viewer، hover، scroll، popover، selection | لا تحفظ كحقيقة مشروع |
| Forbidden | React Flow JSON، nodes/edges، provider payload/task/route IDs | مرفوضة من العقد |

`canvasItems` و`viewport` يبقيان مؤقتاً لتوافق Space والواجهة القديمة، لكن Standard الجديدة لا تكتب إليهما بعد Strangler cutover.

## 3. التوافق بين Standard وSpace

- القيمة الدائمة `PROFESSIONAL` تبقى مقروءة وتعرض باسم `Space`.
- Standard Gallery مشتقة من assets المولدة، والمراجع مشتقة من assets المصدرية.
- الانتقال بين العرضين يغير Presentation فقط؛ لا يحول assets أو operations أو bindings.
- ترتيب Gallery لا يغير lineage أو التسوية المالية.

## 4. الحفظ والتعارض

- كل حفظ يرسل `expectedVersion` و`Idempotency-Key`.
- تبويب واحد فقط ينتخب Writer؛ التبويب الثانوي يتحول إلى حالة `READ_ONLY` ثم يغادر سطح التحرير الحالي.
- تعارض `409` يوقف Autosave، يبقي التعديلات في الجلسة، يحفظ Standard draft محلياً، يقرأ النسخة الأحدث للمقارنة ولا يستبدل العمل المحلي بصمت.
- ملخص التعارض يصنف الفروق إلى: title، assets، operations، bindings، Standard projection، Space projection.
- حالات الحفظ الرسمية: `LOADING / DIRTY / SAVING / SAVED / OFFLINE / CONFLICT / ERROR / READ_ONLY`، وتظهر حالياً في Top Bar.

## 5. Offline

- Offline Standard draft له envelope مستقل ومؤرخ ويرتبط بـ`baseProjectVersion`.
- لا يخزن offline draft assets أو operations أو bindings.
- التسعير والحجز والتوليد ورفع الملفات تتوقف دون اتصال؛ يسمح فقط بتحرير المسودة.
- عند نجاح الحفظ على الخادم تحذف النسخة المحلية.

## 6. Strangler Plan

1. إضافة Standard Gallery خلف Feature Flag في Phase 4/5.
2. القراءة من `projectToStandardWorkspace` فقط.
3. منع Standard الجديدة من الكتابة إلى canvasItems/viewport.
4. تشغيل shadow comparison على مشاريع v1.
5. إزالة React Flow من Standard bundle بعد Gate التوافق، مع بقائه في Space lazy chunk.
6. لا تحويل بيانات ولا تعديل مالي خلال القطع.

## 7. دليل التنفيذ

- `standard-projection-contract.ts` — العقد والفحص الصارم.
- `standard-projection.ts` — الملكية واشتقاق Standard workspace.
- `offline-standard-draft.ts` — حفظ Offline منفصل.
- `project-save-state.ts` — حالات Autosave الرسمية.
- `project-conflict.ts` — Diff مفهوم للتعارض.
- `project-client.ts` — optimistic version + idempotency identity.
- `CreativeSpacePage.tsx` — حالات الحفظ والحظر دون اتصال وعدم الاستبدال الصامت.

## 8. نتيجة Gate 1

- `22/22` اختباراً مستهدفاً نجح.
- الاختبار الشامل للمشروع نجح: `590/590` عبر `114/114` ملفات اختبار.
- TypeScript الكامل لكل التطبيقات والحزم نجح.
- Production build نجح: `2369` modules transformed.
- مشروع schema v1 فتح في Standard وSpace وحُفظ وأعيد فتحه بلا فقد.
- لا React Flow JSON أو provider payload داخل `standardProjection`.

**Gate 1 decision:** `PASS — 2026-08-24`.
