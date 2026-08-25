# FusionLab — UI FUX Standard Mode Plan

> **Document ID:** FL-UI-FUX-001  
> **Revision:** 2.5 — Phase 4 shell baseline  
> **Status:** Approved for phased implementation  
> **Scope:** Standard Mode UI/UX فقط  
> **Next document:** `UI Space Mode Plan`  
> **Parent plan:** `docs/PROFESSIONAL_MASTER_PLAN_PLATFORM_WITH_ENGINE_AR.md`  
> **Language:** واجهتان مستقلتان `English` و`العربية`؛ يمنع المزج داخل النسخة الواحدة  
> **Last reviewed:** 2026-08-24

---

## 1. غرض الوثيقة

تحدد هذه الوثيقة الهيكل المنتجـي والهندسي الكامل لواجهة `Standard Mode` في FusionLab قبل البدء بأي تنفيذ. الهدف هو استبدال عرض `Standard` الحالي القائم على Canvas تدريجياً بتجربة توليد واضحة وسريعة تعتمد على:

```text
Side Composer
+ Capability-driven Controls
+ Adaptive Results Gallery
+ Reusable References
+ Exact Quote and Generation Lifecycle
```

اعتمد المستخدم بدء التنفيذ المرحلي بتاريخ 2026-08-24. ينفذ كل Phase ببوابته ودليله القابل لإعادة الفحص؛ ولا يسمح هذا الاعتماد بتجاوز بوابات التوافق أو الدقة المالية أو إطلاق Route غير مكتمل.

### 1.1 حالة التنفيذ

| Phase | الحالة | الدليل | التالي |
|---|---|---|---|
| Phase 0 — Scope and Terminology Freeze | `PASS` محلياً | `docs/execution/ui-fux/PHASE_0_PRODUCT_DECISION_RECORD.md` | مغلق |
| Phase 1 — Domain Projection، Migration، وConcurrency | `PASS` محلياً | `docs/execution/ui-fux/PHASE_1_DOMAIN_PROJECTION_AND_CONCURRENCY.md` | مغلق |
| Phase 2 — PublishedOffer Capability Contract v2 | `PASS` محلياً | `docs/execution/ui-fux/PHASE_2_PUBLISHED_OFFER_CAPABILITY_V2.md` | مغلق |
| Phase 3 — UX Architecture، Prototype، وOfficial Assets | `PASS` محلياً؛ اعتماد بصري بشري لاحق | `docs/execution/ui-fux/PHASE_3_UX_ARCHITECTURE_PROTOTYPE_AND_BRAND_ASSETS.md` | Phase 4 |
| Phase 4 — Standard Shell and Design System | `PASS` محلياً؛ مراجعة أجهزة حقيقية لاحقاً | `docs/execution/ui-fux/PHASE_4_STANDARD_SHELL_AND_DESIGN_SYSTEM.md` | Phase 5 |
| Phase 5 — Image Vertical Slice End-to-End | `PASS` محلياً؛ اعتماد بشري/Production لاحق | `docs/execution/ui-fux/PHASE_5_IMAGE_VERTICAL_SLICE_WORKLOG.md` | Phase 6 |
| Phase 6–14 | `PENDING` | لا يبدأ Phase قبل إغلاق السابق | Phase 6 — Image Reliability and Advanced Image |

---

## 2. العلاقة بالخطة الأساسية

يرتبط هذا البلان بالمراحل التالية من الخطة الأساسية:

| المرحلة الأساسية | مساهمة UI FUX |
|---|---|
| Stage 9 — Creative Space Foundation | Shell، responsive layout، tokens، i18n، accessibility، project projection |
| Stage 10 — Standard Image-first | أول Vertical Slice إنتاجي: Image composer، quote/generate، result، viewer، download، reuse، lineage |
| Stage 11 — Video/Audio/Multimodal/Mobile | Video composer، Audio TTS، multimodal bindings، mobile UX |
| Stage 17 — Professional Graph | خارج هذا البلان؛ يعاد تعريفه في الواجهة باسم `Space` |

الـDomain Graph الحالي يبقى حقيقة المشروع الواحدة. `Standard` و`Space` هما Projection مختلفان لنفس البيانات، وليس نظامين أو Backend منفصلين. لا يحفظ `React Flow JSON` ولا ترتيب الـGallery كحقيقة مالية أو تشغيلية.

---

## 3. القرارات الثابتة

### 3.1 التسمية

- الاسم الظاهر للمستخدم: `Standard` و`Space` فقط.
- يمنع ظهور `Professional` في واجهة المستخدم، الرسائل، الاختبارات المرئية، أو مواد المساعدة.
- تبقى القيمة الداخلية القديمة `PROFESSIONAL` مقروءة مؤقتاً وتُعرض للمستخدم باسم `Space`؛ أي تحويل دائم لها يحتاج `schemaVersion` واختبارات backward compatibility.
- يمنع استخدام كلمة `Space` للدلالة على المشروع نفسه داخل النصوص التي قد تخلط بين `Creative Space` و`Space View`؛ الاسم المحايد للمشروع هو `Project Studio`.

### 3.2 اللغة والاتجاه

- المنتج يوفر Locale مستقلين: `en` و`ar`.
- النسخة الإنجليزية لا تعرض نصوصاً عربية، والنسخة العربية لا تخلط جملاً إنجليزية؛ تبقى فقط الأسماء الرسمية غير القابلة للترجمة مثل أسماء Models/Providers.
- النصوص، الأخطاء، حالات العملية، المساعدة، وAccessibility labels تأتي من Catalog ترجمة واحد typed ومختبر.
- تغيير اللغة لا يغير بيانات المشروع أو Prompt أو الاختيارات.
- اتجاه اللوحة `LTR` للإنجليزية و`RTL` للعربية، مع BiDi isolation للمعرفات والقيم التقنية.

### 3.3 الفصل بين العرضين

**Standard يعرض:**

- Composer جانبي.
- Inputs وReferences على شكل Chips/Tray.
- نتائج على شكل Cards.
- Lineage مبسط.
- Quick actions.
- Quote وGeneration lifecycle.

**Standard لا يعرض:**

- Node handles.
- Technical ports.
- Persistent graph edges.
- Provider task IDs.
- Route IDs أو raw provider payload.
- Pricing formulas أو reconciliation internals.
- Minimap أو graph debug controls.

الانتقال من Standard الحالي إلى Gallery يتم بطريقة Strangler:

1. إضافة Projection الجديدة خلف Feature Flag.
2. قراءة نفس `assets/operations/bindings` بلا نسخ بيانات.
3. منع أي كتابة جديدة تعتمد على React Flow من Standard.
4. التحقق من المشاريع القديمة ثم إزالة Standard Canvas فقط بعد اجتياز Gate التوافق.

**Space لاحقاً يعرض:**

- Asset وOperation nodes.
- Semantic ports وedges.
- Groups وsubflows وtemplates.
- Advanced orchestration.
- نفس المشروع من دون تحويل بيانات.

### 3.4 مبدأ البساطة

- يستطيع المستخدم تنفيذ أول توليد بعد اختيار النموذج وكتابة Prompt فقط عندما تسمح قدرات النموذج بذلك.
- لا تظهر أكثر من 4–5 إعدادات أساسية في المستوى الأول.
- جميع الإعدادات الأقل استخداماً توضع داخل `Advanced`.
- لا يظهر Control لا تدعمه الـCapability المنشورة للمسار المحدد.
- لا يحذف تغيير النموذج أو الـMode أي Reference أو Setting بصمت.

