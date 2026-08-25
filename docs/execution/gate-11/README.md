# Gate 11 — Video, Audio, Multimodal and Mobile

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `STAGES 11.1–11.5 COMPLETE LOCALLY` |
| Gate decision | `LOCAL PASS / FORMAL HOLD` |
| Provider | `Provider For Test only` |
| Production / migration / deploy | `NONE` |
| Dependency note | `Gate 10 local criteria pass; formal Gate 10 remains HOLD` |

## Stage breakdown

| Stage | Scope | Status |
|---|---|---|
| `11.1` | Video Recipe manifests and multimode Composer UI | `COMPLETE LOCALLY` |
| `11.2` | Multimodal binding validation and Compatibility Diff | `COMPLETE LOCALLY` |
| `11.3` | Video Quote/Confirm/Generation and golden billing | `COMPLETE LOCALLY` |
| `11.4` | Audio/TTS/Avatar/Motion/Edit/Extend | `COMPLETE LOCALLY` |
| `11.5` | Mobile, recovery, E2E, accessibility, performance and Gate decision | `COMPLETE LOCALLY` |

No Stage 11 work is production authorization. Provider For Test remains the single local API Provider for image, video and audio operations.

## Stage 11.1 evidence

- Four explicit video recipes: Text-to-Video, Image-to-Video, First/Last and Multi-reference.
- Binding contracts publish exact cardinality and semantic slots: none, `FIRST_FRAME`, `FIRST_FRAME + LAST_FRAME`, or ordered `REFERENCE` aliases.
- Only the certified local registry model `local/test-video-v1` is selectable; no fake Fast/Premium models were invented.
- The manifest publishes duration (`5/10s`), resolution (`720p/1080p`), aspect ratio and audio controls.
- Quick Add opens Text-to-Video; selecting an Image or generated Image Output exposes Image-to-Video using the same Asset contract.
- Image-to-Video pins the selected image as `FIRST_FRAME`. Multi-reference preserves ordinals for stable `@image1…@image4` aliases.
- Video drafts persist per project independently of React Flow state.
- Quote/Generate remains disabled until Stage 11.3 implements server-side video pricing and generation.
- Browser checks covered Text-to-Video and Output-first Image-to-Video with no Console errors.
- Full local verification passed: TypeScript, `143/143` tests, Engine build, Provider For Test build and Vite build.

## Stage 11.2 evidence

- Strict validation now rejects missing, excess, duplicate, non-image, non-ready, misordered or incorrectly slotted Bindings.
- Prompt, certified model, supported recipe and every manifest-published setting are validated before pricing can become available.
- Recipe changes run through an explicit Compatibility Diff; destructive binding drops and semantic role changes cannot happen silently.
- Switching to a recipe with missing required images is blocked. A separately selected ready image can be proposed as the next required Binding.
- First/Last to Multi-reference conversion preserves order and explicitly reports role changes to stable `@image1…@image4` aliases.
- Quote/Generate remains deliberately disabled because Stage 11.3 has not connected server-side quote, confirm, execution and settlement.
- Chromium E2E covers blocked and accepted transitions across Image-to-Video, First/Last, Multi-reference and Text-to-Video.
- Full local verification passed: TypeScript, `147/147` Vitest tests, Engine build, Provider For Test build, Vite build and `3/3` Chromium E2E tests.

## Stage 11.3 evidence

- Dedicated local Engine endpoints implement Video Quote, Confirm, Run and Recovery while reusing the same commercial engine, ledger, operation state machine, media pipeline and Provider Registry.
- The server independently revalidates recipe cardinality, binding type/status, uniqueness, ordinals, semantic slots, prompt, certified model and the exact settings allowlist before pricing.
- The canonical provider request now carries the real prompt, aspect ratio and ordered semantic Bindings; the capturing-adapter test proves the payload reaches the Provider Adapter unchanged.
- Quote is read-only. Confirm uses a stable idempotency key and reserves Site Credits once while Provider Credits remain untouched until execution.
- Successful execution polls Provider For Test, downloads and validates `video/mp4`, stores it privately, records SHA-256, then settles both ledgers and creates Video Output + Lineage on the canvas.
- Golden billing matrix is exact: `5s/720p/no audio = site 20 / provider 10`, `5s/1080p = 30/15`, `10s/720p/audio = 50/25`, and `10s/1080p/audio = 70/35`.
- A reserved operation locks destructive Composer edits until it reaches a terminal result, preventing an orphaned customer hold.
- Chromium E2E covers compatibility transitions, Quote, zero-debit confirmation, generation, exact `20/10` settlement, MP4 delivery and refresh persistence.
- Full local verification passed: TypeScript, `156/156` Vitest tests, Engine build, Provider For Test build, Vite build, touched-file ESLint and `3/3` serial Chromium E2E tests.

