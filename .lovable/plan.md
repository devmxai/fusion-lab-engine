# خطة إعادة تصميم الواجهة الرئيسية

## الهدف
استبدال الواجهة الرئيسية الحالية (التي تعرض بطاقات الأدوات حسب الفئة) بواجهة Studio موحّدة على غرار Higgs Field، مع تبويبات علوية تقسّم النماذج حسب نوع المدخل/المخرج، وإزالة اللون البنفسجي بالكامل لصالح ثيم داكن مع عناصر بيضاء.

## التخطيط البصري

```text
┌─────────────────────────────────────────────────────────┐
│  Logo                        Tabs                   User│  ← Header
├──────────────────┬──────────────────────────────────────┤
│                  │                                      │
│   لوحة الإدخال    │         منطقة المعاينة/الإخراج        │
│   (Studio Panel) │         (Placeholder / Result)       │
│   ~40% عرض       │         ~60% عرض                     │
│                  │                                      │
│   - رفع ملفات     │         - معاينة النتيجة             │
│   - اختيار النموذج│         - شبكة الصور/الفيديو          │
│   - إعدادات       │                                      │
│   - زر التوليد    │                                      │
│                  │                                      │
└──────────────────┴──────────────────────────────────────┘
```

## التبويبات (Tabs) وتوزيع النماذج

- **Text → Image**: z-image, nano-banana-2, nano-banana-pro, seedream 4.5/5-lite, flux-2 pro, grok-imagine, gpt-image-2
- **Text → Video**: grok-imagine video, veo3 family, kling 3.0/2.6, seedance 2, sora-2, wan 2.6, bytedance v1-pro
- **Image → Video**: grok-imagine i2v, veo3 (first-last), kling 3.0 (first-last), seedance 1.5 pro/2 (frames)
- **Audio → Video** (Avatar): kling/ai-avatar-standard, kling/ai-avatar-pro, infinitalk/from-audio
- **Video → Video** (Transfer/Animate): wan/2-2-animate-move, wan/2-2-animate-replace, kling 3.0 motion-control, kling 2.6 motion-control
- **Edit / Remix**: nano-banana-edit, flux-kontext pro/max, qwen image-edit, gpt-image-1.5 edit, seedream 4.5 edit
- **Utilities**: remove-bg, upscale (Recraft/Topaz)

## التغييرات على المسارات

- `/` بعد تسجيل الدخول → يحوّل مباشرة إلى `/studio` (الـStudio الموحّد)
- إزالة الصفحة الرئيسية القديمة (Index) من مسار افتراضي مسجَّل الدخول مع إبقاء Landing للزائر
- `/studio?tab=text-to-video&model=...` يحدد التبويب والنموذج عبر query params
- المسارات القديمة (`/studio/video`, `/studio/avatar`, …) تُعاد توجيهها إلى `/studio?tab=...`

## تغييرات الثيم

- في `src/index.css` و`tailwind.config.ts`:
  - `--primary` يتحول من بنفسجي إلى أبيض (`0 0% 100%`) مع `--primary-foreground` أسود
  - `--accent` يصبح رمادي محايد
  - حذف/تبسيط `--gradient-primary` ليصبح رمادي داكن→أسود بدل البنفسجي
  - حذف توهجات `hsl(var(--primary)/...)` البنفسجية أو إبدالها برمادية
  - الخلفية تبقى داكنة (≈`220 13% 6%`)
- مكوّن `CreditRingAvatar`: تغيير حلقة الكريدت من بنفسجي إلى أبيض
- جميع أزرار CTA: خلفية بيضاء، نص أسود، حالة hover رمادي فاتح
- بطاقات النماذج المختارة: حدّ أبيض رفيع بدل توهج بنفسجي

## مكوّنات جديدة

1. `src/pages/UnifiedStudioPage.tsx` — الصفحة الموحّدة الجديدة
   - Header علوي يحتوي Tabs (Radix Tabs)
   - Layout مقسّم: لوحة يسار (input panel) + منطقة يمين (preview)
   - state لـ activeTab + selectedModel، مزامنة مع query params
2. `src/components/studio/StudioTabsBar.tsx` — شريط التبويبات العلوي
3. `src/components/studio/ModelGrid.tsx` — قائمة/شبكة اختيار النموذج داخل التبويب الواحد
4. `src/components/studio/UnifiedInputPanel.tsx` — يستضيف نموذج الإدخال المناسب لكل تبويب (يعيد استخدام منطق `StudioPage` الحالي حسب النموذج المختار)
5. `src/data/studio-tabs.ts` — تعريف التبويبات وتوزيع النماذج عليها

## الحفاظ على المنطق الحالي

- لا تغيير في:
  - Edge Functions (`start-generation`, `kie-ai`, …)
  - قاعدة البيانات أو الكريدت أو الاشتراكات
  - منطق التسعير `pricing-engine.ts` و`model-capabilities.ts`
  - منطق الـqueue (`use-generation-queue`) والـsidebar
- إعادة استخدام كل دوال الإرسال (`handleGenerate`, الرفع للـStorage, polling) من `StudioPage` الحالية عبر hooks مشتركة، مع نقل الأجزاء القابلة لإعادة الاستخدام إلى hook منفصل `useStudioGeneration` إن لزم.

## ما لن يتغيّر في هذه الجولة

- صفحات: Library, Profile, Pricing, Admin, Auth — تبقى كما هي وظيفيًا (مع تبديل الألوان البنفسجية فقط).
- BottomNav: يبقى ولكن يتم تبسيطه ليؤشّر إلى Studio / Library / Profile فقط.

## خطوات التنفيذ

1. تحديث ثيم `index.css` + `tailwind.config.ts` (إزالة البنفسجي).
2. إنشاء `src/data/studio-tabs.ts` بتوزيع النماذج.
3. إنشاء `UnifiedStudioPage` + المكوّنات الفرعية بتصميم Higgs-Field-like (شريط tabs علوي، لوحة يسار، placeholder يمين).
4. تحديث `App.tsx`:
   - `/` للمستخدم المسجّل → `Navigate to /studio`
   - `/studio` → `UnifiedStudioPage`
   - إعادة توجيه `/studio/video`, `/studio/avatar`, … إلى `/studio?tab=...`
5. تبسيط `HomeHeader` / `BottomNav` (إخفاء روابط الفئات القديمة).
6. اختبار توليد سريع لكل تبويب للتأكد من عدم كسر منطق `start-generation`.

## أسئلة قبل التنفيذ

سأطلب توضيحًا واحدًا فقط قبل البدء — لأن القرار يغير حجم العمل بشكل كبير.