---

## 4. أهداف المنتج

1. تقليل الزمن من فتح المشروع إلى أول Generate.
2. إطلاق Image-first كأول مسار مكتمل؛ يصبح تغيير المسار الافتراضي لاحقاً قرار Product مبنياً على Usage Data وليس افتراضاً داخل الخطة.
3. تمكين إعادة استخدام أي Output كمدخل لتوليد جديد.
4. منع الخيارات الوهمية أو غير المتوافقة مع النموذج.
5. ضمان كتابة عربية/إنجليزية صحيحة داخل Prompt وScript.
6. إظهار التكلفة بوضوح قبل الحجز والتنفيذ.
7. الحفاظ على Aspect Ratio الحقيقي لكل نتيجة.
8. إبقاء Standard بسيطاً مع قابلية الانتقال إلى Space لاحقاً.
9. دعم mouse، keyboard، touch، وscreen reader.
10. الحفاظ على الأداء مع 100 بطاقة على الأقل.

---

## 5. خارج النطاق

- تنفيذ Space nodes أو graph editor.
- Text generation كوسيط مستقل.
- AI Assistant أو Prompt Enhancer الكامل.
- Timeline احترافي متعدد المسارات.
- Video editor غير خطي.
- تدريب النماذج أو Fine-tuning.
- Voice cloning ما لم ينشر Route معتمداً بذلك.
- إضافة كل النماذج المتاحة في السوق.
- إظهار قدرات تسويقية قبل اعتماد Endpoint فعلي واختباره.

---

## 6. Information Architecture

```text
Project Studio
├── Top Bar
│   ├── Project identity
│   ├── Save state
│   ├── Undo / Redo
│   ├── Activity / Queue
│   ├── Credits
│   └── Standard / Space switch
├── Standard Composer
│   ├── Media tabs
│   ├── Model picker
│   ├── Model variant
│   ├── Generation method
│   ├── Reference tray
│   ├── Basic settings
│   ├── Prompt / Script editor
│   ├── Advanced settings
│   └── Quote / Generate bar
└── Results Workspace
    ├── Empty state
    ├── Generation sessions
    ├── Queue summary
    ├── Placeholders
    ├── Image cards
    ├── Video cards
    ├── Audio cards
    └── Media viewer
```

---

## 7. Desktop Layout

### 7.1 القياسات

| العنصر | القياس المستهدف |
|---|---:|
| Top bar | `56–60px` |
| Outer inset | `16px` |
| Composer — Wide | `448px` عند `≥1440px` |
| Composer — Default | `420px` عند `1280–1439px` |
| Composer — Compact | `392px` |
| Collapsed rail | `56px` |
| Results padding | `24px` |
| Control height | `44px` desktop، `48px` touch |
| Prompt initial height | `160–192px` |
| Prompt maximum soft height | `280px` |

### 7.2 السلوك

- Composer ثابت في جانب الصفحة وقابل للطي يدوياً.
- لا يطوى تلقائياً أثناء الكتابة أو التوليد.
- Results Workspace تستخدم scroll طبيعي، وليست infinite canvas.
- النتيجة الجديدة تضاف بنظام append داخل Generation Session الحالية.
- إذا كان المستخدم بعيداً عن موضع النتيجة، يظهر Toast مع `View result` ولا تتحرك الكاميرا قسراً.

### 7.3 موضع Composer

ينتج Prototype باتجاهين قبل التثبيت النهائي، لكن القرار لا يخلط ترتيب اللغتين:

- Left Composer هو baseline للواجهة الإنجليزية `LTR`.
- Right Composer هو baseline للواجهة العربية `RTL`.

قرار الجهة النهائية يعتمد على usability test، بينما ترتيب المحتوى الداخلي يبقى ثابتاً.

---

## 8. Visual System

### 8.1 Design Tokens المبدئية

```text
Canvas:            #090B0F
Panel:             #0D1015
Elevated surface:  #141820
Border default:    rgba(255,255,255,.10)
Border hover:      rgba(255,255,255,.22)
Text primary:      rgba(255,255,255,.95)
Text secondary:    rgba(255,255,255,.65)
```

### 8.2 Radius وSpacing

```text
Control radius: 12px
Panel radius:   20px
Card radius:    16–20px
Viewer radius:  24px
Spacing scale:  4 / 8 / 12 / 16 / 20 / 24 / 32
```

### 8.3 قواعد الهوية

- ألوان النظام تستخدم للحالات الدلالية فقط.
- لا يمنح كل نموذج لون UI مختلفاً.
- هوية النموذج تأتي من الشعار الرسمي والاسم.
- لا تستخدم gradients أو glow بشكل يقلل وضوح النص.
- Focus ring واضح بسماكة `2px`.

### 8.4 Theme وTypography

- الإصدار الأول `Dark-first` وليس `Dark-only`؛ لا يعد Light Theme مدعوماً حتى اعتماد Tokens واختباراته بشكل مستقل.
- يثبت خط عربي وخط Latin بوزن بصري متوازن وfallback لا يسبب layout shift.
- الأرقام والعملات والتواريخ تتبع Locale، بينما Model IDs وratios وdurations تبقى داخل LTR isolation.
- لا يعتمد أي قياس على طول النص الإنجليزي فقط؛ تختبر العربية والإنجليزية في كل Component.

---

## 9. Composer Structure

الترتيب الإجباري من الأعلى إلى الأسفل:

1. `Image / Video / Audio` Tabs.
2. Select Model.
3. Variant / Version عند وجود أكثر من Variant صالح.
4. Generation Method.
5. Reference/Input Tray عند الحاجة.
6. Basic Settings.
7. Prompt أو Script Editor.
8. Advanced Settings مطوية.
9. Final Quote + Generate.

### 9.1 Media Tabs

- الترتيب الأولي: Image ثم Video ثم Audio.
- Image هو Tab الافتراضي حتى اجتياز Image-first Gate؛ أي تغيير لاحق يمر بقرار Product وTelemetry.
- كل Tab يحتفظ بـDraft مستقل versioned داخل Project Standard Projection، لا في React component state وحده.
- Tabs تستخدم `role="tablist"` وتدعم الأسهم وHome/End.
- لا يظهر Text كTab معطل.

### 9.2 Progressive Disclosure

- Reference Tray لا تظهر في Text-only mode بلا References.
- Last Frame لا يظهر إلا عند دعم First/Last.
- Audio toggle لا يظهر إلا إذا كان المسار يسمح بتعطيله أو تفعيله.
- Advanced لا يحتوي تكراراً للإعدادات الأساسية.
- عند عدم توفر Catalog يظهر Empty/Error state في مكان Model Picker، لا صفحة معطلة بالكامل.

---

## 10. Model Picker

### 10.1 الشكل

- Popover ملتصق بالـTrigger.
- العرض `360–400px`.
- Search يظهر عند تجاوز 7–8 عناصر.
- لا يظهر كنافذة عائمة بعيدة عن اللوحة.

### 10.2 صف النموذج

```text
[Official logo]  Model name
                 Provider · Variant · Stage
                 Short capability summary
```

كل صف يتضمن:

- شعاراً رسمياً بحجم بصري يقارب `28×28px`.
- الاسم الرسمي الكامل.
- Provider.
- Variant أو Version.
- `Preview` أو `GA` عند الحاجة.
- وصفاً قصيراً من دون نص تسويقي طويل.

### 10.3 قواعد الاختيار

