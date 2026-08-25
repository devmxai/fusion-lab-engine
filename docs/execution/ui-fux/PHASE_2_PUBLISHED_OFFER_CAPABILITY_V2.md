# FL-UI-FUX-PDR-002 — PublishedOffer Capability Contract v2

> **Status:** Implemented — Gate 2 PASS locally  
> **Date:** 2026-08-24  
> **Plan:** `UI FUX.MD` — Phase 2

## 1. العقد المعتمد

`PublishedOffer contractVersion: 2` هو السلطة الوحيدة لعرض نموذج أو وصفة أو Control للعميل. لم يُنشأ Catalog أو Manifest موازٍ.

يتضمن العقد:

- هوية العميل: `offerId / displayName / providerId`.
- الهوية الرسمية: `familyId / officialModelId / providerId`.
- Capability مؤرخة: `schemaVersion: 2 / capability id / version / mediaType`.
- وصفات منشورة صريحة؛ لا يستنتج العميل الوصفات من اسم النموذج أو الشركة.
- Controls وconstraints وUI metadata وconditional visibility.
- pins تجارية: customer price، commercial recipe، release bundle/version.
- Evidence مثبتة: capability version، control schema version، catalog snapshot، commercial registry hash، contract hash.

## 2. سلسلة الربط

```text
Reference Model Family
  -> Official Provider Model ID
  -> Internal Route Candidate + immutable version
  -> Commercial Route/Capability/Recipe/Price versions
  -> Release Bundle maker/checker
  -> Customer Published Offer v2
```

الـRoute والـAccount والـCredential تبقى داخل الخادم ولا تُكشف في واجهة العميل. العميل يرسل `offerId` فقط، والخادم يحل الربط المجمد.

## 3. v1 إلى v2

- يوجد Adapter واحد يحول v1 صالحاً بالكامل إلى الشكل الداخلي v2.
- v1 المحول يحمل `evidence.level = LEGACY_ADAPTED` وhashes فارغة؛ لا يتم اختلاق دليل غير موجود.
- الخادم الحالي يصدر v2 موثقاً بـ`SERVER_VERIFIED`.
- `contractVersion` أو `capability.schemaVersion` غير المفهومة، identity mismatch، hash غير صالح، recipe/control malformed: فشل مغلق وإيقاف Catalog.

## 4. Conditional Controls والقيود

- أنواع Control: enum، number، boolean.
- القيود: values/default، min/max/step.
- UI metadata: `labelKey / BASIC|ADVANCED / order`.
- `visibleWhen` يدعم `EQUALS / NOT_EQUALS / IN`.
- الشرط لا يشير إلا إلى Control سابق داخل الوصفة؛ يمنع cycles والتقييم غير الحتمي.
- الخادم يرفض Release يحتوي شرطاً مجهولاً أو متقدماً أو Metadata غير صالحة.

## 5. Compatibility Diff

قبل تغيير العرض/النموذج ينتج العقد:

- bindings المحتفظ بها.
- bindings غير المتوافقة مع سبب role/kind/limit.
- settings المحتفظ بها.
- settings التي تعود إلى default.
- settings المحذوفة والجديدة.
- `quoteInvalidated` لإجبار Quote جديد عند أي تغيير مؤثر.

لا يطبق العميل فقداً صامتاً؛ واجهة التأكيد ستبنى في Phase 5 على هذا الـDiff.

## 6. حدود الأمان

- لا model/provider exception داخل Composer.
- `controlSchema.recipes` هي Recipe authority؛ inputModes العامة لا توسعها.
- القيم الغريبة تحذف، والقيم غير الصالحة تعود إلى default المنشور.
- stale client لا يستطيع توسيع Capability لأن الخادم يعيد التحقق قبل Quote.
- لا provider cost، endpoint، credential، account ID أو raw payload في projection العميل.

## 7. دليل التنفيذ

- `packages/commercial-engine/src/types.ts` — conditional/UI contract.
- `packages/commercial-engine/src/durable-registry-repository.ts` — release-time validation.
- `packages/provider-control-plane/src/postgres-repository.ts` — v2 customer projection وevidence hash.
- `src/features/creative-space/published-offers-client.ts` — v1 adapter، v2 parser، controls وCompatibility Diff.
- Server/client/repository/registry contract fixtures محدثة.

## 8. نتيجة Gate 2

- `40/40` اختباراً مستهدفاً نجح عبر العميل وEngine API وProvider Control Plane وCommercial Registry.
- الاختبار الشامل للمشروع نجح: `593/593` عبر `114/114` ملفات اختبار.
- TypeScript الكامل لكل التطبيقات والحزم نجح.
- Production build نجح: `2369` modules transformed.
- لا يحتاج أي Control إلى branch حسب model ID؛ كل السلوك يأتي من العقد أو Adapter النسخ.

**Gate 2 decision:** `PASS — 2026-08-24`.
