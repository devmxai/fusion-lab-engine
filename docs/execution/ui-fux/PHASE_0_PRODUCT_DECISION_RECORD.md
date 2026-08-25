# FL-UI-FUX-PDR-000 — Scope and Terminology Freeze

> **Status:** Accepted and implemented  
> **Date:** 2026-08-24  
> **Plan:** `UI FUX.MD` — Phase 0  
> **Owner:** FusionLab Product + UI Architecture

## القرار

1. المنتج يعرض وضعين فقط: `Standard` و`Space`.
2. القيمة الدائمة القديمة `PROFESSIONAL` تبقى مقروءة داخلياً للتوافق، لكن تعرض دائماً باسم `Space`.
3. الواجهتان المدعومتان مستقلتان: `en` باتجاه `LTR` و`ar` باتجاه `RTL`. أسماء المنتج الرسمية `Standard` و`Space` لا تترجم، بينما بقية النصوص تأتي من كتالوج اللغة المختارة لاحقاً في Phase 4.
4. أول Vertical Slice كامل هو `IMAGE`.
5. `assets` و`operations` و`bindings` هي حقيقة المشروع الواحدة. `Standard` هو Gallery projection و`Space` هو Graph projection لنفس المشروع.
6. قائمة النماذج المسموح عرضها للمستخدم تأتي حصراً من `Published Offers`؛ لا يوجد Catalog ثابت أو نموذج غير منشور داخل واجهة التوليد.
7. الاسم المحايد للمشروع في النصوص هو `Project Studio` لمنع الخلط بين المشروع و`Space` view.

## حدود Standard المعتمدة

يعرض Standard: Composer، references، results cards، lineage مبسط، quick actions، quote وحالة التوليد.

لا يعرض Standard: nodes، handles، ports، persistent edges، provider task IDs، route IDs، raw provider payload، pricing formulas، reconciliation internals، minimap أو graph debug controls.

## ضمانات التوافق

- لا تغيير لقيمة `SpaceViewMode` الدائمة في Phase 0.
- لا Migration ولا تحويل للمشاريع الموجودة.
- نشاطات المشاريع القديمة التي تبدأ بـ`Professional` تُطبع للمستخدم باسم `Space` من دون تعديل الوثيقة المحفوظة.
- الأنواع والدوال الداخلية القديمة يمكن أن تبقى مؤقتاً لأنها ليست نصاً موجهاً للمستخدم.

## دليل التنفيذ

- عقد القرار القابل للاختبار: `src/features/creative-space/product-decisions.ts`.
- اختبارات القرار والتوافق: `src/features/creative-space/product-decisions.test.ts`.
- التسميات المرئية الحالية في `CreativeSpacePage.tsx` تستخدم `Standard / Space`.
- خريطة المصطلحات: `TERMINOLOGY_MAP.md`.

## قرار Gate 0

`PASS` عندما تنجح اختبارات العقد وTypeScript، ولا يبقى ظهور مباشر لكلمة `Professional` في واجهة Creative Space أو رسائل النشاط الجديدة. هذا القرار لا يعني اكتمال إعادة تصميم Standard؛ التنفيذ التالي هو Phase 1.

## نتيجة التحقق

- `14/14` اختباراً مستهدفاً نجح، وتشمل عقد Phase 0 وتوافق Professional/Space Graph الداخلي.
- فحص TypeScript الكامل لكل تطبيقات وحزم المشروع نجح.
- Production build نجح (`2364` modules transformed).
- المسح النصي للتسميات المرئية المحظورة نجح بلا نتائج.

**Gate 0 decision:** `PASS — 2026-08-24`.
