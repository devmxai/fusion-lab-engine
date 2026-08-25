# FusionLab SaaS Admin — UI Design Plan

| Field | Value |
|---|---|
| Document ID | `FL-ADMIN-UI-001` |
| Status | `REVIEWED BASELINE / IMPLEMENTATION NOT STARTED` |
| Product surface | FusionLab SaaS Admin |
| First interface | English-only, LTR |
| Arabic interface | Separate locale and RTL implementation after English stabilization |
| Scope | Information architecture, visual system, workflows, current-UI disposition, frontend structure, backend readiness and acceptance gates |
| Out of scope | Provider calls, API keys, production deployment, engine rewrite, database migration |
| Review | Admin SaaS architecture review + modern UI/UX review + final engine/backend compatibility review |

---

## 1. Executive decision

FusionLab will build a new, modern SaaS Admin above the existing engine. The current `AdminV2Page` will **not** be cosmetically polished into the final product.

The current page is a valuable technical Control Plane reader. It will be isolated temporarily under `Advanced & Audit`, then removed only after the new Admin reaches functional parity. The financial engine, provider control plane, RBAC, AAL2, maker/checker, idempotency, immutable audit, ledger, reservations, reconciliation, catalog snapshots, release bundles and evidence must remain intact.

> Simplicity belongs in presentation and guided workflows. It must never bypass or simplify the engine's security, financial or governance rules.

### Final product qualities

- Simple enough for a non-technical administrator.
- Powerful enough for finance, operations and platform specialists.
- One administrative purpose per page.
- Short labels, restrained icons and progressive disclosure.
- No fake buttons, invented numbers or browser-owned authority.
- No English/Arabic mixing.
- No provider activation without catalog, price, review and release evidence.

---

## 2. Fixed constraints

### 2.1 Must keep

- Server-owned authentication and authorization.
- AAL2 and role-based access.
- Maker/checker separation.
- Idempotent commands and version conflicts.
- Immutable audit and reason codes.
- Whole-credit ledger, holds, settlement and reconciliation.
- Provider attempts and actual-cost evidence.
- Catalog snapshots, diffs and source freshness.
- Typed pricing versions and atomic release bundles.
- Provider-neutral engine and registry boundaries.

### 2.2 Must not do

- No direct Supabase financial writes from the browser.
- No raw provider API key returned to UI, DOM, logs or analytics.
- No direct `Active` switch for a model or route.
- No direct balance edit; use an audited ledger adjustment.
- No hard delete for a user with financial history.
- No profit or margin claim without proven COGS, funding, FX and fees.
- No test/local fixture shown as a production provider model or offer.
- No button without a real typed backend command, permissions and tests.
- No `/dev` session bootstrap or local Admin authority in production.

---

## 3. Current Admin audit

### 3.1 Verified facts

The current implementation was inspected through the running UI and the source:

- `src/pages/AdminV2Page.tsx` is 707 lines.
- The page loads 18 read sources in one `Promise.all`.
- A failure in one secondary source can fail the complete refresh.
- Current navigation uses hash anchors such as `#catalog` and `#operations`.
- The observed page was approximately `13,477px` high at a `762 × 642` viewport.
- It contains 25 visible headings and 11 tables.
- Some tables require widths up to `1050px`.
- Search and filters run over data already loaded into the browser.
- `src/lib/admin-v2-client.ts` contains read functions only.
- Backend write routes exist partially, but the UI session is a local `ADMIN_VIEWER`.
- `/admin/v2` is a development-only reader, not the production Admin identity boundary.
- English typography currently resolves through `Cairo` before `Inter`.

### 3.2 Root cause

The current page exposes engine internals and daily SaaS administration at the same hierarchy level. Customers, subscriptions, operations, credentials, provider routes, pricing, approvals, release gates, snapshots and raw audit evidence all compete for attention in one continuous document.

This is an information-architecture problem, not only a styling problem.

---

## 4. Design principles

