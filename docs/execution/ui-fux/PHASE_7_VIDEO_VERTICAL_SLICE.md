# Phase 7 — Video vertical slice

Status: in progress.

## Fixed rules

- Standard Video discovers only `mediaType: video` published offers from the Engine.
- The first customer flow is Text-to-Video. Image-to-Video, First/Last Frame, references, continuation, and audio controls appear only when the selected published recipe certifies them.
- Price, duration, resolution, aspect ratio, audio, and every other billable setting come from the server-pinned quote configuration. The browser performs no cost calculation.
- Quote → reserve → monitor → settlement uses the same durable operation and ledger pathway as Image. Re-monitoring never creates a new operation.
- A completed private video is persisted by its delivery asset ID, not a Blob or provider URL. Playback/download reacquires a short-lived grant.

## Delivered foundation

- Video Engine requests now preserve typed Engine error codes.
- Video monitoring uses bounded backoff for transient failures and stops only on a recorded terminal operation state or the 15-minute review deadline.
- The polling client never treats a network error as provider failure, settlement, or refund.

## Ordered build

1. Build the Standard Video shell and T2V published-offer picker.
2. Persist durable draft/reservation/result projections and private delivery identity.
3. Add schema-rendered controls, exact quote review, and single-dispatch confirmation.
4. Add private video viewer/download, refresh recovery, terminal states, and delivery-expiry UI.
5. Add I2V/First-Last/reference/audio only after matching certified recipes are published.

## Gate 7

- No video selector, control, reference slot, or price is fabricated locally.
- Duration/resolution/aspect/audio combinations fail closed before quote when not in the selected offer contract.
- Browser tests prove one dispatch, refresh recovery, provider failure, reconciliation, and private delivery expiry.
- No provider URL, Blob URL, charge, or refund is inferred by the client.
