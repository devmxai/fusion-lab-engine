# OPENROUTER-001 — Async Video and Webhook Contract

| Field | Value |
|---|---|
| Status | `FIXTURE-TESTED — NOT CERTIFIED` |
| Adapter | `openrouter-video.v1` |
| Native accounting | `openrouter_credit`, scale `1,000,000`, actual source `usage.cost` |
| Real spend | `NONE` |

## Official contract mapped

- Video uses asynchronous `POST /api/v1/videos`, then polling by job ID and authenticated content download.
- Models are discovered through `/api/v1/videos/models`; a future importer must persist the raw response and `pricing_skus` hash before route publication.
- Completed poll/webhook must provide a result URL and `usage.cost`; missing cost is not silently estimated.
- Credits snapshot uses `/api/v1/credits` with a scoped Management Key and converts purchased minus used credits to integer microcredits.
- Per-request callback URL must be HTTPS.
- Webhook signature is `HMAC-SHA256(secret, timestamp + "," + raw_body)` with a five-minute absolute timestamp window.
- `X-OpenRouter-Idempotency-Key` is the Inbox delivery identity.

Official references:

- [OpenRouter video generation](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)
- [OpenRouter video webhooks](https://openrouter.ai/docs/cookbook/video-generation/video-generation-webhooks)
- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [OpenRouter remaining credits](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits)

## Fail-closed rules

- Network loss during submit becomes `SUBMISSION_UNKNOWN`; the adapter has no invented idempotency lookup API.
- A failed response with missing cost has `chargeStatus=UNKNOWN`, not confirmed no-charge.
- Completed response without `usage.cost` or content URL is invalid terminal evidence.
- Result download accepts only the configured OpenRouter origin and video content path, with redirects disabled.
- Generation and Management Keys remain server-side and are separate configuration inputs.

The local adapter is deliberately not registered in the active Provider Registry. Registration requires a certified route snapshot, Treasury policy, webhook receiver, canary and approvals.
