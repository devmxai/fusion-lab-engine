# LEGACY-001 — Legacy Retirement and Read-Only Window Contract

| Field | Value |
|---|---|
| Stage | `16.4` |
| Status | `COMPLETE LOCALLY / LOCAL SIMULATION ONLY` |
| Policy | `60–90 days Read-Only window, Single Replacement Writer, Immutable Financial Records` |
| Sequence | `ACTIVE → READ_ONLY → GRANTS_REVOKED → CODE_RETIRED` |
| Approvals | `Maker + distinct Engineering, Security, Finance, Support` |
| Authority | `LOCAL CONTRACT SIMULATION ONLY` |

## 1. Legacy Retirement Policy

The immutable Legacy Retirement Policy (`packages/release-governance/src/legacy.ts`) enforces strict four-role approval separation (Engineering, Security, Finance, and Support independent from the Maker) before any transition away from the legacy system begins.

The policy specifies the future formal deprecation target for:
- Legacy client-side completion endpoints (`/functions/v1/complete-generation`).
- Legacy client-side dispatch functions (`/functions/v1/start-generation`).
- Legacy mutable credit RPC grants (`user_credits` direct column mutations).
- Unversioned polling loops in legacy frontend studio components.

## 2. Mandatory Sequence & Invariants

```text
[ACTIVE] ──► [READ_ONLY (60–90 days)] ──► [GRANTS_REVOKED] ──► [CODE_RETIRED]
```

1. **Read-Only Window (60–90 Days):**
   - Read access remains available to users to query historical generations and export outputs.
   - In local development, the browser bridge can simulate this state and blocks legacy `start-generation` and `complete-generation` writes before its local provider request.
   - If any write is attempted on the legacy system during the read-only window, the retirement fails closed.
2. **Single Replacement Writer:**
   - Only the new Fastify Engine API and Whole-Credit Ledger V2 have write authority to financial balances and generation states.
   - Dual-write or competing background workers are strictly prohibited.
3. **Immutable Financial Evidence Retention:**
   - Financial journals, ledger lots, and reservation histories must be preserved under immutable legal retention mode.
   - Destructive deletion of historical financial rows is permanently prohibited (`destructiveLedgerDeletionAllowed = false`).
4. **Grants Revocation Before Code Retirement:**
   - Database RPC execution grants (`REVOKE EXECUTE`) and service role privileges must be stripped before legacy code is formally archived; this remains an unapplied formal cutover action.
   - Zero runtime references to legacy endpoints must remain active.

## 3. Local Audit & Verification Evidence

- Dedicated domain controller `InMemoryLegacyRetirementController` tests the full lifecycle.
- Four-role separation (Engineering, Security, Finance, Support) and independent Maker validation tested.
- Read-only 60–90 day boundary validation is tested for both grant revocation and code retirement, with recorded transition timestamps.
- Write attempts during read-only, unresolved in-flight operations, and unrevoked grants reject transition.
- Immutability of financial evidence verified (`destructiveLedgerDeletionPerformed = false`).
- The Gate evaluator consumes the resulting snapshot and cannot authorize Production from local evidence.
- Focused Legacy suite: `9/9` passed; Gate evaluator suite: `6/6` passed.
- Full repository suite: `356/356` Vitest tests across `55` files passed with 100% success; Chromium E2E passed `6/6`.

## 4. Boundary

All retirement transitions, observation windows, and approval fixtures are deterministic local simulations. The local V1 guard applies only to the development bridge; no live Supabase function, database migration, privilege revocation, or production traffic redirection has occurred.
