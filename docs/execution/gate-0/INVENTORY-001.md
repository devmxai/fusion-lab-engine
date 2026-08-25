# INVENTORY-001 — Platform Inventory

| الحقل | القيمة |
|---|---|
| Status | `IN PROGRESS` |
| Owner | Engineering/Operations — named owner required |
| Evidence date | 2026-08-11 Asia/Baghdad |
| Source revision | `193c4f63e3eea1dfec12074772c5889738722c96` plus approved local plan v1.1.0 change |

لا يحتوي هذا الملف أسرارًا. كل credential ظهر في محادثة أو سجل غير مخصص للأسرار يعامل compromised ويُدوّر، ولا يُنسخ هنا.

## Repository/runtime

| العنصر | الحالة المثبتة |
|---|---|
| Repository | `devmxai/fusionlab-next`, branch `main` |
| Required Node | `.nvmrc = 22` |
| System nvm/node/npm | غير متاح في PATH الحالي |
| Verification runtime | bundled Node 22 executable |
| Package manager truth | `package-lock.json`; توجد أيضًا Bun lockfiles وتحتاج قرار ADR/cleanup |
| CI workflows | لا يوجد `.github` حاليًا |
| Tracked env files | `.env.example` فقط؛ `.env.local` ignored |
| Source footprint | 169 files تحت `src` وقت الجرد |
| Tests | اختبار placeholder واحد فقط |
| Production build | ينجح؛ main JS نحو 1.1 MB minified ويصدر chunk warning |
| Lint | يفشل: 112 errors و25 warnings baseline |

## Application

- React 18 + Vite + TypeScript + Tailwind/shadcn.
- `StudioPage.tsx`: 2487 سطرًا، ويجمع UI/provider/billing/polling.
- `AudioStudioPage.tsx`: 1289 سطرًا.
- `AdminPage.tsx`: 942 سطرًا تقريبًا مع direct sensitive data flows.
- Supabase client types: 1252 سطرًا.

## Supabase

| العنصر | الحالة المثبتة |
|---|---|
| Project ref | `soweiomymeqfjpakohzc` |
| Observed project status | `ACTIVE_HEALTHY` في فحص read-only السابق |
| Region | `ap-northeast-1` |
| Migrations | 52 historical migrations؛ لا يعاد تعديلها |
| Edge Functions | 6: complete-generation, gemini-tts, kie-ai, start-generation, system-jobs, whatsapp-otp |
| Function JWT config | خمس وظائف حساسة مسجلة `verify_jwt = false` وتحتاج route-specific review |
| Storage | historical migrations تجعل `generations` و`temp-uploads` عامة |
| Job ownership | historical RLS يسمح للمستخدم INSERT/UPDATE على `generation_jobs` |
| Cron/financial automation | expiry وstale reservation cleanup موجودان تاريخيًا |
| Management token capability | direct project read نجح؛ listing/functions/secrets أعاد 403 في الفحص السابق |

## Vercel/public domains

| المشروع | الدومينات المرصودة | الحالة السابقة |
|---|---|---|
| `fusionlab-main` | `fusionlab.pro`, `www.fusionlab.pro`, `fusionlab-main.vercel.app` | HTTP 200 |
| `refusion-editor` | `editor.fusionlab.pro` | HTTP 200 |
| `fusion-ai` | `ai.fusionlab.pro` | HTTP 200 |

- Production runtime المرصود في Vercel كان Node 24.x، بينما المستودع يثبت Node 22؛ هذا drift يحتاج إغلاقًا قبل Gate 2.
- نسخة العمل المحلية غير مرتبطة بـ`.vercel`، وهو صحيح أمنيًا حتى تثبيت environment strategy.
- أسماء متغيرات Production مرصودة، لكن القيم لا تُنسخ أو تُقرأ في هذا الجرد.

## Unknown inventory — Gate 0 blockers

- VPS host، OS، network، TLS، firewall، backups، patching وowner.
- KIE/OpenRouter account ownership، spend caps، balances، webhook endpoints وretention terms.
- Supabase PITR/backup entitlement ونتيجة restore drill فعلية.
- Vercel/Supabase/GitHub named owners وbreak-glass accounts.
- active cron schedules في Production، لا الملفات المحلية فقط.
- production bucket policies/grants الفعلية مقارنة بآخر migration.

## Secret hygiene evidence

- لا توجد signatures مباشرة لـGitHub/Supabase/Vercel/provider tokens في tracked source عند الفحص الاسمي.
- ظهور `sk-` الوحيد في lockfile جزء من package integrity text وليس دليل credential؛ يحتاج secret scanner رسمي في CI بدل الاعتماد على grep.
- جميع tokens التي شاركت خارج Secret Manager تبقى `ROTATION REQUIRED` حتى يوجد دليل إبطال وإصدار بديل.