1. **One page, one job.** Every route answers one administrative question.
2. **Daily first, technical second.** Common tasks remain visible; evidence moves to details or Advanced.
3. **Progressive disclosure.** Lists show decisions; drawers show context; Advanced shows raw evidence.
4. **One primary action.** A page has at most one dominant CTA.
5. **Human state names.** Internal codes appear only in technical details.
6. **Evidence without clutter.** Every sensitive result keeps a receipt, but hashes are not primary content.
7. **Server authority.** The UI renders allowed actions returned by trusted server policy.
8. **Pessimistic sensitive actions.** Financial, credential and release actions wait for server confirmation.
9. **Independent failure.** A Reports failure must not break Users, Providers or the Admin shell.
10. **Separate languages.** English and Arabic use separate dictionaries, direction and typography.

---

## 5. Information architecture

### 5.1 Daily navigation

```text
Dashboard

Business
  Users
  Subscriptions

AI Gateway
  Providers
  Models
  Pricing

Monitoring
  Operations
  Reports

System
  Settings

Role-gated secondary area
  Advanced & Audit
```

There are nine daily navigation items. `Advanced & Audit` is a role-gated secondary destination at the bottom of the sidebar.

### 5.2 Navigation labels and icons

| Route | Label | Lucide icon | Purpose |
|---|---|---|---|
| `/admin/dashboard` | Dashboard | `LayoutDashboard` | Health, risk and next actions |
| `/admin/users` | Users | `Users` | Customer and wallet administration |
| `/admin/subscriptions` | Subscriptions | `CreditCard` | Plans and subscribers |
| `/admin/providers` | Providers | `Cable` | Connections, credentials and health |
| `/admin/models` | Models | `Boxes` | Discover and select provider models |
| `/admin/pricing` | Pricing | `BadgeDollarSign` | Customer pricing and review state |
| `/admin/operations` | Operations | `Activity` | Generations, failures and reconciliation |
| `/admin/reports` | Reports | `ChartNoAxesCombined` | Financial and usage reporting |
| `/admin/settings` | Settings | `Settings` | Platform and access configuration |
| `/admin/advanced/*` | Advanced & Audit | `ShieldCheck` | Governance, evidence and technical controls |

Sidebar items use one or two words and no descriptive paragraph.

### 5.3 Route map

```text
/admin                         → /admin/dashboard
/admin/dashboard

/admin/users
/admin/users/:userId

/admin/subscriptions
/admin/subscriptions/plans/:planId

/admin/providers
/admin/providers/:providerId

/admin/models
/admin/models/:modelId

/admin/pricing
/admin/pricing/:offerId

/admin/operations
/admin/operations/:operationId

/admin/reports
/admin/settings

/admin/advanced/approvals
/admin/advanced/audit
/admin/advanced/control-plane
/admin/advanced/catalog-snapshots
/admin/advanced/release-bundles
/admin/advanced/access
```

Hash navigation is prohibited in the new Admin.

---

## 6. Admin shell

### 6.1 Desktop

- Sidebar width: `240px` expanded and `72px` collapsed.
- Top bar height: `64px`.
- Main padding: `24px` to `32px`.
- Data pages use available width and are not forced into `max-w-7xl`.
- Sidebar top: product mark and environment.
- Sidebar bottom: Advanced, Help, Language and profile.
- Collapsed icons always have tooltips and accessible labels.

### 6.2 Top bar

Only the following are shown:

- Command search: `Ctrl/⌘ + K`.
- Tasks badge for approvals and critical exceptions.
- Environment badge: Development, Staging or Production.
- Language selector.
- Admin profile menu.

There is no global Refresh button. Every query owns its freshness, retry and `Last updated` state.

### 6.3 Responsive behavior

- `≥ 1280px`: expanded or collapsible sidebar and full priority columns.
- `1024–1279px`: collapsed sidebar by default and reduced table columns.
- `768–1023px`: compact shell; detail drawers use most of the viewport.
- `< 768px`: sidebar becomes a Sheet and drawers become full-screen.
- No horizontal scroll at page level. A specialized table may scroll inside its own boundary only.