- لا يُنشأ تسلسل عام `Standard / Pro / Mini`.
- Variant تظهر فقط إذا كانت Variant رسمية أو Route منشوراً.
- يمكن تعيين Recommended افتراضياً، لكن يبقى اسم النموذج الفعلي ظاهراً.
- تغيير النموذج ينفذ Compatibility Analysis قبل تعديل Draft.
- الخيارات غير المتاحة للحساب أو المنطقة لا تظهر كأنها قابلة للتنفيذ.

---

## 11. Official Logo Asset Policy

لكل شعار Model/Provider يجب وجود سجل:

```text
assetId
displayName
officialSourceUrl
retrievedAt
licenseOrUsageNote
sha256
lightVariant
darkVariant
fallbackPolicy
```

القواعد:

- تخزين الشعارات محلياً بعد اعتماد المصدر.
- يمنع hotlink إلى CDN خارجي في واجهة الإنتاج.
- يمنع اختراع Monogram يوحي بأنه شعار رسمي.
- لا يقص الشعار إلى دائرة إذا كان ذلك يشوه هندسته.
- إذا لم يوجد شعار مستقل للموديل، يستخدم شعار المزود الرسمي مع اسم الموديل.
- إذا تعذر اعتماد أصل رسمي، يظهر الاسم نصياً بلا شعار وهمي.

---

## 12. Curated Model Research Appendix

هذه القائمة تحدد نطاق البحث فقط وليست Catalog ثابتاً ولا Authorization للإظهار. مصدر الحقيقة الوحيد لواجهة الإنتاج هو المسار التالي:

```text
Imported provider catalog
→ Admin-selected model
→ Proven provider pricing
→ Certified route and capability evidence
→ Published customer offer
```

ظهور أي نموذج يتطلب اكتمال السلسلة أعلاه. الأسماء والإصدارات في هذا الملحق قابلة للحذف أو التغيير وفق Evidence المؤرخة، ولا تكتب كاستثناءات داخل UI.

### 12.1 Video

| Family | Initial variants/modes policy |
|---|---|
| Grok Imagine Video | 1.5؛ T2V/I2V/Reference/Edit/Extend حسب Route |
| Seedance | 2.0 أولاً؛ 2.5 عند اعتماد Endpoint فعلي |
| Veo | 3.1 / Fast / Lite حسب سطح API |
| Kling AI | Video 3.0 / Omni حسب Route |
| HappyHorse | 1.1 T2V/I2V/R2V |
| FLUX | FLUX 3 Video Preview فقط بالقدرات المنشورة فعلياً |

### 12.2 Image

| Family | Initial variants/modes policy |
|---|---|
| Nano Banana | Nano Banana 2 وNano Banana Pro |
| OpenAI Image | GPT Image 2 |
| Seedream | Seedream 5.0 Pro أو Route المعتمد |
| FLUX | FLUX.2 variants المنشورة |
| Grok Imagine Image | 2.0 عند اعتماد Route |

### 12.3 Audio

| Family | Initial variants/modes policy |
|---|---|
| Gemini TTS | 3.1 Flash TTS Preview |
| Gemini TTS | 2.5 Flash TTS Preview |
| Gemini TTS | 2.5 Pro TTS Preview |

### 12.4 قواعد الحجب

- Seedance 2.5 لا يظهر لمجرد أنه يدعم 30 ثانية؛ يلزم Route حقيقي ومختبر.
- FLUX 3 لا يعرض Video Editing أو Omni Reference قبل توفرها في الـAPI المستخدم.
- لا تخلط أسماء Model Family مع IDs الخاصة بمزود وسيط.
- لا تفترض تساوي Gemini API وVertex وKIE في قدرات Veo.
- لا تدخل Hailuo ضمن HappyHorse؛ هما عائلتان مختلفتان.

---

## 13. Capability Contract

هذا العقد هو `PublishedOffer Capability Contract v2`، وهو تطوير versioned للعقد الحالي `PublishedOffer.capability/controlSchema` وليس Manifest موازياً. كل Published Offer/Route يجب أن ينتج Manifest ثابتاً ومؤرخاً:

```text
family
officialModelId
providerId
providerRouteId
mediaKind
variants
generationModes
inputSlots[]
outputRules
controls[]
pricingDimensions
releaseStage
evidenceUrl
observedAt
manifestVersion
manifestHash
```

### 13.0 قواعد التوافق والترقية

- يقرأ العميل `v1` الحالي أثناء فترة الانتقال ويحوّله إلى Projection داخلية فقط.
- لا يكتب العميل Capability ولا يوسعها؛ الخادم يعيد التحقق قبل Quote.
- أي حقل جديد يضاف عبر schema version وfixtures وcontract tests، لا عبر model-specific condition داخل Component.
- لا ينشر `v2` قبل Mapping واضح من الحقول الحالية: `mediaType/inputModes/semanticSlots/maxReferences/resolutions/durationSeconds/controlSchema`.
- فشل فهم نسخة العقد يؤدي إلى Fail Closed ورسالة Catalog update required، لا إلى Controls افتراضية مخمنة.

### 13.1 Input Slot

```text
role
modality
required
minCount
maxCount
acceptedMimeTypes
maxFileSize
maxDuration
mentionTokenPolicy
orderingPolicy
```

### 13.2 Output Rules

```text
aspectRatios
resolutions
durations
fps
audioPolicy
outputCount
conditionalConstraints
```

### 13.3 Control Types

```text
enum
discrete
range
boolean
text
promptDirective
promptTag
postProcess
```

تتطلب الأنواع الجديدة ترقية صريحة من الأنواع الحالية `enum/number/boolean`. لا يستخدم `promptDirective` أو `promptTag` كقدرة Native، ويخزن نوعه ومصدره داخل Manifest.

### 13.4 UI Interpretation

- `range` المستمر يستخدم Slider.
- القيم المنفصلة مثل `4/6/8` تستخدم Segmented Control أو Discrete Slider.
- Setting المشروط لا يظهر قبل تحقق شرطه.
- I2V الذي يرث نسبة المصدر لا يعرض Ratio قابل للتغيير.
- السعر يعاد حسابه بعد كل تغيير يؤثر في التكلفة.
- كل عملية تخزن نسخة Manifest المستخدمة وقت الإنشاء.

---

## 14. Video Composer

### 14.1 Generation Methods

- Text to Video.
- Image to Video.
- First and Last Frame.
- Reference to Video.
- Video Continuation.
- Video Edit عند اعتماد Route.
- Motion Control/Avatar كRecipes منفصلة عند اعتماد مدخلاتها.

### 14.2 Basic Controls

- Model/Variant.
- Generation Method.
- Aspect Ratio عندما يكون قابلاً للاختيار.
- Duration.
- Resolution.
- Audio generation عندما تكون قابلة للتبديل.

### 14.3 قواعد المدة

- لا يستخدم Slider متصل لقيم منفصلة.
- تعرض القيمة الحالية بوضوح مع الوحدة.
- تعرض القيود الناتجة عن Resolution أو Reference mode فوراً.
- لا يسمح بإدخال مدة ينتج عنها Quote غير قابل للتنفيذ.

### 14.4 References

- First Frame وLast Frame لهما Slots منفصلة.
- Multi-reference يحافظ على ترتيب ثابت.
- Reference Image، Reference Video، وReference Audio لا تخلط في عداد واحد إذا كان المزود يعدها منفصلة.
- Syntax المزود يولد في Adapter ولا يكتب مباشرة داخل Domain Draft.

---

## 15. Image Composer

### 15.1 Generation Methods