## Stage 11.4 evidence

- Five manifest-driven local recipes are published: `audio.tts`, `video.avatar`, `video.motion-control`, `video.edit` and `video.extend`.
- All recipes reuse the same Provider Registry, commercial quote engine, whole-credit ledger, durable operation states, media validation and private result delivery; no per-feature provider engine was created.
- TTS uses certified `local/test-audio-v1`, counts exact characters for billing, forwards voice/speed controls and produces a verified WAV Audio Output.
- Avatar enforces `IMAGE/SOURCE + AUDIO/VOICE_AUDIO`; Motion Control enforces `IMAGE/SOURCE + VIDEO/MOTION`; Edit enforces `VIDEO/SOURCE` with optional `IMAGE/REFERENCE`; Extend enforces `VIDEO/SOURCE`.
- Client and server independently reject missing, duplicate, wrong-kind, unready, misordered or invented bindings/settings before Quote.
- Golden local billing is proven: 150-character TTS is `site 4 / provider 2`; 5-second Avatar with audio is `30/15`; default Motion/Edit/Extend are `20/10`.
- Quote remains read-only; Confirm reserves Site Credits once with zero provider debit; execution settles only after WAV/MP4 validation, private storage and SHA-256 evidence.
- Creative Space exposes TTS in Quick Add and context actions for Avatar, Motion Control, Edit and Extend. Generated Audio can be reused directly as Avatar `VOICE_AUDIO` without copying or changing the asset contract.
- Audio and Video focused viewers use explicit controls and never autoplay.
- Chromium E2E covers `TTS → Audio Output → Avatar`, exact cumulative wallet accounting, both result MIME types and no-autoplay viewers.
- Full local verification passed: TypeScript, `169/169` Vitest tests, Engine build, Provider For Test build, Vite build, touched-file ESLint and `4/4` serial Chromium E2E tests.

## Stage 11.5 evidence

- Mobile uses a dedicated four-action Dock and bottom Inspector Sheet; desktop keeps its fixed Inspector without rendering duplicate Composer controls.
- Safe-area top/bottom insets, `100dvh`, reduced-motion behavior and at least `44×44px` core touch targets are implemented.
- A complete Avatar flow binds Image and Audio by card taps only—no wire drag—while an invalid Binding keeps Quote disabled.
- Reserved-operation refresh recovery restores the same operation and financial snapshot before execution; Confirm remains site hold `30` / provider debit `0`, then settlement is exactly `30/15`.
- Focused Audio/Video viewers require an explicit action, expose native controls and never autoplay.
- Mobile and desktop Axe WCAG 2.0/2.1 A/AA checks report zero violations.
- Both desktop and mobile 100-card projects meet their local render budgets (`<3000ms` desktop, `<3500ms` mobile) and fit without horizontal page overflow.
- Browser inspection at `390×844` confirmed Dock, Quick Add and TTS Composer visibility with no runtime errors.
- Full local verification passed: TypeScript, `169/169` Vitest tests, Engine build, Provider Test build, Vite build and `6/6` serial Chromium E2E tests.
- The build still reports the known P1 main-chunk size warning; this does not authorize production.

## APU-G7 closure addendum

- سجل العمليات داخل Creative Space أصبح موحداً: كل عملية تعرض الوصفة والحالة و`Quote` العميل وتقدير المزود منفصلين عن الخصم/الكلفة الفعليين. لا تُعرض قيمة نهائية إلا بعد دليل مالي طرفي؛ فشل مثبت بلا خصم يظهر `0`، أما المصالحة غير المحسومة فتبقى `غير مثبتة`، مع تعليمات صريحة لحالتي `SUBMISSION_UNKNOWN` و`RECONCILIATION_REQUIRED`.
- سجل النشاط العام بقي منفصلاً عن سجل العمليات؛ لا يُخفى القرار المالي داخل رسالة نشاط قصيرة.
- رحلة Image E2E تتحقق الآن من ظهور العملية في هذا السجل بعد النتيجة والتسوية.
- لا يعني هذا التحسين واجهة تشغيل لمزود حقيقي أو تصديق Route؛ تظل كل البيانات محلية وfixture-based.

See `GATE-11-DECISION.md` for the formal dependency hold.