---

## 7. Visual design system

### 7.1 Direction and typography

English UI:

```text
lang="en"
dir="ltr"
Font: Inter
Page title: 24/32, weight 600
Section title: 16/24, weight 600
Body and tables: 14/20, weight 400–500
Metadata: 12/18, weight 400–500
```

Arabic UI, implemented later as a separate locale:

```text
lang="ar"
dir="rtl"
Font: Cairo
```

`fontFamily.sans` must not place Cairo before Inter for the English interface.

### 7.2 Color tokens

The Admin uses a restrained dark system. Color communicates state and action, not decoration.

```text
App background       #0B0D10
Sidebar              #0E1116
Surface              #12161B
Raised surface       #171C22
Border               #262C35
Primary text         #F7F8FA
Muted text           #9AA4B2
Brand action         #6D5EF6
Success              #22C55E
Warning              #F59E0B
Danger               #EF4444
Information          #3B82F6
```

- Radius: `10–12px` consistently.
- No decorative glow in data pages.
- No repeated gradients.
- Shadows are reserved for menus, drawers and modal elevation.
- Status always includes text or an icon; color is never the only signal.

### 7.3 Spacing and density

Use the `4px` system:

```text
4, 8, 12, 16, 24, 32, 40
```

- Page section gap: `24px`.
- Card padding: `16–20px`.
- Table row: `44–52px`.
- Button: `36–40px`.
- Minimum touch target: `44px`.
- Icon size: `18–20px` with one stroke style.

### 7.4 Motion

- Functional transitions: `120–180ms`.
- Short row hover, drawer and menu transitions only.
- No distracting table or metric animations.
- Respect `prefers-reduced-motion`.

---

## 8. Shared UI patterns

### 8.1 List page

```text
Page title + one-line description                       Primary action
Search | primary filters | saved view
Optional 2–4 decision metrics
Data table
Server pagination
```

Rules:

- One `H1`.
- One primary CTA.
- Usually 5–7 visible columns.
- Row click opens details.
- Secondary actions live under `…`.
- Technical IDs are truncated with a copy action.
- No repeated explanation below every table.

### 8.2 Detail drawer

- Width: `480–560px` on desktop.
- Full-screen on mobile.
- Fixed header and footer.
- Scrollable content.
- Simple edits remain in the drawer.
- Deep, linkable history may use a detail route.

### 8.3 Modal

Use only for:

- Confirmation.
- A destructive or sensitive reason code.
- A short review summary.
- A task with no more than two or three fields.

Long history, large tables and raw evidence never belong in a modal.

### 8.4 Status component

Every status has:

- Human label.
- Semantic icon.
- Semantic color.
- Optional technical code in tooltip/details.
- A clear next action where applicable.

### 8.5 Required states

Every page and major section implements:

- `Loading`: local skeleton, without blanking the shell.
- `Empty`: short reason and at most one valid CTA.
- `Error`: local retry and safe error reference.
- `Forbidden`: clear permission statement, no disabled maze.
- `Stale`: `Last updated` and freshness warning.
- `Conflict`: current version changed; refresh and review before retry.

---

## 9. Page specifications

### 9.1 Dashboard

The first viewport answers:

1. Is the platform healthy?
2. Is there financial or provider risk?
3. What requires action now?

Maximum four primary metrics:

- Generations today.
- Success rate.
- Customer credits held.
- Items requiring attention.

Additional compact sections:

- Provider health strip.
- Recent operations: 5–8 rows.
- Action center: approvals, critical failures and low verified balance.
- Conditional onboarding checklist, hidden after completion.

Do not show route IDs, hashes, role matrices, ledger journals or raw evidence.

Financial metrics appear only when their source is proven. Otherwise show `Unavailable`, not zero.

### 9.2 Users

Default columns:

```text
User | Status | Plan | Available credits | Usage | Last active | Actions
```

Filters:

- Search.
- Status.
- Plan.
- Registration date.

User details:

```text
Overview | Subscription | Wallet | Operations | Audit
```

Rules:

- Current backend owners are finance identities, not a complete Auth customer directory.
- Do not show email, trial, ban or profile actions until the customer-directory contract exists.
- Balance changes use an audited Ledger Adjustment, never an editable wallet field.
- Users with financial history are disabled or anonymized through governance, never hard-deleted.

### 9.3 Subscriptions

Tabs:

```text
Plans | Subscribers
```

Plan columns:

```text
Plan | Billing | Price | Credits | Subscribers | Status | Actions
```

Eventual plan editor fields:

- Name.
- Monthly or annual interval.
- Currency and amount.
- Credits per period.
- Trial days.
- Rollover policy.
- Limits.
- Lifecycle state.

Current contracts expose a local monthly read snapshot only. `New plan`, plan editing, annual plans and the subscriber directory remain hidden until typed backend contracts exist.

Plan changes create a new immutable version; historical subscriptions are never silently rewritten.

### 9.4 Providers

Default columns:

```text
Provider | Connection | Credentials | Catalog | Models | Balance | Health | Actions
```

For the current registry, KIE and OpenRouter are known onboarding profiles. The action is `Configure`, not a generic `Add provider`.

An arbitrary provider can be added only after a Generic Provider Registry contract exists.

Provider details:

```text
Overview | Credentials | Catalog | Models | Usage | Incidents
```

Four-stage UI wizard:

```text
1. Configure credentials
2. Verify account
3. Review catalog and account availability
4. Continue to Models and Pricing
```

This UI grouping does not replace the backend state machine. Credential write, test, activation, catalog evidence, account availability, pricing, approval and release remain separate controlled states.

Rules:

- Public reference models may appear before an API key.
- The API key proves connection and account-specific availability; it does not create the public catalog.
- The key is write-only and never displayed after submission.
- Show only fingerprint, version, state and rotation time after saving.
- `Secret Manager` is not a primary navigation item; it lives inside Provider details.

### 9.5 Models

Purpose: discovery and selection, not price editing.

Toolbar:

- Search.
- Provider.
- Modality.
- Platform state.
- `Add models` only after a typed selection command is available.

Default columns:

```text
Model | Provider | Type | Published rate | Platform state | Updated | Actions
```

Suggested human states:

```text
Reference
Available
Selected
Pricing needed
In review
Active
Paused
Unavailable
```

Flow:

```text
Official reference model
→ Select
→ Create route candidate
→ Add to pricing
```

Model detail shows capabilities, limits, source freshness and account availability. Route composition, parser versions and hashes remain in Advanced details.

The action is `Add to pricing`; there is no direct `Active` toggle.

### 9.6 Pricing

Purpose: manage only selected models and customer offers.

Default columns:

```text
Model | Provider rate/cost | Customer price | Margin state | Status | Effective date | Actions
```

Filters:

- Provider.
- Modality.
- Status.
- Margin risk.

The pricing drawer separates:

- `Provider published rate`: documented provider price, read-only.
- `Actual provider cost`: operation evidence, where available.
- `Customer price`: FusionLab credits charged to the customer.
- Pricing unit and dimensions.
- Effective date.
- Internal note.
- Simulation result, only from a server projection.

Never label a published provider rate as actual cost. Never show profit or confirmed margin until COGS, funding, FX, fees and actual cost are proven.

Workflow:

```text
Save draft
→ Validate
→ Simulate
→ Submit for review
→ Independent approval
→ Publish atomic release bundle
→ Active offer
```

Saving and activation are never the same action. The maker cannot approve the same change.

### 9.7 Operations

This page replaces the current Financial Engine, Generation History and Exception Queue sections.

Tabs:

```text
All | Processing | Succeeded | Failed | Refunded | Needs review
```

Default columns:

```text
Operation | User | Model | Provider | Customer charge | Provider cost | Status | Time
```

Operation details:

- Execution timeline.
- Customer credit reservation and settlement.
- Provider attempts.
- Delivery/result evidence.
- Refund or reconciliation state.
- Audit receipt.
- Collapsible `Technical evidence` for ledger journals and internal IDs.

`Retry`, `Refund` and `Resolve` remain hidden until typed, idempotent and audited commands exist.

### 9.8 Reports

Planned reports:

- Provider spending.
- Customer credit revenue.
- Confirmed gross margin.
- Refunds and provider loss.
- Credit liability.
- Usage by provider, model and plan.

Rules:

- Maximum 3–4 charts in one view.
- Filters by period, provider, model and plan.
- Export appears only after a real export contract.
- Use `Margin unavailable` when the required financial inputs are incomplete.
- Raw engine values are not silently converted into business profit.

### 9.9 Settings

Planned sections:

- General.
- Currency and credits.
- Alerts.
- Roles and access.
- Localization.
- Billing configuration.
- Security.

Only settings backed by typed read/write contracts are rendered. Planned settings do not appear as editable controls before backend readiness.

### 9.10 Advanced & Audit

Role-gated destinations:

- Approval Inbox.
- Change Sets.
- Release Bundles.
- Immutable Audit Log.
- Catalog Snapshots and diffs.
- Route Release Gates.
- Command policies.
- Credential metadata versions.
- Technical Route Catalog.
- Temporary legacy Control Plane reader.

The daily UI may show a count or human blocker and link here, but raw hashes, JSON and route internals stay in this area.

---

## 10. Current UI disposition matrix

| Current element | Decision | New destination |
|---|---|---|
| Header | Replace | Admin Shell + page header |
| Hash sidebar | Delete after new routes work | Nested React Router routes |
| `Run your platform in three clear steps` | Replace | Conditional Providers onboarding |
| Provider treasury / Shadow balance | Rename and reuse only with proven source | Dashboard and Reports |
| Reconciliation / Open holds | Reuse as attention metrics | Dashboard and Operations |
| Customers table | Replace | Users finance view, then full Users after backend |
| Commerce & subscriptions | Replace | Subscriptions |
| Financial operations engine | Merge | Operations summary |
| Generation history | Merge | Operations main table |
| Exception queue | Merge | Operations `Needs review` |
| Approval center cards | Reduce | Dashboard task count |
| Admin Command Center | Isolate | Advanced → Access/Policies |
| Approval Inbox | Isolate | Advanced → Approvals |
| Secret Manager | Move and redesign | Provider → Credentials |
| Route Catalog | Isolate | Advanced technical route details |
| Current boundaries | Delete from product UI | Documentation/build mode diagnostics |
| Models & pricing combined card | Replace | Independent Models and Pricing pages |
| Five-step workflow strip | Replace | Contextual progress only inside workflows |
| Choose an AI provider | Replace | Four-stage provider configuration wizard |
| Reference Catalog | Reuse as data source | Models |
| Catalog route table | Move | Model/Provider detail; raw form in Advanced |
| Model pricing readiness | Merge | Pricing status/filter |
| Pricing workbench | Replace | One Pricing table and drawer |
| Provider readiness cards | Merge | Providers list/detail |
| Route release gates | Isolate | Advanced; short blocker in Pricing |
| Catalog/pricing evidence | Isolate | Advanced → Snapshots |
| Change history | Isolate | Advanced → Change Sets |
| Immutable audit history | Isolate | Advanced → Audit |
| Raw JSON payload | Isolate | Advanced only |
| Owner/operation dialogs | Replace | Linkable detail routes or drawers |
| Repeated warning paragraphs | Delete/shorten | Contextual alert or tooltip |
| Duplicate provider cards | Delete | One Providers source of truth |
| Global client-side search | Replace | Page search + command palette |
| `AdminV2Page.tsx` | Rename and isolate temporarily | `/admin/advanced/control-plane` |
| Legacy Admin files already disconnected | Keep retired/deleted | Never restore |
| Local provider | Hide from public Admin | Keep test-only until test replacement closes |

