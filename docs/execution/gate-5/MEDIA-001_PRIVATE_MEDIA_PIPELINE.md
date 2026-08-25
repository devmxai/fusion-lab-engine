# MEDIA-001 — Private Media Pipeline Contract

| Field | Value |
|---|---|
| Status | `PROPOSED — LOCALLY TESTED` |
| Classification | User/provider media is `RESTRICTED` |
| Default access | Private; no public list/read |
| Owner | `MISSING` |
| Review trigger | Storage, provider fetch, media type, scanner, retention or delivery change |

## Provider result flow

```text
Canonical provider result URL
→ exact Origin allowlist
→ protocol/credentials/fragment checks
→ DNS and private/special IP rejection
→ adapter fetch with redirects disabled
→ size limit
→ magic bytes + declared MIME + expected media type
→ active-content and malware scan
→ SHA-256 and metadata probe
→ generated-originals-private
→ owner-bound short-lived access grant
→ ASSET_STORED
→ verified read eligibility
→ DELIVERED
```

The provider URL is never the durable user result. A failed validation or scanner result cannot become `ASSET_STORED`; eligible suspicious bytes are written only to `quarantine-private` with a reason and checksum.

## Local bucket contract

| Bucket | Classification | Access |
|---|---|---|
| `user-ingress-private` | RESTRICTED | Upload owner and scoped workers only |
| `generated-originals-private` | RESTRICTED | Owner/project authorization and short-lived grant |
| `quarantine-private` | RESTRICTED | Security/media review worker only |
| `media-proxies-private` | RESTRICTED | Planned; not implemented in local adapter |
| `cms-public` | PUBLIC | Marketing assets only; outside this implementation |

## Certified local formats

| Media | Declared type | Required magic / control | Local limit |
|---|---|---|---:|
| Image | PNG, JPEG, SVG | signature; SVG rejects script, event handlers, foreignObject, doctype/entities and external/data/javascript references | 5 MiB |
| Video | MP4 | ISO-BMFF `ftyp` marker | 100 MiB |
| Audio | WAV | `RIFF` + `WAVE` | 20 MiB |

These are local reference limits, not approved production policies. Production limits must be versioned by plan/product/route and enforced before and during streaming download.

## Resumable upload invariants

- Intent binds owner, project, media type, MIME, exact byte length, optional checksum and expiry.
- Each chunk must start at the committed offset; gaps and overwrite attempts fail.
- Finalize is denied until exact length arrives and checksum matches.
- Finalize validates/scans through the same pipeline as provider results.
- A completed finalize replays the same object rather than creating duplicates.
- Cross-owner status, append or finalize fails.

## Access grant invariants

- Raw tokens are returned once and stored only as SHA-256 hashes in the local adapter.
- Token binds one object and its owner and has a bounded lifetime.
- Missing, wrong-object, cross-owner and expired grants fail closed.
- Returned bytes are defensive copies.
- Long-lived signed URLs are prohibited in events and logs.

## Residual risks

The local scanner is a port demonstration using the EICAR signature, not an antivirus product. Metadata probing is minimal. A DNS preflight followed by a separate external client can still face DNS rebinding unless the production fetch transport pins the validated address and TLS hostname. These limitations block Gate 5.

