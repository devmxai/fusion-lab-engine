# Engine Provider Architecture — Local Test Implementation

هذا التنفيذ يختبر المحرك عبر Provider API حقيقي محلياً، وليس عبر تغيير أرقام داخل الواجهة أو استدعاء دالة مباشرة داخل المحرك.

## المسار الفعلي

```text
Browser / Studio
  → Engine API :8787
  → Provider Registry
  → Canonical ProviderAdapter
  → HTTP + Bearer API Key
  → Provider For Test API :8790
  → taskId + status responses
  → polling
  → authenticated result download
  → type/signature/size validation
  → SHA-256 + Engine asset storage
  → delivery
  → customer settlement + provider reconciliation
```

الواجهة لا تعرف عنوان المزوّد ولا مفتاحه. المفتاح موجود server-side فقط، والـEngine لا يعرف شكل HTTP الخاص بالمزوّد؛ يتعامل حصراً مع `ProviderAdapter` وCanonical contracts.

## التشغيل

```sh
npm run dev
```

يشغّل الأمر مسار التطوير الواحد:

- Web: `http://127.0.0.1:8080`
- Engine API: `http://127.0.0.1:8787`
- Provider For Test API: `http://127.0.0.1:8790`
- Engine عبر Web proxy: `http://127.0.0.1:8080/api/engine`

الخدمات الثلاث loopback/local فقط. `Provider For Test` والـEngine يرفضان Production، ولا ينفذان Migration أو Deploy.

## مكان إعداد API

في `.env.local` فقط:

```text
TEST_PROVIDER_BASE_URL=http://127.0.0.1:8790
TEST_PROVIDER_API_KEY=<local-test-key>
```

يقرأ المفتاح Engine Adapter فقط ويرسله كـ`Authorization: Bearer ...`. لا يستخدم `VITE_` ولا يصل إلى Browser response أو logs. القيمة الافتراضية في مسار التطوير مفتاح وهمي محلي وليست credential لمزوّد حقيقي.

## Canonical Provider Contract

العقود المشتركة في `packages/contracts/src/provider.ts` وتغطي:

- media/model/input parameters.
- idempotent submit.
- provider task states.
- actual provider credits.
- result URL.
- provider balance.

الواجهة الموحدة في `packages/providers/src/types.ts`:

```text
listModels
getBalance
submit
lookupByIdempotency
getTask
fetchAsset
```

`ProviderRegistry` يحمل الـAdapters. التنفيذ الحالي `TestProviderHttpAdapter`، وأي KIE/OpenRouter Adapter مستقبلي ينفذ العقد نفسه من دون تغيير Billing أوOperation state machine أوالواجهة.

## Creative Space Video API (Engine local only)

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/v1/dev/space/video-quotes` | Strict recipe validation and immutable final quote |
| `POST` | `/v1/dev/space/video-quotes/:quoteId/confirm` | Idempotent Site Credit reservation |
| `POST` | `/v1/dev/space/video-operations/:operationId/run` | Provider dispatch, poll, MP4 ingest, delivery and settlement |
| `GET` | `/v1/dev/space/video-operations/:operationId` | Local refresh recovery |

These endpoints are loopback development contracts. They do not authorize a Production route or a deployment.

## Creative Space Advanced Multimodal API (Engine local only)

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/v1/dev/space/advanced-quotes` | Strict TTS/Avatar/Motion/Edit/Extend validation and immutable quote |
| `POST` | `/v1/dev/space/advanced-quotes/:quoteId/confirm` | Idempotent Site Credit reservation |
| `POST` | `/v1/dev/space/advanced-operations/:operationId/run` | Provider dispatch, WAV/MP4 ingest, delivery and settlement |
| `GET` | `/v1/dev/space/advanced-operations/:operationId` | Local refresh recovery |

The endpoint selects `local/test-audio-v1` for TTS and `local/test-video-v1` for the four multimodal video recipes. Both remain routes of the single Provider For Test API.

## Provider For Test API