### Deletion rule

Nothing is deleted merely because it is technical. Delete only duplicate presentation, stale copy and retired UI after route parity. Preserve services, evidence, audit, financial state and tests.

---

## 11. Backend readiness and UI gating

| Capability | Current readiness | UI decision |
|---|---|---|
| Dashboard summaries | Partial read support | Build only metrics backed by current projections |
| Wallet and finance history | Read support | Read-only Users finance view is allowed |
| Customer profile/email/trial/ban | `BACKEND REQUIRED` | Hide fields and actions |
| Credit adjustment | Generic governed resource exists | Hide until typed command, AAL2 and review UI |
| User anonymization | Governance resource exists | Hide until typed command and tests |
| Subscription plans read | Local read snapshot | Label as local/read-only during development |
| Plan CRUD, retirement and annual billing | `BACKEND REQUIRED` | Hide CTAs and fields |
| Subscriber directory | `BACKEND REQUIRED` | Do not present as complete page data |
| Provider readiness | Read support | Providers read page allowed |
| Generic provider creation | `BACKEND REQUIRED` | Use Configure for known providers only |
| Credential write/test/activate/revoke | Backend routes exist | Requires real Admin auth and typed command client |
| Provider health | Backend route exists | Add query client and projection |
| Public reference models | Read support after snapshot | Models read page allowed |
| Account model availability | Requires verified account evidence | Show separately from public catalog |
| Catalog import/sync | `BACKEND REQUIRED` as guided typed command | Hide Sync action until ready |
| Select model / route candidate | `BACKEND REQUIRED` as typed facade | Hide Add models/Add to pricing until ready |
| Pricing draft | Generic Change Set exists | Build typed pricing command before editor action |
| Pricing simulation | Transition exists | Requires UI-friendly result projection |
| Direct activation | Architecturally prohibited | Never implement |
| Release publish | Internal governed path exists | Use typed release command; no browser raw JSON |
| Operations list/detail | Read support | Operations read page allowed |
| Retry/refund/resolve | `BACKEND REQUIRED` | Hide actions |
| Reports | Aggregate projections required | Show only proven available metrics |
| Export | `BACKEND REQUIRED` | Hide action |
| Settings/RBAC writes | `BACKEND REQUIRED` | Hide editable controls |
| Approvals and audit | Read support | Advanced read pages allowed |
| Approval mutations | Backend transitions exist | Requires real identity, command client and capability policy |

### Rule for every action

A UI action can appear only when all seven conditions are satisfied:

1. Typed server command.
2. AAL2 Admin identity.
3. Server-derived permission/capability.
4. Idempotency key.
5. Defined success, validation, conflict and failure responses.
6. Audit/receipt evidence.
7. Integration and E2E tests.

The browser must not infer authority only from a role label.

---

## 12. Frontend architecture

```text
src/features/admin/
  app/
    AdminRoutes.tsx
    admin-route-config.ts

  layout/
    AdminShell.tsx
    AdminSidebar.tsx
    AdminTopbar.tsx
    AdminPageBoundary.tsx

  components/
    PageHeader.tsx
    DataTable.tsx
    FilterBar.tsx
    MetricCard.tsx
    StatusBadge.tsx
    DetailDrawer.tsx
    EmptyState.tsx
    ErrorState.tsx
    ForbiddenState.tsx
    StaleDataNotice.tsx
    ConfirmActionDialog.tsx
    CommandReceipt.tsx

  dashboard/
  users/
  subscriptions/
  providers/
  models/
  pricing/
  operations/
  reports/
  settings/
  advanced/

  data/
    admin-query-client.ts
    admin-command-client.ts
    admin-query-keys.ts
    admin-capabilities.ts

  i18n/
    en.ts
    ar.ts
```

### Data rules