- Text to Image.
- Image Edit.
- Multi-reference Edit.
- Remix/Variation.
- Inpaint/Outpaint عندما يعتمد محرر Mask.
- Upscale كRecipe مستقلة إذا كان Route مستقلاً.

### 15.2 Basic Controls

- Model/Variant.
- Generation Method.
- Aspect Ratio أو Dimensions.
- Quality/Resolution عند الدعم.
- Output count عند الدعم.

### 15.3 قواعد المراجع

- يطبق الحد الفعلي لكل Route.
- يظهر دور المرجع عند وجود أدوار مختلفة مثل Subject/Style/Source.
- لا يفترض أن جميع النماذج تدعم العدد نفسه.
- نتيجة Image يمكن استخدامها مباشرة كمرجع أو First Frame للفيديو.

---

## 16. Audio Composer

### 16.1 الترتيب

1. Model.
2. Speaker Mode.
3. Voice selection.
4. Language.
5. Script Editor.
6. Performance controls.
7. Preview.
8. Quote + Generate.

### 16.2 Speaker Mode

- Single Speaker.
- Conversation — Two Speakers عند دعم Route.
- صوت مستقل لكل متحدث.
- يمنع عدد متحدثين أكبر من الحد الفعلي.

### 16.3 Voice Browser

- الاسم الرسمي للصوت.
- الوصف الرسمي فقط.
- Preview قصير.
- حالة الاختيار.
- لا يخترع جنس أو عمر للصوت من دون مصدر.

### 16.4 Performance Controls

تصنف كل خاصية بوضوح:

| النوع | أمثلة |
|---|---|
| Native parameter | Model، Voice، Speaker config، Language |
| Prompt directive | Style، Accent، Pace، Tone، Persona |
| Prompt tag | Laughs، Whispers، Crying، Shouting |
| Post-process | Format conversion، loudness normalization |
| Unsupported | Pitch/Stability رقميان إذا لم يدعمهما Route |

### 16.5 اللهجة العراقية

- `Arabic` يمكن أن تعرض كلغة مدعومة.
- `Iraqi Arabic` تعرض كتوجيه Accent/Dialect.
- Presets مثل `Iraqi Urban` و`Iraqi Heritage` تحمل شارة `Fusion Preset` أو `Experimental Direction`.
- يمنع وصفها بأنها خيارات Google رسمية مضمونة ما لم تتغير الوثائق والقدرات لاحقاً.

### 16.6 Script Editor

- يحافظ على الأسطر والفقرات.
- لا يضغط whitespace.
- يدعم Blocks للحوار.
- يعرض token estimate وتحذير النص الطويل.
- يسمح بمعاينة جزء محدد من النص وفق سياسة Credits واضحة.

---

## 17. Prompt and BiDi System

### 17.1 القواعد

```text
dir="auto"
text-align: start
unicode-bidi: plaintext
```

- Model IDs، ratios، durations، credits، وmentions تعزل داخل LTR bidi isolation.
- أسماء المتحدثين تعزل عن نص الحوار.
- يدعم المحرر copy/paste والاختيار لنص عربي/إنجليزي مختلط.
- لا يعتمد على `dir=rtl` على مستوى اللوحة فقط.

### 17.2 الاختبارات النصية الإلزامية

- عربية فقط.
- إنجليزية فقط.
- عربية مع أسماء Models إنجليزية.
- عربية مع أرقام وRatios.
- Prompt يحتوي `@image1` و`@video1`.
- Script عربي مع Audio Tags إنجليزية.
- علامات ترقيم وأقواس واقتباسات مختلطة.

---

## 18. Reference Tray and Mentions

### 18.1 طرق الإضافة

- Drag Card to Tray.
- `Use as Reference` من البطاقة.
- `Add Reference` من Composer.
- اختيار من Project Library.

### 18.2 Reference Chip

يحتوي:

- Thumbnail أو media icon.
- اسم الأصل.
- الدور.
- Alias ثابت.
- Change Role.
- Remove.
- Validation state.

### 18.3 Mention System

- الضغط على `@` يعرض References المتوافقة والمضافة فقط.
- Alias يعتمد على Binding ordinal، لا مكان البطاقة.
- Mention UI يعرض thumbnail والدور.
- Provider Adapter يحول Alias الداخلي إلى Syntax المزود.
- حذف Reference مستخدم في Prompt يطلب تسوية الـMention بدلاً من ترك token مكسور.

### 18.4 Compatibility Diff

قبل تغيير Model أو Method يعرض:

- References التي ستبقى.
- References غير المتوافقة.
- Settings التي ستتغير.
- Settings التي ستعود إلى Default.
- أثر التغيير على Quote.

لا يطبق التغيير قبل موافقة المستخدم عندما توجد خسارة محتملة.

### 18.5 Standard Projection Data Contract

يضاف عقد Optional ومؤرخ إلى وثيقة المشروع؛ لا ينسخ Assets أو Operations ولا يستبدلها:

```text
standardProjection
  schemaVersion
  draftsByMedia
  generationSessions[]
  galleryOrder[]
  referenceAliases[]
  trashEntries[]
  libraryPreferences
  updatedAt
```

قواعد الملكية:

- `assets/operations/bindings` هي Domain truth المشتركة بين Standard وSpace.
- Drafts وGeneration Sessions وTrash metadata تحفظ على الخادم لأنها يجب أن تنجو من refresh وتبديل الجهاز.
- فتح Viewer، hover، scroll position، popover state، وselection المؤقت تبقى UI state محلية.
- Gallery order هو Presentation projection فقط ولا يغير lineage أو ترتيب العمليات المالي.
- المشروع الحالي `schemaVersion: 1` يبقى مقروءاً؛ الحقول الجديدة Optional أولاً، وأي انتقال إلى `schemaVersion: 2` يحتاج forward migrator واختبار round-trip للمشاريع القديمة.
- يمنع حفظ React Flow nodes/edges أو provider payload داخل `standardProjection`.

### 18.6 الحفظ المتزامن وOffline

- كل Save يحمل `projectVersion` وidempotency key.
- تعارض النسخة يعيد أحدث نسخة ويعرض Diff قابل للفهم؛ لا تستخدم last-write-wins بصمت.
- Draft النصي يمكن دمجه فقط عندما يكون الدمج آمناً؛ References وOperations تحتاج اختيار المستخدم عند التعارض.
- ظهور تعديل من Tab/Device آخر يوقف الكتابة التلقائية حتى تحميل النسخة الأحدث أو إنشاء Copy.
- Offline يسمح بتحرير Draft فقط؛ Quote/Reserve/Generate/Delete النهائي تبقى معطلة.
- Autosave يعرض حالات `Saving / Saved / Offline / Conflict` في Top Bar.

---

## 19. Results Workspace

### 19.1 نموذج العرض

- Adaptive/Justified Gallery.
- ترتيب DOM يطابق الترتيب البصري.
- لا يستخدم Masonry عشوائي يفسد keyboard order.
- النتائج تجمع داخل Generation Sessions زمنية.
- Filters تؤجل لما بعد الإصدار الأول إلا إذا أثبت الاختبار ضرورتها.

### 19.2 القياسات

| الخاصية | الهدف |
|---|---:|
| Target row height | `220–260px` |
| Practical minimum card width | نحو `220px` |
| Card radius | `16–20px` |
| Hover translation | `-2px` فقط |

### 19.3 Aspect Ratio

- Media viewport يحافظ على النسبة الفعلية.
- يمنع crop الافتراضي للنتيجة.
- Metadata footer خارج Media viewport.
- يمكن عرض `9:16` و`16:9` و`1:1` في المجموعة نفسها بلا overlap.
- Audio Card لا تستخدم Aspect Ratio وهمياً.

