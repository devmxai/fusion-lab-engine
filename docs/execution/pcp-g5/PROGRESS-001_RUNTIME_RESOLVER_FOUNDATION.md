# PCP-G5 — Provider Runtime Resolver Foundation

**الحالة:** `IN PROGRESS — LOCAL FOUNDATION PASS`

## ما تم بناؤه

- `ReleasedProviderRuntimeRoute` يثبت provider/account/route/model/adapter/credential/cost/price/release bundle في عملية التنفيذ.
- `VersionedProviderAdapterFactoryRegistry` يرفض adapter غير مسجل أو version لا تطابق النسخة المعتمدة.
- `ProviderRuntimeResolver` لا يسمح إلا بـRoute lifecycle `PUBLISHED`، ولا يخزن adapter أو secret بين العمليات.
- `ProviderCredentialLeaseBroker` عقد read-once داخل callback فقط.
- `SecretBackedCredentialVault.useActiveProviderGenerationCredential` يفحص identity كاملة: provider + account + purpose + active status + exact credential version قبل تسليم bytes للـruntime.
- Factories موصولة فعلياً إلى adapters الموجودة من دون request تلقائي:
  - `kie-market-job@kie-market.v1`
  - `openrouter-video@openrouter-video.v1`
  - `openrouter-chat@openrouter-chat.v1`
  - `openrouter-image@openrouter-image.v1`
  - `openrouter-tts@openrouter-tts.v1`
  - `openrouter-stt@openrouter-stt.v1`

## ما ثبت

- لا خلط بين حسابين لنفس المزود.
- لا Route غير منشورة ولا adapter version غير معتمد.
- لا يخرج API key إلى projection أو Admin API؛ يكون داخل lease callback فقط.
- KIE Market وOpenRouter video/chat/image/tts/stt تُنشأ من factory versioned وتُختبر مع transport mock فقط.
- اختبارات local تغطي resolver والـvault lease.

## المتبقي لإغلاق G5

1. KIE protocol families غير Market (Veo/Runway/Suno وغيرها) تحتاج adapters منفصلة مبنية من captures docs رسمية، لا يعاد استخدام Market adapter لها.
2. ربط Resolver فقط بـRoute Candidate صادر من G7 Release Bundle، لا بالـregistry المحلي القديم.
3. Provider task/status/webhook/usage/asset evidence لكل Adapter وربطها بالـdurable worker.
4. لا live submission أو canary حتى G10 وبعد توفير credentials والتفويض الصريح.