| Method | Route | الغرض |
|---|---|---|
| `GET` | `/healthz` | Health بلا credential |
| `GET` | `/v1/models` | Models/capabilities |
| `GET` | `/v1/credits` | رصيد المزود الحقيقي في المحاكاة |
| `POST` | `/v1/generations` | إنشاء task مع `Idempotency-Key` |
| `GET` | `/v1/generations/by-idempotency/:key` | حل submission unknown بلا إعادة إرسال |
| `GET` | `/v1/generations/:taskId` | Polling task status/actual cost |
| `GET` | `/v1/assets/:taskId` | تنزيل نتيجة المزود عبر Adapter |
| `POST` | `/v1/dev/reset` | Reset محلي فقط |

كل `/v1/*` يتطلب Bearer API Key. الخدمة لها process وport وwallet وtask store مستقل عن الـEngine.

## Models التجريبية

| Model | Media | Result |
|---|---|---|
| `local/test-image-v1` | Image | SVG أبيض مكتوب عليه `TEST` |
| `local/test-video-v1` | Video contract | Minimal `video/mp4` test asset instead of a paid generation |
| `local/test-audio-v1` | Audio | WAV صامت قصير |

## السياسة المالية الافتراضية

- رصيد المستخدم الابتدائي: `1000 Site Credits`.
- رصيد Provider For Test الابتدائي: `1000 Provider Credits`.
- المقارنة المحلية: `1 Provider Credit = 1 Site Credit` من حيث القيمة الاقتصادية.
- `ENGINE_LOCAL_PROVIDER_MARKUP_BPS=10000` يعني `100% markup`.
- تكلفة مزود `2` → سعر مستخدم `4` → Gross Profit `2` → Gross Margin `50%`.

الـMarkup قابل للضبط مركزياً من إعداد Engine، ولا يغير تكلفة المزوّد. الـQuote يعرض pricing policy، والعملية تعرض quoted/realized profit وmargin وprovider actual cost.

## دورة العملية

```text
Quote
→ customer hold
→ Adapter HTTP submit
→ SUBMITTED / SUBMISSION_UNKNOWN
→ provider polling
→ PROVIDER_SUCCEEDED / PROVIDER_FAILED
→ authenticated asset download
→ ASSET_STORED
→ DELIVERED
→ SETTLED
```

- عند Provider failure: المزود يعيد hold والمحرك يعيد customer hold.
- عند submission unknown: لا يعاد dispatch؛ يستخدم lookup بالـIdempotency-Key.
- عند asset delivery failure بعد خصم المزود: يعاد رصيد المستخدم وتسجل Provider Loss.
- عند cost shock: لا يدفع المستخدم أكثر من الـQuote، ويظهر انخفاض realized margin.
- terminal advance وIdempotency لا يسمحان بخصم مزدوج.

## الخزن والتحقق

الـEngine ينزّل artifact فعلياً من Provider API عبر الـAdapter، ثم يتحقق من:

- allowlisted origin/path.
- HTTP status.
- Content-Type.
- maximum size.
- SVG أوWAV signature.
- SHA-256 checksum.

بعدها يخزنه محلياً in-memory ويقدمه من Engine URL. Persistence بقاعدة البيانات/Private Object Storage يبقى ضمن مراحل الخطة اللاحقة؛ المسار الحالي يثبت عقد ingest الحقيقي بلا Migration.

## إضافة مزود حقيقي لاحقاً

- حساب جديد لمزوّد مدعوم: secret reference وإعداد account/route فقط.
- Model/route جديد: Manifest + cost/capability fixtures + certification، من دون تعديل المحرك.
- Provider جديد: Adapter واحد يترجم documentation الخاص به إلى Canonical contract، ثم contract/canary/billing tests. لا يعاد بناء Ledger أوQuote أوOperation orchestration.

## التحقق

```sh
npm run verify:local
```

يشمل Provider API contract tests وEngine HTTP E2E عبر socket حقيقي، بالإضافة إلى typecheck واختبارات المحرك والواجهة والبناء.