---

## 20. Media Cards

### 20.1 المحتوى المشترك

- Preview أو poster أو waveform.
- Media type.
- Generation state.
- Official model identity.
- Variant.
- Dimensions أو duration.
- Lineage summary.
- Selection state.

### 20.2 Quick Actions

- Preview/Play.
- Use as Reference.
- Download.
- More.

داخل `More`:

- Regenerate.
- Create variation.
- View details.
- Move to Trash.

### 20.3 Touch

- أول Tap يحدد البطاقة ويكشف الأفعال.
- لا تعتمد وظيفة أساسية على Hover.
- touch target لا يقل عن `44×44px`.

### 20.4 Delete Policy

- الحذف الافتراضي ينقل إلى Trash.
- إذا كان الأصل مستخدماً في Draft أو Operation، يظهر Impact summary.
- لا يكسر Lineage أو Binding بصمت.
- الاستعادة متاحة خلال سياسة زمنية تحددها المنصة.

### 20.5 Upload، Delivery، وRetention Contract

```text
Selecting → Client validation → Uploading → Server verification → Ready | Failed
```

- الخادم يتحقق من MIME الحقيقي، الحجم، الأبعاد، المدة، checksum، وملكية المشروع؛ امتداد الملف وحده غير كافٍ.
- الرفع والتنزيل يستخدمان signed URLs قصيرة العمر، مع refresh endpoint مصادق عليه؛ لا تحفظ الروابط الموقعة في Domain أو Telemetry.
- Media Pipeline ينشئ thumbnail/poster/proxy/waveform المناسبة قبل اعتبار الأصل جاهزاً للعرض الكامل.
- حدود الملفات تأتي من Input Slot المنشور وتظهر قبل الرفع.
- فشل verification يعزل الملف ولا يجعله Reference صالحاً.
- Trash قابل للاستعادة خلال Retention Policy معلنة؛ الحذف النهائي server-authorized ويعرض Impact على bindings/lineage قبل التنفيذ.
- انتهاء رابط التنزيل لا يعني فقد الأصل؛ يجدد الرابط من Asset ID الثابت.

---

## 21. Generation Lifecycle

الحالة المرئية Projection مبسطة لحالة Engine المثبتة، وليست state مستقلة يملكها المتصفح:

```text
Draft → Quoted → Confirmed → Reserved → Submitted/Running
→ Delivered → Settled
or Failed → Released/Refunded/Reconciliation Required
```

### 21.1 Placeholder States

```text
Preparing
Uploading inputs
Queued
Generating
Finalizing
Saving result
Ready
Needs attention
Failed
```

### 21.2 القواعد

- ينشأ Placeholder في موضع النتيجة فور تأكيد العملية.
- تستبدل النتيجة الـPlaceholder نفسه.
- لا تعرض Percentage ما لم يصل من مصدر موثوق.
- لا تعرض ETA وهمية.
- العمليات المتزامنة تظهر كبطاقات منفصلة.
- Queue Summary تعرض العدد والحالات من دون إخفاء العمليات الفردية.
- Retry المدفوع يحتاج Quote جديداً.
- Draft لا يضيع عند الفشل.
- Generate يستخدم idempotency key ويعطل double-click؛ إعادة نفس الأمر لا تنشئ عملية أو خصماً ثانياً.
- زر Cancel لا يظهر إلا إذا كانت Route والمزود يدعمان إلغاءً مثبتاً، وتوضح الواجهة أن طلب الإلغاء لا يضمن منع كلفة سبق أن ثبتت.
- Refresh يعيد ربط Placeholder بالـOperation ID من الخادم بدلاً من إنشاء بطاقة جديدة.
- حالات `Released/Refunded/Reconciliation Required` تعرض بوضوح من دون ادعاء استرداد قبل إثبات Ledger.

---

## 22. Quote and Generate Bar

### 22.1 المحتوى

- Validation summary.
- Final أو estimated credits.
- Generate button.
- سبب التعطيل عند عدم الجاهزية.

أمثلة:

```text
Generate · 24 Credits
Generate · ~24 Credits
Complete 2 required fields
```

### 22.2 القواعد المالية

- `~` تستخدم فقط عندما تكون التكلفة تقديرية فعلاً.
- لا حجز قبل التأكيد الصريح.
- Quote expiry أو price change يوقف التنفيذ ويطلب Quote جديداً.
- لا يخفي UI أبعاد التسعير المؤثرة مثل duration/resolution/audio.
- التسوية الفعلية تبقى من مسؤولية Engine، لا Browser.
- Output count والجودة والدقة والمدة والصوت تظهر كأبعاد منفصلة عندما تؤثر في السعر.
- الرصيد المحجوز لا يعرض كخصم نهائي، والخصم النهائي لا يستنتج من Quote.
- فشل Provider قبل إثبات الكلفة يحرر الحجز؛ أي كلفة أو نتيجة غير محسومة تعرض `Under review` حتى reconciliation.

### 22.3 Subscription وEntitlement Gating

- المستخدم بلا اشتراك يرى CTA للتفعيل ولا يرى Generate قابلاً للنقر.
- الاشتراك المنتهي، الرصيد غير الكافي، Model غير المشمول، Region mismatch، وProvider غير الجاهز حالات منفصلة برسائل وإجراء تالٍ واضح.
- لا ينشئ UI entitlement محلياً؛ الخادم يعيد التحقق من الاشتراك والرصيد والعرض المنشور عند Quote وعند Confirm.
- تفعيل الاشتراك أو تغير الرصيد ينعكس بلا refresh كامل، مع إبقاء Draft محفوظاً.

---

## 23. Media Viewer

### 23.1 الشكل

- Full-screen overlay.
- خلفية قريبة من `rgba(3,4,6,.72)`.
- `backdrop-blur(18–24px)`.
- يحافظ المحتوى على النسبة الأصلية.
- شريط Actions ثابت داخل safe area.

### 23.2 Controls

**Image:** Zoom، Pan، Reset، Download.  
**Video:** Play/Pause، Scrubber، Volume، Full screen، Download.  
**Audio:** Waveform، Play/Pause، Seek، Duration، Download.

### 23.3 Accessibility

- لا Autoplay افتراضي.
- Escape يغلق.
- Focus trap داخل Viewer.
- يعاد Focus إلى البطاقة الأصلية.
- الخلفية تصبح inert وغير مقروءة لقارئ الشاشة.

---

## 24. Motion System

```text
motion-fast: 120ms
motion-base: 180ms
motion-slow: 240ms
motion-easing: cubic-bezier(.2,.8,.2,1)
```

الاستخدام:

- Hover/Focus: `120ms`.
- Popover/Dropdown: `180ms`.
- Result appearance: `200ms` مع opacity و`translateY(8px)`.
- Viewer: `220ms` مع opacity وscale من `0.98`.
- لا تستخدم spring أو parallax مبالغاً فيه.
- `prefers-reduced-motion` يلغي translate/scale ويحافظ على تبدل opacity سريع.

---

## 25. Responsive and Mobile

### 25.1 Breakpoint Behavior

| السياق | السلوك |
|---|---|
| `≥1280px` | Composer جانبي + Gallery كاملة |
| `1024–1279px` | Composer بعرض `360–392px` + Gallery أكثر كثافة |
| Tablet / coarse pointer | Side sheet أوBottom sheet حسب الاتجاه |
| Mobile | Bottom Composer + single-column results |