- Use TanStack Query per route and resource.
- Use page-level lazy loading and error boundaries.
- Split `admin-v2-client.ts` into queries and typed commands.
- Use server pagination, filtering and sorting.
- Do not load unrelated page data.
- Do not cache raw secrets.
- Do not use optimistic updates for money, credentials, access or release.
- Invalidate only affected query keys after a confirmed command.
- Sensitive commands return a safe receipt/change reference.

### Security rules

- Add a real `RequireAdmin` route boundary.
- Verify identity cryptographically on the server.
- Resolve workspace roles from server-controlled membership.
- Return allowed actions/capabilities from trusted policy.
- Remove development bootstrap and `/v1/dev/admin-v2` from production paths.
- Keep all direct database financial mutations out of the browser.

---

## 13. Implementation phases and closure gates

### UI-G0 — Contract freeze

Deliverables:

- Final route map and navigation copy.
- Query/command/action capability matrix.
- Human status dictionary.
- Data-source map for every metric and field.
- Final disposition of every current Admin section.

Closure:

- No planned button lacks a backend readiness decision.
- No business metric lacks a named source.
- English copy contains no Arabic strings.

### UI-G1 — Security, shell and isolation

Deliverables:

- Real `RequireAdmin` boundary design/implementation dependency.
- AdminShell, sidebar, top bar and nested routes.
- English typography and design tokens.
- Page-level lazy loading and error boundaries.
- Current `AdminV2Page` isolated at `/admin/advanced/control-plane`.

Closure:

- `/admin` resolves to `/admin/dashboard`.
- No hash navigation remains in the daily Admin.
- Daily navigation contains nine items or fewer.
- Failure of one page does not blank the shell.

### UI-G2 — Shared component system

Deliverables:

- PageHeader.
- DataTable with server pagination contract.
- FilterBar.
- StatusBadge.
- DetailDrawer.
- Loading/Empty/Error/Forbidden/Stale states.
- Confirmation and command receipt patterns.

Closure:

- Components pass keyboard and responsive checks.
- No list page needs a custom navigation or status language.

### UI-G3 — Read-only daily Admin

Deliverables:

- Dashboard from proven projections.
- Users finance view.
- Subscriptions local read view.
- Providers readiness view.
- Reference Models view.
- Pricing readiness view.
- Operations list/details.
- Advanced approvals/audit/snapshots readers.

Closure:

- Each page loads independently.
- No unavailable action is rendered as functional.
- Internal evidence is absent from default daily views.

### UI-G4 — Provider command workflow

Implementation status: **foundation in progress** — the server now projects
the authenticated session's actual provider-credential capabilities, and the
typed, idempotent command client is present. The protected credential form,
verification receipt and activation/revocation controls remain deliberately
deferred until a real AAL2 Admin identity is connected; the local viewer may
never see a fake setup action.

Dependencies:

- Real Admin identity and AAL2.
- Typed credential and provider command client.
- Server capability response.

Deliverables:

- Write-only credential entry.
- Account verification.
- Credential activation/revocation.
- Provider health.
- Approved catalog intake.
- Four-stage provider configuration UI.

Closure:

- Secret never returns to response, DOM, logs or analytics.
- Commands are idempotent, role-aware and audited.
- UI cannot skip credential or evidence states.

### UI-G5 — Models and pricing workflow

Dependencies:

- Typed route-candidate/model-selection facade.
- Typed pricing version and simulation projections.
- Atomic release bundle command.

Deliverables:

- Add models drawer.
- Route candidate creation.
- Pricing editor.
- Validation and simulation result.
- Maker/checker review.
- Governed publish and active-offer result.

Closure:

- Model to Pricing Draft takes three administrative steps or fewer.
- Save and Activate are separate.
- Maker cannot approve the same change.
- No offer activates without provider, catalog, price, approval and release evidence.

### UI-G6 — Business administration

Dependencies:

- Customer directory and user-lifecycle contracts.
- Plan versioning, annual billing and subscriber contracts.
- Reporting projections and settings/RBAC commands.

