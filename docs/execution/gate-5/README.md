# Gate 5 — Private Asset and Media Pipeline

| Field | Value |
|---|---|
| Plan | `FL-PMP-001 v1.1.0` |
| Status | `LOCALLY IMPLEMENTED REFERENCE` |
| Gate decision | `NOT EVALUATED / NOT PASSED` |
| Dependencies | Gate 2 approval and Gate 4 integration — approvals absent |
| Storage | In-memory private-store adapter only |
| Database / Supabase migration | `NONE` |
| Owner / reviewers | `MISSING — Media, Security and Privacy required` |

## Artifacts

- [MEDIA-001 — Private media contract and threat controls](./MEDIA-001_PRIVATE_MEDIA_PIPELINE.md)
- Executable package: `packages/media-pipeline/src/`
- Integrated local result path: Provider For Test → Engine media pipeline → short-lived private delivery grant

## Implemented locally

- Exact provider origin allowlist, URL credential/fragment rejection, DNS/IP classification and explicit loopback-only HTTP exception.
- Redirect disabled in the Provider For Test asset adapter.
- Size, expected media type, declared MIME and magic-byte agreement.
- SVG active-content rejection, local EICAR signature scanner port and private quarantine.
- SHA-256, immutable metadata and defensive byte copies.
- Private generated/user-ingress buckets through a storage port.
- Owner-bound short-lived access grants; anonymous asset access returns `403`.
- Resumable upload intents with exact offsets, interruption/resume, size/checksum and idempotent finalize.

## Gate blockers

1. Real private Supabase buckets, RLS/storage ownership and adversarial anonymous/cross-user tests.
2. TUS network service and multi-process/restart persistence; the current resumable session is in memory.
3. Production malware service, media probe and sandboxed transcode workers.
4. Posters/thumbnails/proxies/waveforms with performance and fidelity evidence.
5. Export/delete/soft-delete/purge retention workflows and legal/privacy approvals.
6. DNS rebinding-safe external fetch transport for real provider hostnames, not only preflight DNS policy.
7. Provider URL expiry recovery using durable object storage and retry evidence.