### 25.2 Mobile Composer

- Collapsed: `68–72px`.
- Half: `48–55dvh`.
- Full: `90–94dvh`.
- Tabs وGenerate يبقيان ظاهرين.
- Visual Viewport يمنع تغطية Prompt بالكيبورد.
- `Use as…` بديل واضح للسحب.
- يدعم portrait، landscape، safe areas، وfoldable layouts.

---

## 26. Accessibility Baseline

- WCAG 2.2 AA.
- Text contrast `4.5:1`.
- Large text/essential UI contrast `3:1` على الأقل.
- touch targets `44×44px`.
- Focus ظاهر لكل Control وCard action.
- Labels حقيقية و`aria-describedby` للأخطاء.
- لا تعتمد الحالة على اللون وحده.
- Generation state updates عبر live region هادئ.
- Keyboard paths لكل Tabs/Picker/References/Cards/Viewer.
- اختبار screen reader بالعربية والإنجليزية.
- Reduced Motion جزء من Definition of Done.

---

## 27. Operational and Error States

يجب تصميم الحالات التالية قبل التنفيذ:

1. Catalog loading.
2. Catalog unavailable.
3. Model unavailable/deprecated بعد اختياره.
4. Region/account capability mismatch.
5. Invalid method/ratio/duration combination.
6. Missing or incompatible Reference.
7. Upload failure.
8. Server verification failure.
9. Quote expired.
10. Price changed.
11. Insufficient credits.
12. Queue/rate limit.
13. Provider unavailable.
14. Moderation/policy rejection.
15. Generation failure.
16. Delivery or signed URL failure.
17. Offline/save conflict.
18. Deleted or missing Asset.
19. Download permission expired.

الحقل الخاطئ يعرض المشكلة قرب الحقل. الخطأ التشغيلي يظهر داخل Operation Card/Placeholder. لا يعتمد النظام على Toast وحده لخطأ يحتاج إجراءً.

---

## 28. Performance and Privacy Budgets

### 28.1 Performance

- أهداف Web Vitals على Production عند p75: `LCP ≤ 2.5s`، `INP ≤ 200ms`، `CLS ≤ 0.1`.
- Route JS الأولي لـStandard لا يتجاوز `250KB gzip` باستثناء chunks الكسولة للViewer/Editor.
- 100 بطاقة proxy قابلة للتمرير بمتوسط `≥55fps` على جهاز Desktop متوسط و`≥50fps` على Mobile الاختبار المعتمد، بلا Long Task يتجاوز `200ms`.
- ذاكرة 100 بطاقة لا تزيد أكثر من `150MB` فوق baseline للصفحة على جهاز الاختبار؛ لا تحتفظ decoded media خارج viewport بلا حاجة.
- Progressive rendering أو virtualization بعد بلوغ budget محدد.
- Lazy loading للصور والشعارات والـposters.
- منع layout shift عبر معرفة النسبة قبل تحميل الوسيط.
- لا autoplay جماعي.
- Waveforms وposters تستخدم proxies مناسبة.
- تقاس الأرقام على Matrix أجهزة وشبكات موثقة في Gate 14، ولا يستبدل القياس بانطباع بصري.

### 28.2 Privacy

- لا تسجل Telemetry نص Prompt الخام.
- لا تسجل URLs موقعة أو provider payloads في Browser logs.
- Telemetry المسموحة تشمل زمن أول Generate، أخطاء Validation، فتح Picker، واستخدام References بصيغة غير محتوية على المحتوى نفسه.
- كل خطأ تشغيلي يحمل Correlation ID آمن يمكن نسخه للدعم، من دون Prompt أو API key أو signed URL.

---

## 29. Engineering Workstreams

ينفذ البرنامج لاحقاً ضمن Workstreams منفصلة لكنها مترابطة:

| Workstream | المسؤولية |
|---|---|
| Product/UX | IA، flows، wireframes، prototypes، usability |
| Design System | Tokens، components، motion، responsive |
| Catalog/Capabilities | Model manifests، constraints، evidence |
| Frontend Standard | Composer، Gallery، Viewer، interaction state |
| Media Pipeline | Upload، proxies، posters، waveforms، delivery |
| Engine/Finance | Quote، reserve، dispatch، settlement |
| Accessibility | Keyboard، screen reader، contrast، reduced motion |
| QA/Certification | E2E، visual regression، performance، failure states |
| Localization | Separate en/ar catalogs، BiDi، terminology، visual coverage |
| Reliability/Observability | Correlation، metrics، alerts، refresh recovery، conflict handling |
| Release Engineering | Feature flags، migration sampling، rollout، rollback drill |

---

## 30. التنفيذ المرحلي الصحيح

### Phase 0 — Scope and Terminology Freeze

**الأعمال:**

- اعتماد اسم `Standard / Space`.
- اعتماد Locale مستقلين `en/ar` ومنع النص المختلط.
- اعتماد Image-first كأول Vertical Slice.
- تثبيت حدود Standard وخارج النطاق.
- اعتماد أن Domain Graph واحد.
- اعتماد أن النماذج تأتي فقط من Published Offers، وأن قائمة البحث ليست Catalog ثابتاً.

**المخرجات:** Product decision record وterminology map.  
**Gate 0:** لا خلاف على التسمية أو اللغة أو Image-first أو الفصل بين Gallery وGraph.

### Phase 1 — Domain Projection، Migration، وConcurrency

**الأعمال:**

- تعريف `standardProjection` وملكية كل حقل.
- تثبيت أن `assets/operations/bindings` هي Domain truth.
- Mapping للقيمة الداخلية `PROFESSIONAL` إلى الاسم الظاهر `Space`.
- forward reader للمشاريع `schemaVersion: 1` وخطة `v2` إن لزم.
- optimistic project version، multi-tab conflict، Offline draft، وAutosave states.
- خطة Strangler لإزالة Standard Canvas بلا تحويل بيانات.

**المخرجات:** Versioned project/projection contract وmigration/compatibility fixtures.  
**Gate 1:** مشروع قديم يفتح في Standard وSpace ويُحفظ ويعاد فتحه بلا فقد أو React Flow JSON كحقيقة.

### Phase 2 — PublishedOffer Capability Contract v2

**الأعمال:**

- تطوير العقد الحالي، لا إنشاء Manifest موازٍ.
- Mapping كامل من Capability v1 إلى v2.
- Mapping بين Family وOfficial ID وProvider Route وPublished Offer.
- تعريف conditional controls والقيود.
- تعريف Compatibility Diff.
- تعريف evidence/version/hash policy.
- Contract tests وFail Closed للنسخ غير المفهومة.

**المخرجات:** Versioned capability contract وserver/client fixtures معتمدة.  
**Gate 2:** لا Control في التصميم يحتاج hard-coded model exception خارج Manifest/Adapter.

### Phase 3 — UX Architecture، Prototype، وOfficial Assets ✅ (Local prototype complete; visual approval pending)

**الأعمال:**

- رسم Image end-to-end flow أولاً، ثم Video وAudio.
- Low-fidelity wireframes للDesktop/Mobile ولحالتي `en/ar`.
- High-fidelity prototype مبني على Capability v2 fixtures فقط.
- اختبار Progressive Disclosure واتجاه Composer.
- جرد الشعارات المطلوبة.
- اعتماد المصدر والترخيص.
- إعداد light/dark variants والفallback.
- منع monograms وCDN hotlinks غير المعتمدة.