Deliverables:

- Complete Users administration.
- Plans and Subscribers administration.
- Reports.
- Editable Settings and access management.

Closure:

- No hard delete of financial identity.
- Historical plans remain immutable.
- Reports never label incomplete calculations as profit.

### UI-G7 — Localization, QA and legacy removal

Deliverables:

- Separate Arabic locale and RTL shell after English stabilization.
- Responsive, accessibility, performance and E2E suites.
- Production route hardening.
- Legacy Control Plane UI removal after parity.

Closure:

- English UI has no Arabic strings; Arabic UI uses the separate dictionary.
- WCAG 2.2 AA and Axe have no Critical/Serious findings.
- No horizontal page scroll at 1024px.
- Local/dev authority cannot ship to production.
- Legacy UI has no routes or imports after deletion.
- Engine, audit, evidence and test-only provider contracts remain intact.

---

## 14. Test matrix

### 14.1 Visual and responsive

Test at minimum:

```text
1440 × 900
1280 × 800
1024 × 768
768 × 1024
390 × 844
```

Verify:

- Sidebar behavior.
- No page-level horizontal scroll.
- Table column priority.
- Drawer and Sheet behavior.
- Empty/error/forbidden/loading/stale states.
- Long model names, IDs and currencies.

### 14.2 Accessibility

- Complete keyboard navigation.
- Visible focus rings.
- Correct heading order and one H1 per page.
- Dialog/drawer focus trapping and restoration.
- Status not communicated by color alone.
- Text contrast at least `4.5:1` where required.
- Axe: zero Critical and Serious findings.

### 14.3 Security and governance

- Unauthorized navigation is denied by server and UI boundary.
- AAL2-required action cannot be called from viewer session.
- Maker cannot approve own change.
- Idempotent replay returns the same safe outcome.
- Version conflict never overwrites newer state.
- Raw secret never appears in response, cache, DOM, logs or analytics.
- Release cannot bypass catalog, price, approval or evidence gates.

### 14.4 End-to-end workflows

- Provider → verified account → catalog review.
- Reference model → route candidate → Pricing Draft.
- Pricing Draft → validation → simulation → independent approval → publish.
- Operation → hold → provider attempt → settlement or refund/reconciliation.
- User finance history → governed adjustment receipt.

All local E2E tests must use offline fixtures and must not call a paid provider.

---

## 15. Global acceptance criteria

- Nine or fewer daily navigation items.
- Every page represents one administrative job and one real route.
- Every page has one H1 and at most one primary CTA.
- Daily tables normally expose no more than seven columns.
- No visible description exceeds two short lines.
- No page loads another page's complete dataset.
- A query failure is isolated to its page or section.
- Server pagination and filtering exist for production lists.
- No fake, disabled maze of unavailable actions.
- No direct activation, hard financial deletion or browser-owned money mutation.
- No secret exposure.
- No invented provider cost, margin, revenue or profit.
- Public reference models and account availability are displayed as separate facts.
- No model becomes available to Creative Space before an active published offer exists.
- Advanced technical evidence is accessible to authorized roles without polluting daily screens.
- English and Arabic remain separate interfaces.
- The old UI is removed only after functional parity and E2E evidence.

---

## 16. Definition of done

This plan is complete when:

1. The new Admin is the sole daily administration entry point.
2. The current technical page is either role-gated in Advanced or removed after parity.
3. Every visible action maps to a typed, authorized, idempotent and audited backend command.
4. Every financial number has a named and verified source.
5. Provider, model, pricing and activation remain separate controlled decisions.
6. Users, subscriptions, operations and reporting are understandable without exposing engine internals.
7. Accessibility, responsive, security and workflow E2E gates pass.
8. No paid-provider request is needed to verify the UI implementation locally.
9. The engine, governance, financial evidence and test contracts remain preserved.

Only after this definition of done may the legacy Admin UI be deleted permanently.