**المخرجات:** Approved prototype وLogo asset manifest.  
**Gate 3:** مستخدم جديد ينفذ Mock Image Generate بلا شرح، وكل Control وشعار له عقد ومصدر.

### Phase 4 — Standard Shell and Design System ✅ (Local shell complete; device review pending)

**الأعمال:**

- Top bar.
- Composer shell.
- Tabs.
- Tokens وmotion primitives.
- typed i18n catalogs وBiDi/Typography foundations.
- Responsive containers وmobile sheets.
- Loading/Empty/Error/Skeleton primitives.

**المخرجات:** Non-billable responsive shell.  
**Gate 4:** Layout ثابت على Desktop/Tablet/Mobile؛ لا مزج لغوي؛ keyboard وReduced Motion يعملان.

### Phase 5 — Image Vertical Slice End-to-End

**الأعمال:**

- Model Picker وschema-rendered Image controls.
- Create أولاً ثم Edit/Remix حسب Certified Routes.
- Draft persistence وbasic References.
- Validation → Quote → Confirm → Reserve → Dispatch.
- idempotent Generate وdouble-click protection.
- Placeholder → Result → Settlement projection.
- Image Card، Viewer، Download، وUse as Reference.
- refresh recovery وSubscription/Credit gating.

**المخرجات:** أول Customer journey إنتاجي كامل من Prompt إلى أصل قابل لإعادة الاستخدام.  
**Gate 5:** لا خيار وهمي، لا خصم مزدوج، الفشل يحرر/يسوي وفق Ledger، والنتيجة تنجو من refresh.

### Phase 6 — Image Reliability and Advanced Image

**الأعمال:**

- Multi-reference، variation، inpaint/outpaint بعد اعتماد Mask، وupscale كRoute مستقل.
- Compatibility Diff وتغيير النموذج بلا فقد صامت.
- Output count، quality، dimensions، وكل Pricing dimensions.
- Provider failure، quote expiry، price change، insufficient credits، reconciliation، وdownload expiry.
- Gallery sessions، lineage، Trash/restore، وproject conflict coverage.

**المخرجات:** Image Standard مكتمل وموثوق قبل توسيع الوسائط.  
**Gate 6:** Image E2E/failure/billing/a11y tests ناجحة ولا حالة مالية مبهمة تُعرض كنجاح أو Refund.

### Phase 7 — Video Vertical Slice End-to-End

**الأعمال:**

- T2V أولاً، ثم I2V/First-Last/Reference/Continuation حسب Routes المنشورة.
- duration/resolution/aspect/audio pricing dimensions.
- Video upload verification، poster/proxy، Placeholder، Viewer، Download، وReuse.
- refresh recovery، idempotency، provider polling/webhook، settlement، وfailure states.

**المخرجات:** Video journey إنتاجي كامل يستخدم المحرك نفسه بلا مسار مالي موازٍ.  
**Gate 7:** كل Combination غير صالح يمنع قبل Quote، والتكلفة/المدة/الصوت تسوى بدقة مثبتة.

### Phase 8 — Audio Vertical Slice End-to-End

**الأعمال:**

- TTS variants المنشورة فقط.
- Single/Two speakers.
- Voice Browser.
- Script blocks.
- Style/Emotion/Accent/Pace directives.
- Preview policy وAudio tags وتسعيرها.
- Audio upload/output، waveform/proxy، Player، Download، وReuse.
- Quote/Reserve/Dispatch/Settlement/Failure وrefresh recovery.

**المخرجات:** Audio journey إنتاجي كامل.  
**Gate 8:** لا قدرة Audio مبالغ بها، ولا Preview أو Retry يستهلك Credits بلا سياسة واضحة.

### Phase 9 — Multimodal References and Mentions

**الأعمال:**

- Reference Tray.
- Drag/Use as/Add from Library.
- Role change/remove.
- `@mentions` وprovider adapter syntax.
- Compatibility Diff.
- stable aliases محفوظة وImpact summary للحذف.

**المخرجات:** Multimodal binding UX موحد.  
**Gate 9:** aliases ثابتة، mobile path بلا drag، ولا Reference مكسور بصمت.

### Phase 10 — Results Workspace، Library، وTrash

**الأعمال:**

- Adaptive Gallery.
- Image/Video/Audio Cards.
- Real aspect ratio.
- Lineage summary.
- Quick actions وTrash.
- Generation sessions وQueue summary.
- bulk selection/download ضمن حدود الصلاحية.
- signed URL renewal وRetention/restore flows.

**المخرجات:** Results Workspace كاملة.  
**Gate 10:** `9:16` و`16:9` و`1:1` وAudio تظهر معاً بلا crop/overlap وبترتيب DOM صحيح.

### Phase 11 — Responsive، Localization، وAccessibility Completion

**الأعمال:**

- Desktop/Tablet/Mobile/foldable/landscape.
- English/Arabic catalogs بلا نص مفقود أو مختلط.
- Keyboard، screen reader، focus management، contrast، touch targets، وReduced Motion.
- Visual Viewport، safe areas، وبدائل drag.
- Viewer focus trap/return لكل Media kind.

**المخرجات:** Adaptive bilingual WCAG 2.2 AA candidate.  
**Gate 11:** لا انتهاك A11y حرج/عالٍ، والـcore flows تعمل على `390×844` بلا تغطية الكيبورد.

### Phase 12 — Performance، Observability، Security، وPrivacy

**الأعمال:**

- 100-card budgets وvirtualization/proxies/lazy chunks.
- Web Vitals وmemory/scroll measurements على Matrix موثقة.
- Correlation IDs وsafe telemetry بلا Prompt أو signed URL أو provider payload.
- MIME/content verification، upload/download authorization، Retention، وabuse boundaries.
- capability drift، stale offer، region/account mismatch، وsecurity/privacy tests.

**المخرجات:** Measured production candidate مع operational evidence.  
**Gate 12:** جميع budgets ناجحة، ولا تسريب محتوى أو سر أو URL موقعة في Logs/Telemetry.

### Phase 13 — Feature Flags، Migration Rollout، وRollback

**الأعمال:**

- Feature Flags مستقلة لـStandard Gallery وImage/Video/Audio وSpace rename.
- Rollout: Internal → Super Admin → Test users → Limited Production → GA.
- project compatibility sampling وshadow-read للProjection القديمة والجديدة.
- Forward-fix وRollback لا يعيدان Standard غير الآمن ولا يغيران Domain data.
- مراقبة error/billing/performance thresholds مع automatic hold criteria.

**المخرجات:** Controlled release package وrunbook.  
**Gate 13:** يمكن تعطيل Projection الجديدة فوراً مع بقاء المشاريع والعمليات والأرصدة صحيحة وقابلة للقراءة.

### Phase 14 — Certification and Release Gate

**الأعمال:**

- Visual regression لكل ratios والحالات.
- E2E للفيديو والصور والصوت.
- migration/backward-compatibility وmulti-tab/offline tests.
- 100-card/Web Vitals/memory budgets.
- Quote/billing golden tests.
- English/Arabic isolation وBiDi mixed-content tests داخل حقول المحتوى فقط.
- Provider capability drift tests.
- Security/privacy review.
- signed rollback drill وproduction smoke test.

**المخرجات:** Signed Standard Mode release candidate.  
**Gate 14:** جميع معايير القبول أدناه ناجحة، ولا استثناء غير موثق، وProduct/Engineering/Finance/Security/Accessibility يوقعون قرار GA.

---

## 31. معايير القبول النهائية

1. يظهر `Standard / Space` فقط للمستخدم.
2. Standard لا يعرض Nodes أو Edges أو Handles.
3. المشروع نفسه يفتح في Space بلا نسخ أو تحويل Domain data، والمشاريع `schemaVersion: 1` تبقى مقروءة.
4. Tabs الثلاثة تحفظ Drafts مستقلة على الخادم وتنجو من refresh وتبديل الجهاز.
5. Model Picker يعرض أسماء وشعارات رسمية موثقة فقط.
6. لا يظهر Method/Ratio/Duration/Resolution غير مدعوم.
7. تغيير النموذج لا يحذف Reference أو Setting دون Compatibility Diff.
8. Prompt العربي/الإنجليزي والـMentions لا يتشوه.
9. `@` يعرض References المتوافقة فقط.
10. كل Card تحافظ على Aspect Ratio الفعلي.
11. Audio Card تستخدم Waveform ولا تفرض Aspect Ratio وهمياً.
12. Placeholder يستبدل في موضعه من دون layout jump ملحوظ.
13. لا تعرض Percentage أو ETA بلا دليل موثوق.
14. Card actions تعمل بالماوس والكيبورد واللمس.
15. Viewer يدعم Escape وFocus trap وFocus return.
16. Generate يعرض Final أو Estimated Credits بوضوح.
17. Quote المتغير أو المنتهي لا ينفذ بصمت.
18. Retry المدفوع يطلب Quote جديداً.
19. لا تغطي لوحة المفاتيح Prompt أو Generate على الهاتف.
20. Reduced Motion يلغي الحركات المكانية.
21. 100 بطاقة تبقى قابلة للتمرير والتفاعل ضمن budget معتمد.
22. Offline/Catalog unavailable/Generation failed حالات مصممة ومختبرة.
23. حذف أصل مستخدم يعرض Impact قبل التنفيذ.
24. Standard لا يكشف Provider URL أو technical payload.
25. اللهجة العراقية مصنفة Fusion/Experimental وليست Official capability.
26. لا يوجد شعار مصنوع أو hotlinked بلا اعتماد.
27. جميع التدفقات الأساسية تجتاز WCAG 2.2 AA المستهدف.
28. واجهتا `en/ar` منفصلتان ولا يظهر نص مترجم جزئياً أو ممزوجاً.
29. Image journey يعمل كاملاً قبل اعتماد Video أو Audio للإطلاق.
30. Capability v2 يطور PublishedOffer الحالي، والنسخة غير المفهومة تفشل مغلقة.
31. Generate مزدوج بنفس idempotency key ينتج عملية وحجزاً واحداً فقط.
32. الرصيد المحجوز والخصم النهائي والاسترداد والمراجعة تظهر كحالات مختلفة مثبتة من Engine.
33. المستخدم بلا اشتراك أو برصيد غير كافٍ يحصل على إجراء واضح من دون فقد Draft.
34. Refresh يعيد ربط Placeholder بالعملية نفسها ولا ينشئ نتيجة أو خصماً جديداً.
35. تعارض Tab/Device لا يستخدم last-write-wins بصمت، وOffline لا يسمح بعملية مالية.
36. Upload يتحقق منه الخادم، والروابط الموقعة لا تخزن كحقيقة مشروع أو Telemetry.
37. Trash/restore/retention لا تكسر Binding أو Lineage بلا Impact summary.
38. Web Vitals و100-card وmemory budgets تنجح على Matrix الاختبار الموثقة.
39. Correlation ID متاح للدعم بلا Prompt أو Secret أو Provider payload.
40. Feature Flag وRollback drill يثبتان إمكان تعطيل Standard الجديدة بلا ضرر للمشاريع أو الأرصدة.

---

## 32. Risk Register

| الخطر | الأثر | المعالجة |
|---|---|---|
| Capability drift | خيارات خاطئة أو عمليات فاشلة | Versioned manifests + evidence timestamps + drift tests |
| كثرة النماذج | تشويش المستخدم | Curated catalog + search + recommended choice |
| Hard-coded controls | تعارض مع Routes | Schema-driven UI فقط |
| شعارات غير رسمية | ضرر ثقة/علامة تجارية | Official asset registry |
| BiDi bugs | Prompt مشوه | Dedicated mixed-language tests |
| Gallery performance | بطء بعد كثرة النتائج | Proxies + lazy loading + virtualization |
| Hidden input loss | فقد Reference عند تغيير Model | Compatibility Diff |
| Quote mismatch | ضرر مالي وثقة | Expiry/version checks + Engine authority |
| Audio capability overclaim | نتائج غير مضمونة | Native/directive/tag classification |
| Mobile drag dependency | تدفق غير قابل للاستخدام | Explicit `Use as…` actions |
| Standard/Space divergence | نظامان متعارضان | One domain graph + two projections |
| Parallel capability contracts | UI/Engine drift | Upgrade existing PublishedOffer contract to v2 only |
| Legacy Canvas removal | كسر مشاريع محفوظة | Strangler flag + v1 fixtures + backward reader |
| Multi-tab overwrite | فقد Draft أو Binding | Optimistic version + explicit conflict UX |
| Partial localization | واجهة مربكة | Typed independent en/ar catalogs + missing-key CI |
| Unsafe rollout | ضرر واسع | Cohort rollout + automatic hold + tested rollback |

---

## 33. Definition of Ready للتنفيذ

لا تبدأ أي مرحلة Implementation قبل توفر:

- Approved wireframe وhigh-fidelity prototype.
- Approved PublishedOffer Capability Contract v2 وv1 mapping.
- Approved Standard Projection/data ownership وproject compatibility fixtures.
- Curated model/route list مع evidence.
- Logo asset approvals.
- Acceptance criteria للمرحلة.
- Error-state designs.
- Accessibility annotations.
- Billing/financial impact note.
- Concurrency/offline/save-conflict strategy.
- Feature flag، cohort rollout، monitoring thresholds، وrollback/forward-fix strategy.

---

## 34. Definition of Done للبرنامج

يعد `UI Standard Mode` مكتملاً فقط عندما:

- تعمل Video/Image/Audio flows من Draft حتى نتيجة قابلة لإعادة الاستخدام.
- يكون كل Control مستمداً من Manifest معتمد.
- تكون Quotes والحجوزات والتنفيذ خاضعة للمحرك.
- تعمل References وMentions وLineage بلا فقد بيانات.
- تحافظ البطاقات والمعاينة على الوسائط الحقيقية.
- تنجح اختبارات Desktop/Mobile/RTL/LTR/A11y/Performance.
- يمكن فتح المشروع نفسه في Projection أخرى من دون تحويل Domain data.
- لا توجد قدرة أو تكلفة أو Progress أو شعار وهمي.
- تبقى المشاريع القديمة قابلة للقراءة والحفظ، ولا يحدث overwrite صامت بين Tabs/Devices.
- تكون en/ar مكتملتين ومنفصلتين، وتنجح missing-translation وBiDi tests.
- ينجح rollout والrollback drill ولا تتأثر الأرصدة أو العمليات الجارية عند تعطيل الواجهة الجديدة.

---

## 35. الخطوة التالية بعد اعتماد هذا البلان

بعد اعتماد `FL-UI-FUX-001` تبدأ وثيقة منفصلة باسم:

```text
UI Space Mode Plan
```

وتغطي فقط Node/Port/Edge UX، groups، subflows، templates، batch branches، advanced shots، graph performance، والانتقال الآمن بين Standard وSpace. لا تدخل تلك الأعمال في تنفيذ Standard قبل اجتياز بواباته.
