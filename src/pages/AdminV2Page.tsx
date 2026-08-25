import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BadgeCheck, CircleDollarSign, ClipboardCheck, KeyRound, LockKeyhole, Network, RefreshCw, Search, ShieldCheck, TriangleAlert, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getAdminChanges,
  getAdminApprovalInbox,
  getAdminCatalogRoutes,
  getAdminAudit,
  getAdminProviderReadiness,
  getAdminRouteReleaseGates,
  getAdminWorkflowPolicies,
  getCatalogSnapshots,
  getReferenceCatalogModels,
  getReferenceCatalogSnapshots,
  getCommerceAdminOverview,
  getDurableAdminOverview,
  getDurableOperationExceptions,
  getDurableOwnerFinance,
  getDurableOwners,
  getDurableOperations,
  getDurableOperationHistory,
  getAdminOverview,
  getCredentialMetadata,
  getOfflineProviderCatalog,
  type AdminChange,
  type AdminApprovalInboxItem,
  type AdminAuditRecord,
  type AdminCatalogRoute,
  type CatalogSnapshot,
  type ReferenceCatalogModel,
  type ReferenceCatalogSnapshot,
  type AdminOverview,
  type AdminProviderReadiness,
  type AdminRouteReleaseGate,
  type AdminWorkflowPolicy,
  type CredentialMetadata,
  type CommerceAdminOverview,
  type DurableAdminOverview,
  type DurableOperationHistory,
  type DurableOperationException,
  type DurableOwnerFinance,
  type DurableOwnerDirectoryItem,
  type DurableOperationListItem,
  type OfflineProviderCatalogRoute,
} from "@/lib/admin-v2-client";

const stageLabel: Record<AdminChange["state"], string> = {
  DRAFT: "Draft", VALIDATED: "Validated", SIMULATED: "Simulated",
  APPROVED: "Approved", PUBLISHED: "Published", REJECTED: "Rejected",
};

const exceptionLabel: Record<DurableOperationException["category"], string> = {
  RECONCILIATION_REQUIRED: "Financial reconciliation required",
  SUBMISSION_UNKNOWN: "Provider acceptance is unconfirmed",
  OUTBOX_DEAD_LETTER: "Internal delivery failed",
  PROVIDER_SUCCESS_EVIDENCE_INCOMPLETE: "Provider success evidence is incomplete",
  PROVIDER_SUCCESS_RESULT_MISSING: "Provider result evidence is missing",
  REFUND_EVIDENCE_REQUIRED: "Refund evidence required",
  DELIVERY_EVIDENCE_REQUIRED: "Delivery evidence required",
};

const releaseGateLabel: Record<AdminRouteReleaseGate["blockers"][number], string> = {
  LOCAL_TEST_SCOPE: "Local test scope only",
  NOT_PUBLISHED: "Route is not published",
  NO_ACTIVE_CREDENTIAL: "No active credential",
  EXTERNAL_VALIDATION_NOT_AUTHORIZED: "External validation is not authorized",
};

export default function AdminV2Page() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [changes, setChanges] = useState<AdminChange[]>([]);
  const [approvalInbox, setApprovalInbox] = useState<AdminApprovalInboxItem[]>([]);
  const [workflowPolicies, setWorkflowPolicies] = useState<AdminWorkflowPolicy[]>([]);
  const [audit, setAudit] = useState<{ chainValid: boolean; records: AdminAuditRecord[] }>({ chainValid: false, records: [] });
  const [selectedChange, setSelectedChange] = useState<AdminChange | null>(null);
  const [selectedCatalogRoute, setSelectedCatalogRoute] = useState<OfflineProviderCatalogRoute | null>(null);
  const [credentials, setCredentials] = useState<CredentialMetadata[]>([]);
  const [catalogRoutes, setCatalogRoutes] = useState<AdminCatalogRoute[]>([]);
  const [offlineCatalog, setOfflineCatalog] = useState<OfflineProviderCatalogRoute[]>([]);
  const [catalogSnapshots, setCatalogSnapshots] = useState<CatalogSnapshot[]>([]);
  const [referenceCatalogSnapshots, setReferenceCatalogSnapshots] = useState<ReferenceCatalogSnapshot[]>([]);
  const [referenceCatalogModels, setReferenceCatalogModels] = useState<ReferenceCatalogModel[]>([]);
  const [providerReadiness, setProviderReadiness] = useState<AdminProviderReadiness[]>([]);
  const [routeReleaseGates, setRouteReleaseGates] = useState<AdminRouteReleaseGate[]>([]);
  const [durable, setDurable] = useState<DurableAdminOverview | null>(null);
  const [commerce, setCommerce] = useState<CommerceAdminOverview | null>(null);
  const [durableOperations, setDurableOperations] = useState<DurableOperationListItem[]>([]);
  const [durableOwners, setDurableOwners] = useState<DurableOwnerDirectoryItem[]>([]);
  const [durableExceptions, setDurableExceptions] = useState<DurableOperationException[]>([]);
  const [operationHistory, setOperationHistory] = useState<DurableOperationHistory | null>(null);
  const [ownerFinance, setOwnerFinance] = useState<DurableOwnerFinance | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [catalogProvider, setCatalogProvider] = useState<string>("all");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [pricingReadinessFilter, setPricingReadinessFilter] = useState<string>("all");
  const [adminSearch, setAdminSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [nextOverview, nextChanges, nextApprovalInbox, nextWorkflowPolicies, nextAudit, nextCredentials, nextCatalogRoutes, nextOfflineCatalog, nextSnapshots, nextReferenceSnapshots, nextReferenceModels, nextProviderReadiness, nextRouteReleaseGates, nextDurable, nextCommerce, nextDurableOperations, nextDurableOwners, nextDurableExceptions] = await Promise.all([
        getAdminOverview(), getAdminChanges(), getAdminApprovalInbox(), getAdminWorkflowPolicies(), getAdminAudit(), getCredentialMetadata(), getAdminCatalogRoutes(), getOfflineProviderCatalog(), getCatalogSnapshots(), getReferenceCatalogSnapshots(), getReferenceCatalogModels(), getAdminProviderReadiness(), getAdminRouteReleaseGates(), getDurableAdminOverview(), getCommerceAdminOverview(), getDurableOperations(), getDurableOwners(), getDurableOperationExceptions(),
      ]);
      setOverview(nextOverview);
      setChanges(nextChanges);
      setApprovalInbox(nextApprovalInbox);
      setWorkflowPolicies(nextWorkflowPolicies);
      setAudit(nextAudit);
      setCredentials(nextCredentials);
      setCatalogRoutes(nextCatalogRoutes);
      setOfflineCatalog(nextOfflineCatalog);
      setCatalogSnapshots(nextSnapshots);
      setReferenceCatalogSnapshots(nextReferenceSnapshots);
      setReferenceCatalogModels(nextReferenceModels);
      setProviderReadiness(nextProviderReadiness);
      setRouteReleaseGates(nextRouteReleaseGates);
      setDurable(nextDurable);
      setCommerce(nextCommerce);
      setDurableOperations(nextDurableOperations);
      setDurableOwners(nextDurableOwners);
      setDurableExceptions(nextDurableExceptions);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Admin Control Plane");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openOperationHistory = async (operationId: string) => {
    setHistoryLoading(true);
    try { setOperationHistory(await getDurableOperationHistory(operationId)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not load operation history"); }
    finally { setHistoryLoading(false); }
  };
  const openOwnerFinance = async (ownerId: string) => {
    setOwnerLoading(true);
    try { setOwnerFinance(await getDurableOwnerFinance(ownerId)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not load customer finance history"); }
    finally { setOwnerLoading(false); }
  };
  const normalizedSearch = adminSearch.trim().toLowerCase();
  const normalizedCatalogSearch = catalogSearch.trim().toLowerCase();
  const catalogRows = useMemo(() => offlineCatalog.filter((route) => (
    (catalogProvider === "all" || route.providerId === catalogProvider)
    && `${route.model} ${route.family} ${route.protocol} ${route.mediaType}`.toLowerCase().includes(normalizedCatalogSearch)
    && (!normalizedSearch || `${route.model} ${route.family} ${route.protocol} ${route.mediaType} ${route.providerId}`.toLowerCase().includes(normalizedSearch))
  )), [catalogProvider, normalizedCatalogSearch, normalizedSearch, offlineCatalog]);
  const referenceModelRows = useMemo(() => referenceCatalogModels.filter((model) => (
    (catalogProvider === "all" || model.providerId === catalogProvider)
    && `${model.displayName} ${model.providerModelId} ${model.familyId} ${model.modalities.join(" ")} ${model.supportedParameters.join(" ")}`.toLowerCase().includes(normalizedCatalogSearch)
    && (!normalizedSearch || `${model.displayName} ${model.providerModelId} ${model.familyId} ${model.providerId}`.toLowerCase().includes(normalizedSearch))
  )), [catalogProvider, normalizedCatalogSearch, normalizedSearch, referenceCatalogModels]);
  const operationRows = useMemo(() => durableOperations.filter((operation) => !normalizedSearch || `${operation.operationId} ${operation.ownerId} ${operation.state} ${operation.providerId ?? ""}`.toLowerCase().includes(normalizedSearch)), [durableOperations, normalizedSearch]);
  const ownerRows = useMemo(() => durableOwners.filter((owner) => !normalizedSearch || owner.ownerId.toLowerCase().includes(normalizedSearch)), [durableOwners, normalizedSearch]);
  const exceptionRows = useMemo(() => durableExceptions.filter((exception) => !normalizedSearch || `${exception.operationId} ${exception.ownerId} ${exception.category} ${exception.reason}`.toLowerCase().includes(normalizedSearch)), [durableExceptions, normalizedSearch]);
  const changeRows = useMemo(() => changes.filter((change) => !normalizedSearch || `${change.resourceType} ${change.resourceId} ${change.makerId} ${change.reasonCode} ${change.state}`.toLowerCase().includes(normalizedSearch)), [changes, normalizedSearch]);
  const auditRows = useMemo(() => audit.records.filter((record) => !normalizedSearch || `${record.sequence} ${record.actorId} ${record.action} ${record.resourceType} ${record.resourceId} ${record.versionId}`.toLowerCase().includes(normalizedSearch)), [audit.records, normalizedSearch]);
  const pricingWorkbenchRows = useMemo(() => catalogRows.map((route) => ({
    route,
    pricing: changes.find((change) => change.resourceType === "PRICING_POLICY" && change.resourceId === route.routeId),
    snapshot: catalogSnapshots.find((snapshot) => snapshot.snapshotId === route.snapshotId) ?? null,
  })), [catalogRows, changes, catalogSnapshots]);
  const pricingReadinessRows = useMemo(() => pricingWorkbenchRows.map(({ route, pricing, snapshot }) => {
    const gate = routeReleaseGates.find((candidate) => candidate.routeId === route.routeId) ?? null;
    const priceConfigured = Number.isInteger(pricing?.payload.customerCredits) && Number(pricing?.payload.customerCredits) > 0;
    const status = !snapshot ? "NEEDS_SNAPSHOT"
      : !priceConfigured ? "NEEDS_PRICE_POLICY"
        : pricing?.state !== "PUBLISHED" ? "PRICING_IN_REVIEW"
          : "RELEASE_GATED";
    const nextStep = status === "NEEDS_SNAPSHOT" ? "Import a verified catalog"
      : status === "NEEDS_PRICE_POLICY" ? "Set a customer price"
        : status === "PRICING_IN_REVIEW" ? "Complete independent review"
          : "Review release requirements";
    return { route, pricing, snapshot, gate, status, nextStep };
  }), [pricingWorkbenchRows, routeReleaseGates]);
  const pricingReadinessCounts = useMemo(() => Object.fromEntries(
    ["NEEDS_SNAPSHOT", "NEEDS_PRICE_POLICY", "PRICING_IN_REVIEW", "RELEASE_GATED"].map((status) => [
      status,
      pricingReadinessRows.filter((row) => row.status === status).length,
    ]),
  ) as Record<string, number>, [pricingReadinessRows]);
  const filteredPricingReadinessRows = useMemo(() => pricingReadinessRows.filter((row) => (
    pricingReadinessFilter === "all" || row.status === pricingReadinessFilter
  )), [pricingReadinessFilter, pricingReadinessRows]);
  const providerControlSummaries = useMemo(() => providerReadiness.map((provider) => {
    const routes = offlineCatalog.filter((route) => route.providerId === provider.providerId);
    const pricedRoutes = routes.filter((route) => changes.some((change) => (
      change.resourceType === "PRICING_POLICY"
      && change.resourceId === route.routeId
      && Number.isInteger(change.payload.customerCredits)
    ))).length;
    const snapshot = catalogSnapshots.filter((candidate) => candidate.providerId === provider.providerId).at(-1) ?? null;
    return { provider, routeCount: routes.length, pricedRoutes, snapshot };
  }), [changes, catalogSnapshots, offlineCatalog, providerReadiness]);
  const credentialProviderRows = useMemo(() => {
    const names = new Map(providerReadiness.map((provider) => [provider.providerId, provider.displayName]));
    for (const credential of credentials) if (!names.has(credential.providerId)) names.set(credential.providerId, credential.providerId);
    return [...names.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([providerId, displayName]) => ({
      providerId,
      displayName,
      credentials: credentials.filter((credential) => credential.providerId === providerId).sort((left, right) => right.version - left.version),
    }));
  }, [credentials, providerReadiness]);
  const pendingApprovals = changes.filter((change) => ["VALIDATED", "SIMULATED", "APPROVED"].includes(change.state));
  const pendingPricing = changes.filter((change) => change.resourceType === "PRICING_POLICY" && change.state !== "PUBLISHED");
  const openProviderCatalog = (providerId: string) => {
    setCatalogProvider(providerId);
    document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!import.meta.env.DEV) {
    return <div className="min-h-screen grid place-items-center bg-background">Local Admin V2 is unavailable outside development mode.</div>;
  }

  return (
    <main dir="ltr" className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-card/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h1 className="text-lg font-bold">FusionLab AI Gateway</h1></div>
            <p className="mt-1 text-xs text-muted-foreground">SaaS Control Plane · Signed local read-only session</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild><a href="/admin/advanced">Back to Admin</a></Button>
            <label className="relative hidden sm:block"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><input value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} placeholder="Search admin…" className="h-9 w-52 rounded-md border bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-6">
        <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border bg-card/80 p-3 shadow-sm lg:sticky lg:top-5">
            <div className="px-2 py-2 text-xs font-medium text-muted-foreground">FUSIONLAB ADMIN</div>
            <nav className="space-y-1" aria-label="Admin navigation">
              <AdminNavLink href="#overview" label="Overview" description="What needs attention" />
              <AdminNavLink href="#provider-setup" label="Providers" description="Set up KIE or OpenRouter" />
              <AdminNavLink href="#catalog" label="Models & pricing" description="Select models and prices" />
              <AdminNavLink href="#customers" label="Customers" description="Wallets and usage" />
              <AdminNavLink href="#operations" label="Operations" description="Generations and exceptions" />
              <AdminNavLink href="#governance" label="Governance" description="Reviews and audit history" />
            </nav>
            <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">Local development mode</span><br />You can review the system. Setup and activation appear after real admin access is connected.</div>
          </aside>
          <div className="space-y-6">
        <section id="overview" className="scroll-mt-6 overflow-hidden rounded-2xl border bg-gradient-to-l from-primary/[.13] via-card to-card p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div className="max-w-2xl"><Badge variant="outline" className="mb-3">OPERATIONS DASHBOARD</Badge><h2 className="text-2xl font-bold tracking-tight">Run your platform in three clear steps</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Add a provider, select the models you want to offer, then set your customer credit price. Nothing activates before review.</p></div><div className="flex flex-wrap gap-2"><Button onClick={() => document.getElementById("provider-setup")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Set up a provider</Button><Button variant="outline" onClick={() => document.getElementById("operations")?.scrollIntoView({ behavior: "smooth", block: "start" })}>View operations</Button></div></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3"><FriendlyStep number="1" title="Add a provider" description="KIE or OpenRouter with a secure API key" /><FriendlyStep number="2" title="Choose models" description="Enable only the models you want to offer" /><FriendlyStep number="3" title="Set pricing" description="Provider cost and your customer credit price" /></div>
        </section>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric icon={WalletCards} label="Provider treasury" value={overview?.treasury.treasury.confirmedRemainingAtomic ?? "—"} note={overview?.treasury.treasury.state ?? "Loading"} />
          <Metric icon={CircleDollarSign} label="Shadow balance" value={overview?.treasury.treasury.shadowAvailableAtomic ?? "—"} note="Provider credits" />
          <Metric icon={Activity} label="Reconciliation" value={overview ? `${overview.reconciliation.reconciliationRateBps / 100}%` : "—"} note={overview?.reconciliation.targetMet ? "Target met" : "Needs review"} />
          <Metric icon={TriangleAlert} label="Open holds" value={durable?.audit ? String(durable.audit.holds.length) : "—"} note={durable?.audit?.reconciliations.length ? `${durable.audit.reconciliations.length} reconciliation cases` : "No pending reconciliation"} />
        </div>

        <Card id="customers" className="scroll-mt-6">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><WalletCards className="h-4 w-4" />Customers</CardTitle><CardDescription>Redacted finance records from the durable engine. Open a customer to review wallet, operations, and journals without PII or balance edits.</CardDescription></CardHeader>
          <CardContent><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[760px] text-sm"><thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Customer</th><th>Available wallet</th><th>Held / spent</th><th>Operations</th><th>Last activity</th></tr></thead><tbody>{ownerRows.map((owner) => <tr key={owner.ownerId} className="border-b border-border/50"><td className="p-3"><button type="button" onClick={() => void openOwnerFinance(owner.ownerId)} className="max-w-56 truncate font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">{owner.ownerId}</button></td><td dir="ltr">{owner.wallet ? `${owner.wallet.availableCredits} credits` : "—"}</td><td className="text-xs" dir="ltr">{owner.wallet ? `held ${owner.wallet.heldCredits} · spent ${owner.wallet.spentCredits}` : "—"}</td><td><Badge variant={owner.activeOperationCount ? "secondary" : "outline"} dir="ltr">{owner.operationCount} total · {owner.activeOperationCount} active</Badge></td><td className="text-xs text-muted-foreground" dir="ltr">{new Date(owner.lastActivityAt).toLocaleString("en-US")}</td></tr>)}</tbody></table>{!ownerRows.length && <Empty label={durableOwners.length ? "No customers match this search." : "No durable wallets or operations yet."} />}</div></CardContent>
        </Card>

        <Card id="commerce" className="scroll-mt-6">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CircleDollarSign className="h-4 w-4" />Commerce & subscriptions</CardTitle><CardDescription>Protected administrative view of products, plans, and aggregate states. It never exposes payer identity, checkout links, or payment data.</CardDescription></CardHeader>
          <CardContent>{!commerce?.enabled ? <Empty label="Commerce read model is unavailable in this session." /> : <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs"><div><span className="font-medium" dir="ltr">{commerce.paymentProvider}</span><span className="ml-2 text-muted-foreground">· Payment sandbox only</span></div><Badge variant="outline" dir="ltr">FORMAL GATE: {commerce.reconciliation?.formalGateDecision ?? "HOLD"}</Badge></div>
            <div className="grid gap-3 md:grid-cols-3"><CommerceStateCard label="Checkouts" values={commerce.activity?.checkoutsByState ?? {}} /><CommerceStateCard label="Subscriptions" values={commerce.activity?.subscriptionsByState ?? {}} /><CommerceStateCard label="Invoices / reversals" values={{ ...(commerce.activity?.invoicesByState ?? {}), ...(commerce.activity?.reversalsByKind ?? {}) }} /></div>
            <div className="grid gap-4 xl:grid-cols-2"><section className="rounded-xl border"><div className="border-b bg-muted/30 px-4 py-3 text-sm font-medium">Credit products</div><div className="divide-y">{commerce.products?.map((product) => <div key={product.id} className="px-4 py-3 text-xs"><div className="flex items-start justify-between gap-3"><div><div className="font-medium" dir="ltr">{product.displayName}</div><div className="mt-1 text-muted-foreground" dir="ltr">{product.id} · v{product.version}</div></div><Badge variant="secondary" dir="ltr">{product.kind}</Badge></div><div className="mt-2 text-muted-foreground" dir="ltr">{product.grantedCredits} credits · {product.amountMinor} {product.currency}{product.planVersionId ? ` · ${product.planVersionId}` : ""}</div></div>) ?? <Empty label="No products yet." />}</div></section><section className="rounded-xl border"><div className="border-b bg-muted/30 px-4 py-3 text-sm font-medium">Subscription plan versions</div><div className="divide-y">{commerce.plans?.map((plan) => <div key={plan.id} className="px-4 py-3 text-xs"><div className="flex items-start justify-between gap-3"><div><div className="font-medium" dir="ltr">{plan.displayName}</div><div className="mt-1 text-muted-foreground" dir="ltr">{plan.id} · {plan.planKey} · v{plan.version}</div></div><Badge variant="secondary" dir="ltr">{plan.lifecycle}</Badge></div><div className="mt-2 text-muted-foreground" dir="ltr">{plan.amountMinor} {plan.currency} / {plan.interval} · {plan.creditsPerPeriod} credits · terms {plan.termsVersion}</div></div>) ?? <Empty label="No plans yet." />}</div></section></div>
            <p className="text-xs text-muted-foreground">This is a local commerce catalog and aggregate history only. Product edits, collection, webhooks, refunds, and chargebacks are not available from this view.</p>
          </div>}</CardContent>
        </Card>

        <Card id="operations" className="scroll-mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><BadgeCheck className="h-4 w-4" />Financial operations engine</CardTitle>
            <CardDescription>Audited engine view. Financial edits, pricing changes, and re-runs are not available from this screen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!durable?.enabled ? <Empty label="The durable runtime is unavailable in this session." /> : <>
              <div className="flex flex-wrap gap-2">
                {Object.entries(durable.audit?.operationCounts ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([state, count]) => <Badge key={state} variant={state === "RECONCILIATION_REQUIRED" ? "destructive" : "secondary"} dir="ltr">{state}: {count}</Badge>)}
                {!Object.keys(durable.audit?.operationCounts ?? {}).length && <span className="text-sm text-muted-foreground">No durable operations yet.</span>}
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <FinanceList title="Protected holds" empty="No open holds" rows={(durable.audit?.holds ?? []).map((hold) => ({ id: hold.operationId, primary: `${hold.heldCredits} / ${hold.quotedCredits} credits`, secondary: hold.state }))} onSelect={openOperationHistory} />
                <FinanceList title="Needs reconciliation" empty="No unresolved cases" rows={(durable.audit?.reconciliations ?? []).map((item) => ({ id: item.operationId, primary: item.operationId.slice(0, 12), secondary: `version ${item.stateVersion}` }))} alert onSelect={openOperationHistory} />
                <FinanceList title="Provider cost" empty="No final provider cost yet" rows={(durable.audit?.providerCostOutcomes ?? []).map((item) => ({ id: item.operationId, primary: `${item.providerCredits} credits`, secondary: `${item.providerId} · ${item.disposition}` }))} onSelect={openOperationHistory} />
              </div>
            </>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" />Generation history</CardTitle><CardDescription>One view for execution and finance. Open an operation to review evidence without exposing prompts, private asset URLs, or secrets.</CardDescription></CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[920px] text-sm"><thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Operation</th><th>State</th><th>Customer credits</th><th>Hold / settlement</th><th>Provider / cost</th><th>Last update</th></tr></thead><tbody>{operationRows.map((operation) => <tr key={operation.operationId} className="border-b border-border/50"><td className="p-3"><button type="button" onClick={() => void openOperationHistory(operation.operationId)} className="max-w-48 truncate text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">{operation.operationId}</button><div className="mt-1 text-[11px] text-muted-foreground" dir="ltr">{operation.ownerId}</div></td><td><Badge variant={operation.state === "RECONCILIATION_REQUIRED" ? "destructive" : "secondary"} dir="ltr">{operation.state}</Badge></td><td dir="ltr">{operation.customerCredits} credits</td><td className="text-xs" dir="ltr">{operation.reservation ? `${operation.reservation.state} · held ${operation.reservation.heldCredits} · settled ${operation.reservation.capturedCredits}` : "—"}</td><td className="text-xs" dir="ltr">{operation.providerId ?? "—"}{operation.providerCost ? ` · ${operation.providerCost.credits} (${operation.providerCost.disposition})` : ""}</td><td className="text-xs text-muted-foreground" dir="ltr">{new Date(operation.updatedAt).toLocaleString("en-US")}</td></tr>)}</tbody></table>{!operationRows.length && <Empty label={durableOperations.length ? "No operations match this search." : "No operations yet. When generation runs locally, its finance and provider state will appear here."} />}</div>
          </CardContent>
        </Card>

        <Card className={durableExceptions.length ? "scroll-mt-6 border-amber-500/40" : "scroll-mt-6"}>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TriangleAlert className="h-4 w-4" />Exception queue</CardTitle><CardDescription>No retry, refund, or release occurs automatically here. Every item opens its evidence before an authorized reconciler decision.</CardDescription></CardHeader>
          <CardContent><div className="grid gap-3 lg:grid-cols-2">{exceptionRows.map((exception) => <button type="button" key={`${exception.category}:${exception.operationId}`} onClick={() => void openOperationHistory(exception.operationId)} className={`rounded-xl border p-4 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${exception.severity === "CRITICAL" ? "border-destructive/50 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5"}`}><div className="flex items-center justify-between gap-3"><Badge variant={exception.severity === "CRITICAL" ? "destructive" : "secondary"} dir="ltr">{exception.severity}</Badge><div className="text-right"><div className="text-sm font-medium">{exceptionLabel[exception.category]}</div><div className="mt-0.5 text-[10px] text-muted-foreground" dir="ltr">{exception.category}</div></div></div><div className="mt-3 truncate text-xs" dir="ltr">{exception.operationId}</div><div className="mt-1 text-xs text-muted-foreground" dir="ltr">{exception.reason} · {exception.state}</div><div className="mt-2 text-[11px] text-muted-foreground" dir="ltr">{new Date(exception.updatedAt).toLocaleString("en-US")}</div></button>)}</div>{!exceptionRows.length && <Empty label={durableExceptions.length ? "No exceptions match this search." : "No exceptions are pending. This does not mean any provider or route is approved."} />}</CardContent>
        </Card>

        <section id="governance" className="scroll-mt-6 grid gap-4 lg:grid-cols-3">
          <ControlCenterCard
            icon={ClipboardCheck}
            title="Approval center"
            value={String(pendingApprovals.length)}
            description={pendingApprovals.length ? "Changes are waiting for an independent review" : "No approvals are pending"}
            tone={pendingApprovals.length ? "attention" : "normal"}
          />
          <ControlCenterCard
            icon={Network}
            title="Catalog sources"
            value={String(catalogSnapshots.length)}
            description={catalogSnapshots.length ? "Snapshots are saved with manifest and diff hashes" : "No reviewed snapshot has been imported yet"}
          />
          <ControlCenterCard
            icon={CircleDollarSign}
            title="Pricing under review"
            value={String(pendingPricing.length)}
            description={pendingPricing.length ? "None of these affects a live customer price before publishing" : "No unpublished pricing policy"}
          />
        </section>

        <Card id="command-center" className="scroll-mt-6">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" />Admin Command Center</CardTitle><CardDescription>Server-owned command policy defines who creates, reviews, and publishes each decision. The local development session is read-only.</CardDescription></CardHeader>
          <CardContent className="space-y-4"><div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">Financial edits, route publishing, and secret entry are unavailable because this is an <code>ADMIN_VIEWER</code> session. After AAL2 and real external membership are connected, the same server commands use idempotency and audit; the browser never gains an alternate write path.</div><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[1050px] text-sm"><thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Command</th><th>Maker</th><th>Validate / simulate</th><th>Approver</th><th>Publisher</th><th>Status</th></tr></thead><tbody>{workflowPolicies.map((policy) => <WorkflowPolicyRow key={policy.resourceType} policy={policy} />)}</tbody></table>{!workflowPolicies.length && <Empty label="Could not load command policy." />}</div></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4" />Approval Inbox</CardTitle><CardDescription>The server derives the next decision from RBAC policy; the browser cannot grant itself authority.</CardDescription></CardHeader>
          <CardContent><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[960px] text-sm"><thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Change set</th><th>Status</th><th>Next decision</th><th>Required role</th><th>Separation of duties</th><th>Last updated</th></tr></thead><tbody>{approvalInbox.map((item) => { const linked = changes.find((change) => change.id === item.changeId); return <tr key={item.changeId} className="border-b border-border/50"><td className="p-3"><button type="button" onClick={() => linked && setSelectedChange(linked)} className="max-w-64 truncate text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">{item.resourceType} · v{item.version}</button><div className="mt-1 max-w-64 truncate text-xs text-muted-foreground" dir="ltr">{item.resourceId}</div></td><td><Badge variant="secondary">{stageLabel[item.state]}</Badge></td><td><Badge variant="outline" dir="ltr">{item.nextAction}</Badge></td><td><div className="max-w-64 text-xs" dir="ltr">{item.requiredRoles.join(" · ")}</div></td><td className="text-xs text-muted-foreground">{item.makerCheckerRequired ? "Independent reviewer required" : "Defined by workflow policy"}</td><td className="text-xs text-muted-foreground" dir="ltr">{new Date(item.updatedAt).toLocaleString("en-US")}</td></tr>; })}</tbody></table>{!approvalInbox.length && <Empty label="No changes are waiting for a decision. Published and rejected versions remain in change and audit history." />}</div></CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card id="credentials" className="scroll-mt-6">
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" />Secret Manager</CardTitle><CardDescription>Keys are never displayed or returned by the engine. This browser sees only credential fingerprints and lifecycle state.</CardDescription></CardHeader>
            <CardContent className="space-y-4"><div className="grid gap-2 sm:grid-cols-4">{["1. Write-only", "2. Tested", "3. Independently activated", "4. Revoked"].map((step) => <div key={step} className="rounded-lg border bg-muted/20 p-2 text-center text-[10px] font-medium">{step}</div>)}</div><div className="space-y-3">{credentialProviderRows.map((provider) => <section key={provider.providerId} className="rounded-xl border p-3"><div className="flex items-start justify-between gap-3"><div><div className="font-medium">{provider.displayName}</div><p className="mt-1 text-[11px] text-muted-foreground">{provider.credentials.length ? "Redacted credential metadata. Previous versions are never silently replaced." : "No credential is stored for this provider."}</p></div><Badge variant={provider.credentials.some((credential) => credential.status === "ACTIVE") ? "secondary" : "outline"}>{provider.credentials.some((credential) => credential.status === "ACTIVE") ? "ACTIVE METADATA" : "NO ACTIVE CREDENTIAL"}</Badge></div>{provider.credentials.length ? <div className="mt-3 space-y-2">{provider.credentials.map((credential) => <div key={credential.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/45 p-2 text-xs"><div><span>v{credential.version} · {credential.fingerprint}</span><span className="mx-1 text-muted-foreground">·</span><span className="text-muted-foreground">{credential.accountId} / {credential.environment}</span></div><Badge variant={credential.status === "REVOKED" ? "destructive" : "secondary"}>{credential.status}</Badge></div>)}</div> : null}<Button type="button" size="sm" variant="outline" className="mt-3" disabled>AAL2 is required to manage credentials</Button></section>)}</div><p className="text-xs text-muted-foreground">This screen never accepts an API key and never contacts a provider. Once external identity is connected, server commands handle write, test, activate, and revoke with maker/checker separation.</p></CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Network className="h-4 w-4" />Route Catalog</CardTitle><CardDescription>Publisher → model → provider → account → endpoint, sourced from the engine catalog rather than browser lists.</CardDescription></CardHeader>
            <CardContent className="space-y-2">
              {catalogRoutes.length ? catalogRoutes.map((route) => <div key={route.routeId} className="rounded-md border p-3 text-xs">
                <div className="flex items-start justify-between gap-3"><div><div className="font-medium">{route.canonicalModelName}</div><div className="mt-1 text-muted-foreground">{route.publisherName} · {route.modelFamilyName}</div></div><Badge variant="secondary">{route.certification.scope}</Badge></div>
                <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2" dir="ltr"><span>{route.providerId} / {route.providerModelId}</span><span>{route.protocol} · {route.capability.mediaType} · max {route.costGuard.maximumNativeAtomic ?? "—"}</span><span className="truncate">endpoint {route.endpoint.reference}</span><span className="truncate">account {route.providerAccount.displayName}</span></div>
              </div>) : <Empty label="No routes are present in the catalog." />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" />Current boundaries</CardTitle><CardDescription>A clear statement of what this local screen can read and cannot do yet.</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>No provider API call or API key exists in this browser or screen.</p>
              <p>A local read-only session cannot publish a model or route, or change a price or credits.</p>
              <p>Catalogs, change sets, and audit history are durable locally. Write commands remain locked until a verified external Admin identity with real maker/checker roles is connected.</p>
            </CardContent>
          </Card>
        </div>

        <Card id="catalog" className="scroll-mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Network className="h-4 w-4" />Models & pricing</CardTitle>
            <CardDescription>Choose the models you offer and set customer pricing. Provider cost, your price, and activation are kept separate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm md:grid-cols-5">
              <WorkflowStep number="1" title="Import catalog" description="Verified provider source" />
              <WorkflowStep number="2" title="Review models" description="Capabilities and routes" />
              <WorkflowStep number="3" title="Set customer price" description="Your credit price and margin" />
              <WorkflowStep number="4" title="Review changes" description="Validate · Simulate · Approve" />
              <WorkflowStep number="5" title="Activate" description="Independent, controlled release" />
            </div>
            <section id="provider-setup" className="scroll-mt-6" aria-labelledby="provider-setup-title">
              <div className="mb-4"><Badge variant="secondary">STEP 1</Badge><h3 id="provider-setup-title" className="mt-2 text-lg font-semibold">Choose an AI provider</h3><p className="mt-1 text-sm text-muted-foreground">A provider is the company that runs generation. Start with one provider, then add another when you need it.</p></div>
              <div className="grid gap-4 lg:grid-cols-2">{providerControlSummaries.map(({ provider, routeCount, pricedRoutes, snapshot }) => <ProviderSetupCard key={provider.providerId} provider={provider} routeCount={routeCount} pricedRoutes={pricedRoutes} snapshot={snapshot} selected={catalogProvider === provider.providerId} onOpen={() => openProviderCatalog(provider.providerId)} />)}</div>
            </section>
            <section aria-labelledby="provider-status-title" className="rounded-2xl border bg-muted/20 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 id="provider-status-title" className="font-semibold">What happens after you choose a provider?</h3><p className="mt-1 text-sm text-muted-foreground">These background steps protect your credits. You do not need to manage their technical details.</p></div><Badge variant="outline">AUTOMATIC SAFEGUARDS</Badge></div>
              <div className="mt-5 grid gap-3 md:grid-cols-4"><FriendlyStep number="1" title="Store the key securely" description="The key is never shown again" /><FriendlyStep number="2" title="Import model catalog" description="No generation is started" /><FriendlyStep number="3" title="Price models" description="Set customer credits per model" /><FriendlyStep number="4" title="Activate after review" description="Nothing is released by mistake" /></div>
              <p className="mt-4 text-xs text-muted-foreground">You are in local read-only mode, so cards show status only. They do not request keys or contact providers.</p>
            </section>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {[{ id: "all", label: "All" }, ...providerControlSummaries.map(({ provider }) => ({ id: provider.providerId, label: provider.displayName }))].map((provider) => <Button key={provider.id} size="sm" variant={catalogProvider === provider.id ? "default" : "outline"} onClick={() => setCatalogProvider(provider.id)} dir="ltr">{provider.label}</Button>)}
              </div>
              <input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Search models or capabilities…" className="h-9 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
            <section aria-labelledby="reference-catalog-title" className="overflow-hidden rounded-xl border">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                <div><h3 id="reference-catalog-title" className="text-sm font-semibold">Reference catalog</h3><p className="mt-1 text-xs text-muted-foreground">Official-source models discovered for review. These are not provider routes, prices, or customer-visible offers.</p></div>
                <Badge variant="outline" dir="ltr">{referenceCatalogSnapshots.length} snapshots · {referenceCatalogModels.length} models</Badge>
              </div>
              <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="border-b bg-muted/20 text-left text-xs text-muted-foreground"><tr><th className="p-3">Model</th><th>Provider / family</th><th>Capabilities</th><th>Snapshot review</th><th>Availability</th></tr></thead><tbody>{referenceModelRows.map((model) => <tr key={`${model.snapshotId}:${model.id}`} className="border-b border-border/50 align-top"><td className="p-3"><div className="font-medium" dir="ltr">{model.displayName}</div><div className="mt-1 max-w-80 truncate text-xs text-muted-foreground" dir="ltr">{model.providerModelId}</div></td><td className="text-xs" dir="ltr">{model.providerId}<br /><span className="text-muted-foreground">{model.familyId}</span></td><td><div className="flex max-w-72 flex-wrap gap-1">{model.modalities.map((modality) => <Badge key={modality} variant="secondary" className="text-[10px]" dir="ltr">{modality}</Badge>)}</div><div className="mt-1 max-w-72 truncate text-[11px] text-muted-foreground" dir="ltr">{model.supportedParameters.length ? model.supportedParameters.join(" · ") : "Parameters are documented per source page"}</div></td><td><Badge variant={model.snapshotChangeState === "PUBLISHED" ? "secondary" : "outline"} dir="ltr">{model.snapshotChangeState ?? "UNREVIEWED"}</Badge><div className="mt-1 max-w-44 truncate text-[10px] text-muted-foreground" dir="ltr">{model.snapshotId}</div></td><td><Badge variant="outline" dir="ltr">REFERENCE ONLY</Badge><div className="mt-1 text-[11px] text-muted-foreground">No route · no price · no user access</div></td></tr>)}</tbody></table>{!referenceModelRows.length && <Empty label={referenceCatalogModels.length ? "No reference models match this filter." : "No official reference snapshot has been captured yet. Importing a source never activates a model."} />}</div>
            </section>
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[920px] text-sm"><thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Provider / model</th><th>Capability</th><th>Provider cost</th><th>Customer price</th><th>Availability</th><th>Change set</th></tr></thead>
                <tbody>{catalogRows.map((route) => {
                  const relevant = changes.filter((change) => change.resourceId.includes(route.routeId) || (change.resourceType === "CATALOG_SNAPSHOT" && change.payload.providerId === route.providerId))[0];
                  const pricing = changes.find((change) => change.resourceType === "PRICING_POLICY" && change.resourceId === route.routeId);
                  return <tr key={route.routeId} className="border-b border-border/50 align-top"><td className="p-3"><button type="button" onClick={() => setSelectedCatalogRoute(route)} className="text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">{route.model}</button><div className="mt-1 text-xs text-muted-foreground" dir="ltr">{route.family} · {route.providerId}</div></td><td><Badge variant="secondary" dir="ltr">{route.mediaType} · {route.protocol}</Badge></td><td className="text-xs" dir="ltr">{route.providerCost.unit} × {route.providerCost.scale}<br /><span className="text-muted-foreground">{route.providerCost.version}</span></td><td><PriceCell change={pricing} /></td><td><Badge variant="outline" dir="ltr">Snapshot · Review only</Badge><div className="mt-1 text-[11px] text-muted-foreground" dir="ltr">{route.certification}</div></td><td>{relevant ? <Badge variant={relevant.state === "REJECTED" ? "destructive" : "secondary"}>{stageLabel[relevant.state]}</Badge> : <span className="text-xs text-muted-foreground">Awaiting change set</span>}</td></tr>;
                })}</tbody>
              </table>
              {!catalogRows.length && <Empty label={catalogProvider === "all" ? "No signed routes yet. Models never appear before a verified catalog snapshot." : "No signed catalog exists for this provider yet. Review its documentation, then import a snapshot for review."} />}
            </div>
            <p className="text-xs text-muted-foreground">Test fixtures never appear as KIE or OpenRouter models. Final pricing and capabilities are proven at endpoint level through a verified snapshot, not from a model name alone.</p>
          </CardContent>
        </Card>

        <Card id="pricing-readiness" className="scroll-mt-6">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4" />Model pricing readiness</CardTitle><CardDescription>A decision list for every model and route. A model being present does not mean it is available to customers.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><ReadinessMetric label="Needs catalog snapshot" value={pricingReadinessCounts.NEEDS_SNAPSHOT} tone="attention" active={pricingReadinessFilter === "NEEDS_SNAPSHOT"} onClick={() => setPricingReadinessFilter((current) => current === "NEEDS_SNAPSHOT" ? "all" : "NEEDS_SNAPSHOT")} /><ReadinessMetric label="Needs customer price" value={pricingReadinessCounts.NEEDS_PRICE_POLICY} tone="attention" active={pricingReadinessFilter === "NEEDS_PRICE_POLICY"} onClick={() => setPricingReadinessFilter((current) => current === "NEEDS_PRICE_POLICY" ? "all" : "NEEDS_PRICE_POLICY")} /><ReadinessMetric label="Under review" value={pricingReadinessCounts.PRICING_IN_REVIEW} active={pricingReadinessFilter === "PRICING_IN_REVIEW"} onClick={() => setPricingReadinessFilter((current) => current === "PRICING_IN_REVIEW" ? "all" : "PRICING_IN_REVIEW")} /><ReadinessMetric label="Release gated" value={pricingReadinessCounts.RELEASE_GATED} active={pricingReadinessFilter === "RELEASE_GATED"} onClick={() => setPricingReadinessFilter((current) => current === "RELEASE_GATED" ? "all" : "RELEASE_GATED")} /></div>
            <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{pricingReadinessFilter === "all" ? "All models in the current filter" : "Decision filter is active"}</p>{pricingReadinessFilter !== "all" && <Button size="sm" variant="ghost" onClick={() => setPricingReadinessFilter("all")}>Show all</Button>}</div>
            <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[900px] text-sm"><thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Model / route</th><th>Source</th><th>Customer price</th><th>Decision state</th><th>Next action</th></tr></thead><tbody>{filteredPricingReadinessRows.map((row) => <PricingReadinessRow key={row.route.routeId} {...row} onOpenRoute={() => setSelectedCatalogRoute(row.route)} onOpenChange={() => row.pricing && setSelectedChange(row.pricing)} />)}</tbody></table>{!filteredPricingReadinessRows.length && <Empty label="No models have this state in the current filter." />}</div>
            <p className="text-xs text-muted-foreground">Even a route with a published price remains blocked until release requirements are complete. This view never sends a request to an external provider.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CircleDollarSign className="h-4 w-4" />Pricing workbench</CardTitle><CardDescription>Route readiness report that separates provider cost, customer price, and margin policy. It never turns KIE or OpenRouter units into fictional profit.</CardDescription></CardHeader>
          <CardContent><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[1050px] text-sm"><thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Route</th><th>Provider published rate</th><th>Customer price version</th><th>Margin policy</th><th>Evidence</th><th>Next action</th></tr></thead><tbody>{pricingWorkbenchRows.map(({ route, pricing, snapshot }) => <PricingWorkbenchRow key={route.routeId} route={route} pricing={pricing} snapshot={snapshot} onReview={() => setSelectedCatalogRoute(route)} onChangeReview={() => pricing && setSelectedChange(pricing)} />)}</tbody></table>{!pricingWorkbenchRows.length && <Empty label="No routes match this filter. Pricing cannot start without a clear route." />}</div><p className="mt-3 text-xs text-muted-foreground">Actual profit is calculated only after actual provider cost, funding, FX, fees, and delivery cost are proven. This screen does not publish or create a quote.</p></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Network className="h-4 w-4" />Provider readiness</CardTitle>
            <CardDescription>Providers, models, routes, credentials, and catalog evidence remain separate. This is not a paste-key or instant-activation screen.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            {providerReadiness.map((provider) => <ProviderReadinessCard key={provider.providerId} provider={provider} onOpenCatalog={() => openProviderCatalog(provider.providerId)} />)}
          </CardContent>
        </Card>

        <Card className="border-amber-500/30">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><LockKeyhole className="h-4 w-4" />Route release gates</CardTitle><CardDescription>Publishing fails closed: a model or API key alone never makes a route visible or executable.</CardDescription></CardHeader>
          <CardContent><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[960px] text-sm"><thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">Route / model</th><th>Provider</th><th>Certification</th><th>Decision</th><th>Blockers</th></tr></thead><tbody>{routeReleaseGates.map((gate) => <tr key={gate.routeId} className="border-b border-border/50 align-top"><td className="p-3"><div className="max-w-64 truncate font-medium">{gate.routeId}</div><div className="mt-1 max-w-64 truncate text-xs text-muted-foreground">{gate.model}</div></td><td>{gate.providerId}</td><td className="text-xs">{gate.lifecycle} · {gate.scope}</td><td><Badge variant="destructive">{gate.releaseDecision}</Badge></td><td><div className="flex max-w-96 flex-wrap gap-1">{gate.blockers.map((blocker) => <Badge key={blocker} variant="outline" className="text-[10px]">{releaseGateLabel[blocker]}</Badge>)}</div></td></tr>)}</tbody></table>{!routeReleaseGates.length && <Empty label="No routes are registered for release evaluation." />}</div><p className="mt-3 text-xs text-muted-foreground">Clearing a blocker requires separate evidence and operational policy. This screen has no bypass and makes no external connection.</p></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4" />Catalog and pricing evidence</CardTitle>
            <CardDescription>Every decision begins with a time-bound catalog source, then a reviewable change set. Model names and prices alone are never operational truth.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-xl border">
              <div className="border-b bg-muted/30 px-4 py-3 text-sm font-medium">Catalog Snapshots</div>
              <div className="divide-y">
                {catalogSnapshots.length ? catalogSnapshots.map((snapshot) => <div key={snapshot.snapshotId} className="space-y-1 px-4 py-3 text-xs">
                  <div className="flex items-center justify-between gap-3"><span className="font-medium" dir="ltr">{snapshot.providerId}</span><Badge variant="secondary" dir="ltr">{snapshot.scope}</Badge></div>
                  <div className="text-muted-foreground">{snapshot.sourceLabel} · {new Date(snapshot.observedAt).toLocaleString("en-US")}</div>
                  <div className="truncate text-[11px] text-muted-foreground" dir="ltr">manifest {snapshot.manifestSha256} · diff {snapshot.diffSha256}</div>
                </div>) : <Empty label="No snapshot is stored yet. Importing requires a verified source before pricing." />}
              </div>
            </div>
            <div className="rounded-xl border">
              <div className="border-b bg-muted/30 px-4 py-3 text-sm font-medium">Pricing Change Sets</div>
              <div className="divide-y">
                {changeRows.filter((change) => change.resourceType === "PRICING_POLICY").length ? changeRows.filter((change) => change.resourceType === "PRICING_POLICY").map((change) => <PricingChangeRow key={change.id} change={change} />) : <Empty label={changes.some((change) => change.resourceType === "PRICING_POLICY") ? "No pricing policy matches the search." : "No pricing policy exists yet. Live customer price remains undefined."} />}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Change history</CardTitle><CardDescription>Controlled workflow: Draft → Validate → Simulate → Approve → Publish</CardDescription></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground"><tr><th className="py-3">Resource</th><th>Version</th><th>Status</th><th>Maker</th><th>Reason</th></tr></thead>
                <tbody>{changeRows.map((change) => <tr key={change.id} className="border-b border-border/50">
                  <td className="py-3"><div className="font-medium" dir="ltr">{change.resourceType}</div><div className="max-w-[300px] truncate text-xs text-muted-foreground" dir="ltr">{change.resourceId}</div></td>
                  <td dir="ltr">v{change.version}</td><td><button type="button" className="rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedChange(change)} aria-label={`View ${change.resourceType} details`}><Badge variant={change.state === "PUBLISHED" ? "default" : "secondary"}>{stageLabel[change.state]}</Badge></button></td><td className="text-xs" dir="ltr">{change.makerId}</td><td className="text-xs" dir="ltr">{change.reasonCode}</td>
                </tr>)}</tbody>
              </table>
              {!changeRows.length && <Empty label={changes.length ? "No changes match the search." : "No changes yet."} />}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-base">Immutable audit history</CardTitle><CardDescription>Append-only evidence for every admin command. The UI cannot alter or delete a record.</CardDescription></div><Badge variant={audit.chainValid ? "secondary" : "destructive"}>{audit.chainValid ? "chain verified" : "chain invalid"}</Badge></div></CardHeader>
          <CardContent><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[760px] text-sm"><thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="p-3">#</th><th>Action</th><th>Actor</th><th>Resource</th><th>Time</th><th>Evidence</th></tr></thead><tbody>{auditRows.map((record) => { const linked = changes.find((change) => change.id === record.versionId); return <tr key={record.id} className="border-b border-border/50"><td className="p-3">{record.sequence}</td><td className="font-medium">{record.action}</td><td className="text-xs">{record.actorId}</td><td><div className="text-xs">{record.resourceType}</div><div className="max-w-52 truncate text-[11px] text-muted-foreground">{record.resourceId}</div></td><td className="text-xs text-muted-foreground">{new Date(record.occurredAt).toLocaleString("en-US")}</td><td>{linked ? <button type="button" onClick={() => setSelectedChange(linked)} className="max-w-32 truncate text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{record.recordHash}</button> : <span className="inline-block max-w-32 truncate text-xs text-muted-foreground">{record.recordHash}</span>}</td></tr>; })}</tbody></table>{!auditRows.length && <Empty label={audit.records.length ? "No audit records match the search." : "No audit records yet."} />}</div></CardContent>
        </Card>
          </div>
        </div>
      </section>
      <Dialog open={historyLoading || !!operationHistory} onOpenChange={(open) => { if (!open) { setOperationHistory(null); setHistoryLoading(false); } }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" dir="ltr">
          <DialogHeader><DialogTitle>Operation financial history</DialogTitle><DialogDescription>Evidence is read-only; this view cannot edit or restart an operation.</DialogDescription></DialogHeader>
          {historyLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading evidence…</p>}
          {operationHistory && <div className="space-y-5 text-sm">
            <div className="rounded-xl border p-3"><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{operationHistory.operation.id}</span><Badge>{operationHistory.operation.state}</Badge></div><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">owner {operationHistory.operation.owner_id} · version {operationHistory.operation.state_version} · quoted {operationHistory.operation.customer_credits}</p><Button size="sm" variant="outline" onClick={() => { setOperationHistory(null); void openOwnerFinance(operationHistory.operation.owner_id); }}>View owner finance history</Button></div></div>
            <HistorySection title="State timeline" empty="No events"><div className="space-y-2">{operationHistory.events.map((event) => <div key={`${event.sequence}:${event.event_name}`} className="flex items-center justify-between rounded-md bg-muted/50 p-2 text-xs"><span>{event.sequence} · {event.state}</span><span className="text-muted-foreground">{event.event_name}</span></div>)}</div></HistorySection>
            <div className="grid gap-3 md:grid-cols-2"><HistorySection title="Reservation" empty="No reservation"><p className="text-xs">{operationHistory.reservation ? `${operationHistory.reservation.state} · held ${operationHistory.reservation.held_credits} · captured ${operationHistory.reservation.captured_credits} · released ${operationHistory.reservation.released_credits}` : ""}</p></HistorySection><HistorySection title="Provider cost" empty="No cost outcome"><p className="text-xs">{operationHistory.providerCostOutcome ? `${operationHistory.providerCostOutcome.provider_id} · ${operationHistory.providerCostOutcome.provider_credits} · ${operationHistory.providerCostOutcome.disposition}` : ""}</p></HistorySection></div>
            <HistorySection title="Provider attempts" empty="No attempts"><div className="space-y-2">{operationHistory.attempts.map((attempt) => <div key={String(attempt.attempt_number)} className="rounded-md bg-muted/50 p-2 text-xs">#{attempt.attempt_number} · {attempt.provider_id} · {attempt.state}{attempt.charge_status ? ` · ${attempt.charge_status}` : ""}{attempt.actual_provider_credits !== null && attempt.actual_provider_credits !== undefined ? ` · cost ${attempt.actual_provider_credits}` : ""}</div>)}</div></HistorySection>
            <HistorySection title="Ledger journals" empty="No financial journals"><div className="space-y-2">{operationHistory.journals.map((journal) => <div key={journal.id} className="rounded-md bg-muted/50 p-2 text-xs"><div className="font-medium">{journal.kind} · {journal.reason_code}</div><div className="mt-1 text-muted-foreground">{journal.entries.map((entry) => `${entry.accountId}: ${entry.amount}`).join(" | ")}</div></div>)}</div></HistorySection>
          </div>}
        </DialogContent>
      </Dialog>
      <Dialog open={ownerLoading || !!ownerFinance} onOpenChange={(open) => { if (!open) { setOwnerFinance(null); setOwnerLoading(false); } }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" dir="ltr">
          <DialogHeader><DialogTitle>User / Owner Finance 360</DialogTitle><DialogDescription>Redacted finance view: no personal data and no balance edits from this screen.</DialogDescription></DialogHeader>
          {ownerLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading finance history…</p>}
          {ownerFinance && <OwnerFinanceDetail profile={ownerFinance} onOperation={(operationId) => { setOwnerFinance(null); void openOperationHistory(operationId); }} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!selectedChange} onOpenChange={(open) => { if (!open) setSelectedChange(null); }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" dir="ltr">
          {selectedChange && <ChangeSetDetail change={selectedChange} audit={audit} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!selectedCatalogRoute} onOpenChange={(open) => { if (!open) setSelectedCatalogRoute(null); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" dir="ltr">
          {selectedCatalogRoute && <CatalogRouteDetail route={selectedCatalogRoute} composition={catalogRoutes.find((candidate) => candidate.routeId === selectedCatalogRoute.routeId)} pricing={changes.find((change) => change.resourceType === "PRICING_POLICY" && change.resourceId === selectedCatalogRoute.routeId)} snapshot={catalogSnapshots.find((candidate) => candidate.snapshotId === selectedCatalogRoute.snapshotId) ?? null} releaseGate={routeReleaseGates.find((candidate) => candidate.routeId === selectedCatalogRoute.routeId) ?? null} />}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Metric({ icon: Icon, label, value, note }: { icon: typeof Activity; label: string; value: string; note: string }) {
  return <Card><CardContent className="flex items-center gap-4 p-5"><div className="rounded-xl bg-primary/10 p-3 text-primary"><Icon className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold" dir="ltr">{value}</p><p className="text-[11px] text-muted-foreground">{note}</p></div></CardContent></Card>;
}

function AdminNavLink({ href, label, description }: { href: string; label: string; description: string }) {
  return <a href={href} className="block rounded-xl px-3 py-2.5 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="text-sm font-medium">{label}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{description}</div></a>;
}

function FriendlyStep({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="rounded-xl border bg-background/60 p-3"><div className="flex items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{number}</span><p className="text-sm font-medium">{title}</p></div><p className="ml-8 mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>;
}

function ProviderSetupCard({ provider, routeCount, pricedRoutes, snapshot, selected, onOpen }: { provider: AdminProviderReadiness; routeCount: number; pricedRoutes: number; snapshot: CatalogSnapshot | null; selected: boolean; onOpen: () => void }) {
  const configured = Boolean(snapshot);
  return <article className={`rounded-2xl border bg-card p-5 shadow-sm transition ${selected ? "border-primary ring-1 ring-primary/30" : "hover:border-primary/50"}`}>
    <div className="flex items-start justify-between gap-3"><div><h4 className="text-lg font-semibold" dir="ltr">{provider.displayName}</h4><p className="mt-1 text-sm text-muted-foreground">{provider.providerId === "kie" ? "Image, video, audio, and text generation" : "Unified access to multiple AI models"}</p></div><Badge variant={configured ? "secondary" : "outline"}>{configured ? "Ready for review" : "Not configured"}</Badge></div>
    <div className="mt-5 space-y-2 text-sm"><SetupCheck complete={provider.credentialMetadataCount > 0} label="API key stored securely" /><SetupCheck complete={routeCount > 0} label={routeCount ? `${routeCount} models imported` : "No models imported yet"} /><SetupCheck complete={pricedRoutes > 0} label={pricedRoutes ? `${pricedRoutes} models priced` : "No platform prices set"} /></div>
    <div className="mt-5 flex flex-wrap gap-2"><Button size="sm" onClick={onOpen}>{configured ? "Manage models" : "Start setup"}</Button><a className="inline-flex h-9 items-center rounded-md px-3 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={provider.documentationUrl} target="_blank" rel="noreferrer">Provider docs</a></div>
    <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">{configured ? "Models remain hidden from customers until pricing and activation are reviewed." : "When administrator access is connected, add the key, verify it, then import the provider catalog."}</p>
  </article>;
}

function SetupCheck({ complete, label }: { complete: boolean; label: string }) {
  return <div className="flex items-center gap-2"><span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${complete ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{complete ? "✓" : "○"}</span><span className={complete ? "text-foreground" : "text-muted-foreground"}>{label}</span></div>;
}

function ControlCenterCard({ icon: Icon, title, value, description, tone = "normal" }: { icon: typeof Activity; title: string; value: string; description: string; tone?: "normal" | "attention" }) {
  return <Card className={tone === "attention" ? "border-amber-500/40" : ""}><CardContent className="flex items-center gap-4 p-5"><div className={`rounded-xl p-3 ${tone === "attention" ? "bg-amber-500/10 text-amber-600 dark:text-amber-300" : "bg-primary/10 text-primary"}`}><Icon className="h-5 w-5" /></div><div><p className="text-xs text-muted-foreground">{title}</p><p className="mt-1 text-xl font-bold" dir="ltr">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{description}</p></div></CardContent></Card>;
}

function PriceCell({ change }: { change: AdminChange | undefined }) {
  const customerCredits = change?.payload.customerCredits;
  const margin = change?.payload.hardFloorMarginBps;
  if (!change || !Number.isInteger(customerCredits)) return <><span className="text-xs text-amber-600 dark:text-amber-300">Not configured</span><div className="mt-1 text-[11px] text-muted-foreground">Requires PRICING_POLICY</div></>;
  return <div className="text-xs"><span className="font-medium" dir="ltr">{String(customerCredits)} credits</span><div className="mt-1 text-[11px] text-muted-foreground" dir="ltr">floor {Number.isInteger(margin) ? `${Number(margin) / 100}%` : "—"} · {stageLabel[change.state]}</div></div>;
}

function PricingChangeRow({ change }: { change: AdminChange }) {
  const credits = change.payload.customerCredits;
  const margin = change.payload.hardFloorMarginBps;
  return <div className="space-y-1 px-4 py-3 text-xs"><div className="flex items-center justify-between gap-3"><span className="max-w-[65%] truncate font-medium" dir="ltr">{change.resourceId}</span><Badge variant={change.state === "REJECTED" ? "destructive" : "secondary"}>{stageLabel[change.state]}</Badge></div><div className="text-muted-foreground" dir="ltr">{Number.isInteger(credits) ? `${String(credits)} customer credits` : "pricing payload incomplete"}{Number.isInteger(margin) ? ` · ${Number(margin) / 100}% floor` : ""}</div><div className="text-[11px] text-muted-foreground" dir="ltr">maker {change.makerId} · {change.reasonCode}</div></div>;
}

function PricingWorkbenchRow({ route, pricing, snapshot, onReview, onChangeReview }: {
  route: OfflineProviderCatalogRoute;
  pricing: AdminChange | undefined;
  snapshot: CatalogSnapshot | null;
  onReview: () => void;
  onChangeReview: () => void;
}) {
  const credits = pricing?.payload.customerCredits;
  const margin = pricing?.payload.hardFloorMarginBps;
  const priceReady = Number.isInteger(credits) && Number(credits) > 0;
  const nextStep = !snapshot ? "Import a snapshot into Draft"
    : !priceReady ? "Create a pricing policy"
      : pricing?.state === "PUBLISHED" ? "Route remains locked until independent certification"
        : pricing?.state === "APPROVED" ? "Publish through an authorized command"
          : "Complete maker/checker review";
  return <tr className="border-b border-border/50 align-top">
    <td className="p-3"><button type="button" onClick={onReview} className="max-w-52 truncate text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="ltr">{route.routeId}</button><div className="mt-1 text-xs text-muted-foreground" dir="ltr">{route.model} · {route.providerId}</div></td>
    <td className="p-3 text-xs" dir="ltr">{route.providerCost.unit} × {route.providerCost.scale}<div className="mt-1 text-[11px] text-muted-foreground">{route.providerCost.version}</div></td>
    <td className="p-3">{priceReady ? <button type="button" onClick={onChangeReview} className="text-left text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{String(credits)} credits · {stageLabel[pricing!.state]}</button> : <span className="text-xs text-amber-600 dark:text-amber-300">Not configured</span>}</td>
    <td className="p-3 text-xs" dir="ltr">{Number.isInteger(margin) ? `hard floor ${Number(margin) / 100}%` : "not configured"}<div className="mt-1 text-[11px] text-muted-foreground">actual margin: pending COGS</div></td>
    <td className="p-3">{snapshot ? <div className="text-xs"><Badge variant="secondary">Snapshot saved</Badge><div className="mt-1 max-w-36 truncate text-[10px] text-muted-foreground">{snapshot.manifestSha256}</div></div> : <span className="text-xs text-amber-600 dark:text-amber-300">No snapshot</span>}</td>
    <td className="p-3 text-xs text-muted-foreground">{nextStep}</td>
  </tr>;
}

function ReadinessMetric({ label, value, tone = "normal", active = false, onClick }: { label: string; value: number; tone?: "normal" | "attention"; active?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-xl border p-3 text-right transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary bg-primary/[.05] ring-1 ring-primary/20" : tone === "attention" && value ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/20"}`}><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-1 text-2xl font-bold ${tone === "attention" && value ? "text-amber-600 dark:text-amber-300" : ""}`} dir="ltr">{value}</p></button>;
}

function CommerceStateCard({ label, values }: { label: string; values: Record<string, number> }) {
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  return <div className="rounded-xl border bg-muted/20 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{label}</span><span className="text-lg font-bold" dir="ltr">{total}</span></div><div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(values).length ? Object.entries(values).map(([state, count]) => <Badge key={state} variant="outline" className="text-[10px]" dir="ltr">{state}: {count}</Badge>) : <span className="text-[11px] text-muted-foreground">No events yet</span>}</div></div>;
}

function WorkflowPolicyRow({ policy }: { policy: AdminWorkflowPolicy }) {
  return <tr className="border-b border-border/50 align-top"><td className="p-3 font-medium" dir="ltr">{policy.resourceType}</td><td className="p-3"><RoleBadges roles={policy.makerRoles} /></td><td className="p-3"><RoleBadges roles={[...policy.validatorRoles, ...policy.simulatorRoles]} /></td><td className="p-3"><RoleBadges roles={policy.approverRoles} /></td><td className="p-3"><RoleBadges roles={policy.publisherRoles} /></td><td className="p-3"><Badge variant="outline" dir="ltr">AAL2 + audit required</Badge></td></tr>;
}

function RoleBadges({ roles }: { roles: string[] }) {
  return <div className="flex max-w-52 flex-wrap gap-1">{roles.map((role) => <Badge key={role} variant="secondary" className="text-[10px]" dir="ltr">{role}</Badge>)}</div>;
}

function PricingReadinessRow({ route, pricing, snapshot, gate, status, nextStep, onOpenRoute, onOpenChange }: {
  route: OfflineProviderCatalogRoute;
  pricing: AdminChange | undefined;
  snapshot: CatalogSnapshot | null;
  gate: AdminRouteReleaseGate | null;
  status: string;
  nextStep: string;
  onOpenRoute: () => void;
  onOpenChange: () => void;
}) {
  const statusLabel: Record<string, string> = { NEEDS_SNAPSHOT: "Snapshot required", NEEDS_PRICE_POLICY: "Price required", PRICING_IN_REVIEW: "Under review", RELEASE_GATED: "Release gated" };
  const statusVariant = status === "NEEDS_SNAPSHOT" || status === "NEEDS_PRICE_POLICY" ? "destructive" : "secondary";
  const credits = pricing?.payload.customerCredits;
  return <tr className="border-b border-border/50 align-top"><td className="p-3"><button type="button" onClick={onOpenRoute} className="max-w-72 truncate text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{route.model}</button><div className="mt-1 max-w-72 truncate text-[11px] text-muted-foreground">{route.routeId}</div></td><td className="p-3 text-xs">{snapshot ? <span className="text-emerald-700 dark:text-emerald-300">Verified snapshot</span> : <span className="text-amber-600 dark:text-amber-300">Unverified</span>}<div className="mt-1 text-[11px] text-muted-foreground">{route.providerId}</div></td><td className="p-3 text-xs">{Number.isInteger(credits) ? <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={onOpenChange}>{String(credits)} credits · {stageLabel[pricing!.state]}</button> : <span className="text-muted-foreground">Not configured</span>}</td><td className="p-3"><Badge variant={statusVariant}>{statusLabel[status]}</Badge>{gate && <div className="mt-1 text-[10px] text-muted-foreground">{gate.blockers.length} release blockers</div>}</td><td className="p-3 text-xs text-muted-foreground">{nextStep}</td></tr>;
}

function ProviderStat({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className="rounded-lg bg-muted/50 p-2"><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className={`mt-1 truncate text-xs font-semibold ${emphasis ? "text-amber-600 dark:text-amber-300" : ""}`} dir="ltr">{value}</dd></div>;
}

function ProviderReadinessCard({ provider, onOpenCatalog }: { provider: AdminProviderReadiness; onOpenCatalog: () => void }) {
  const credentialState = provider.credentialStatuses.length ? provider.credentialStatuses.join(" · ") : "No credential added";
  return <section className="rounded-xl border p-4">
    <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{provider.displayName}</h3><p className="mt-1 text-xs text-muted-foreground">Provider is registered for onboarding, but no approved catalog, account, or live connection exists yet.</p></div><Badge variant="outline">CATALOG NOT IMPORTED</Badge></div>
    <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3"><div><dt className="text-muted-foreground">Snapshot routes</dt><dd className="mt-1 font-medium">{provider.routeCount}</dd></div><div><dt className="text-muted-foreground">Catalog snapshots</dt><dd className="mt-1 font-medium">{provider.snapshotCount}</dd></div><div><dt className="text-muted-foreground">Credential metadata</dt><dd className="mt-1 truncate font-medium">{provider.credentialMetadataCount ? credentialState : "No credential added"}</dd></div></dl>
    <div className="mt-4 flex flex-wrap gap-1.5">{provider.capabilities.map((capability) => <Badge key={capability} variant="outline" className="text-[10px]" dir="ltr">{capability}</Badge>)}</div>
    <div className="mt-4 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">Safe next step: </span>Import a verified snapshot into Draft, review the diff, then create and review a pricing policy. This screen cannot add a secret or activate a route.</div>
    <div className="mt-3 flex flex-wrap gap-2"><a className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted" href={provider.documentationUrl} target="_blank" rel="noreferrer">Documentation</a><a className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted" href={provider.catalogUrl} target="_blank" rel="noreferrer">Catalog</a><a className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-muted" href={provider.pricingUrl} target="_blank" rel="noreferrer">Pricing</a><Button type="button" size="sm" variant="outline" onClick={onOpenCatalog}>View import status</Button></div>
  </section>;
}

function ChangeSetDetail({ change, audit }: { change: AdminChange; audit: { chainValid: boolean; records: AdminAuditRecord[] } }) {
  const records = audit.records.filter((record) => record.versionId === change.id);
  const reviewers = [
    { label: "Maker", actor: change.makerId, evidence: null },
    { label: "Validator", actor: change.validatorId, evidence: change.validationEvidenceHash },
    { label: "Simulator", actor: change.simulatorId, evidence: change.simulationEvidenceHash },
    { label: "Approver", actor: change.approverId, evidence: change.approvalEvidenceHash },
    { label: "Publisher", actor: change.publisherId, evidence: null },
  ];
  return <><DialogHeader><DialogTitle>Change set details</DialogTitle><DialogDescription>Immutable version with its associated review and audit trail.</DialogDescription></DialogHeader>
    <div className="space-y-5 pt-2 text-sm">
      <div className="rounded-xl border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-semibold">{change.resourceType} · v{change.version}</div><div className="mt-1 text-xs text-muted-foreground">{change.resourceId}</div></div><Badge variant={change.state === "PUBLISHED" ? "default" : change.state === "REJECTED" ? "destructive" : "secondary"}>{stageLabel[change.state]}</Badge></div><div className="mt-3 text-xs text-muted-foreground">Reason: {change.reasonCode} · Last updated: {new Date(change.updatedAt).toLocaleString("en-US")}</div></div>
      <section className="rounded-xl border p-3"><h3 className="mb-3 font-medium">Maker / checker trail</h3><div className="space-y-2">{reviewers.map((reviewer, index) => <div key={reviewer.label} className="flex items-center gap-3 rounded-lg bg-muted/45 p-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-background text-xs">{index + 1}</span><div className="min-w-0 flex-1"><div className="text-xs font-medium">{reviewer.label}</div><div className="truncate text-[11px] text-muted-foreground">{reviewer.actor ?? "awaiting independent reviewer"}</div></div>{reviewer.evidence && <span className="max-w-28 truncate text-[10px] text-muted-foreground">{reviewer.evidence}</span>}</div>)}</div></section>
      <section className="rounded-xl border p-3"><h3 className="mb-3 font-medium">Reviewed payload</h3><pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-5 text-muted-foreground">{JSON.stringify(change.payload, null, 2)}</pre></section>
      <section className="rounded-xl border p-3"><div className="mb-3 flex items-center justify-between"><h3 className="font-medium">Related audit history</h3><Badge variant={audit.chainValid ? "secondary" : "destructive"}>{audit.chainValid ? "chain verified" : "chain invalid"}</Badge></div>{records.length ? <div className="space-y-2">{records.map((record) => <div key={record.id} className="rounded-lg bg-muted/45 p-2 text-xs"><div className="flex justify-between gap-3"><span>#{record.sequence} · {record.action}</span><span className="text-muted-foreground">{record.actorId}</span></div><div className="mt-1 truncate text-[10px] text-muted-foreground">{record.recordHash}</div></div>)}</div> : <p className="text-xs text-muted-foreground">No audit activity is linked yet.</p>}</section>
    </div></>;
}

function OwnerFinanceDetail({ profile, onOperation }: { profile: DurableOwnerFinance; onOperation: (operationId: string) => void }) {
  const wallet = profile.wallet;
  return <div className="space-y-5 pt-2 text-sm"><section className="rounded-xl border p-4"><div className="text-xs text-muted-foreground">Owner reference</div><div className="mt-1 font-semibold">{profile.ownerId}</div>{wallet ? <div className="mt-4 grid gap-3 sm:grid-cols-3"><WalletAmount label="Available" amount={wallet.availableCredits} /><WalletAmount label="Held" amount={wallet.heldCredits} /><WalletAmount label="Settled" amount={wallet.spentCredits} /></div> : <p className="mt-4 text-xs text-muted-foreground">No wallet exists yet, but historical operations do.</p>}</section>
    <section className="rounded-xl border p-4"><h3 className="mb-3 font-medium">Activity summary</h3><div className="flex flex-wrap gap-2">{Object.entries(profile.operationCounts).map(([state, count]) => <Badge key={state} variant="secondary">{state}: {count}</Badge>)}{Object.entries(profile.journalCounts).map(([kind, count]) => <Badge key={kind} variant="outline">{kind}: {count}</Badge>)}</div></section>
    <section className="rounded-xl border p-4"><h3 className="mb-3 font-medium">Recent operations</h3>{profile.operations.length ? <div className="space-y-2">{profile.operations.map((operation) => <button type="button" key={operation.operationId} onClick={() => onOperation(operation.operationId)} className="flex w-full items-center justify-between gap-3 rounded-lg bg-muted/45 p-3 text-left transition hover:bg-muted"><div className="min-w-0"><div className="truncate font-medium text-primary">{operation.operationId}</div><div className="mt-1 text-xs text-muted-foreground">{operation.customerCredits} credits · {new Date(operation.updatedAt).toLocaleString("en-US")}</div></div><Badge variant="secondary">{operation.state}</Badge></button>)}</div> : <p className="text-xs text-muted-foreground">No operations are stored.</p>}</section>
  </div>;
}

function CatalogRouteDetail({ route, composition, pricing, snapshot, releaseGate }: { route: OfflineProviderCatalogRoute; composition: AdminCatalogRoute | undefined; pricing: AdminChange | undefined; snapshot: CatalogSnapshot | null; releaseGate: AdminRouteReleaseGate | null }) {
  const credits = pricing?.payload.customerCredits;
  const margin = pricing?.payload.hardFloorMarginBps;
  return <><DialogHeader><DialogTitle>Model / route details</DialogTitle><DialogDescription>Catalog layers are shown independently: provider, model, route, pricing, and credential state.</DialogDescription></DialogHeader>
    <div className="space-y-4 pt-2 text-sm"><section className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold" dir="ltr">{route.model}</div><div className="mt-1 text-xs text-muted-foreground" dir="ltr">{route.family} · {route.providerId}</div></div><Badge variant="outline" dir="ltr">SNAPSHOT · REVIEW ONLY</Badge></div><dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2"><DetailValue label="Provider route" value={route.routeId} /><DetailValue label="Catalog snapshot" value={route.snapshotId} /><DetailValue label="Capability" value={`${route.mediaType} · ${route.protocol}`} /><DetailValue label="Provider price version" value={route.providerCost.version} /><DetailValue label="Certification" value={route.certification} /></dl></section>
      {composition && <section className="rounded-xl border p-4"><h3 className="font-medium">Verified catalog composition</h3><p className="mt-1 text-xs text-muted-foreground">The engine keeps these layers separate: publisher → canonical model → provider model → account → endpoint → route.</p><dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2"><DetailValue label="Publisher / family / canonical model" value={`${composition.publisherName} / ${composition.modelFamilyName} / ${composition.canonicalModelName}`} /><DetailValue label="Provider model / metadata" value={`${composition.providerModelId} / ${composition.providerModelMetadataVersion}`} /><DetailValue label="Provider account" value={`${composition.providerAccount.displayName} (${composition.providerAccount.scope})`} /><DetailValue label="Hosting endpoint" value={`${composition.endpoint.hostingProviderId} / ${composition.endpoint.reference}${composition.endpoint.region ? ` / ${composition.endpoint.region}` : ""}`} /><DetailValue label="Capability schemas" value={`${composition.capability.version} · in ${composition.capability.inputSchemaVersion} · out ${composition.capability.outputSchemaVersion}`} /><DetailValue label="Async / webhook" value={`${composition.capability.supportsAsync ? "yes" : "no"} / ${composition.capability.supportsWebhook ? "yes" : "no"}`} /><DetailValue label="Cost version" value={`${composition.providerCost.pricingKind} · ${composition.providerCost.nativeUnit} × ${composition.providerCost.nativeScale} · ${composition.providerCost.version}`} /><DetailValue label="Cost guard" value={`${composition.costGuard.kind} · ${composition.costGuard.maximumNativeAtomic ?? "—"}`} /><DetailValue label="Usage extractor" value={composition.usageExtractorVersion} /><DetailValue label="Source snapshot contract" value={`${composition.sourceSnapshot.id} · ${composition.sourceSnapshot.parserVersion}`} /></dl><p className="mt-3 text-xs text-muted-foreground">Guard reason: {composition.costGuard.reason}</p></section>}
      <section className="rounded-xl border p-4"><h3 className="font-medium">Pricing layer</h3><div className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><DetailValue label="Provider native unit" value={`${route.providerCost.unit} × ${route.providerCost.scale}`} /><DetailValue label="FusionLab customer price" value={Number.isInteger(credits) ? `${String(credits)} credits · ${stageLabel[pricing!.state]}` : "Not configured — PRICING_POLICY required"} />{Number.isInteger(margin) && <DetailValue label="Hard floor margin" value={`${Number(margin) / 100}%`} />}</div><p className="mt-3 text-xs text-muted-foreground">A provider native unit is not a cash margin until reviewed funding and FX policy are bound, so this page never invents profit.</p></section>
      <section className="rounded-xl border p-4"><h3 className="font-medium">Catalog evidence and next step</h3>{snapshot ? <div className="mt-3 text-xs"><div className="text-muted-foreground">Verified snapshot</div><div className="mt-1 truncate">{snapshot.sourceLabel} · {snapshot.manifestSha256}</div></div> : <p className="mt-3 text-xs text-muted-foreground">No snapshot is stored for this provider. Import a verified source into Draft and review its diff.</p>}<div className="mt-3 rounded-lg bg-muted/45 p-3 text-xs text-muted-foreground">After a snapshot: catalog review → pricing policy → maker/checker → independent publish. This window never contacts a provider or activates the route.</div></section>
      <section className="rounded-xl border border-amber-500/30 p-4"><h3 className="font-medium">Route availability decision</h3>{releaseGate ? <><Badge className="mt-3" variant="destructive">{releaseGate.releaseDecision}</Badge><div className="mt-3 flex flex-wrap gap-1.5">{releaseGate.blockers.map((blocker) => <Badge key={blocker} variant="outline" className="text-[10px]">{releaseGateLabel[blocker]}</Badge>)}</div></> : <p className="mt-3 text-xs text-muted-foreground">No gate result exists for this route yet.</p>}<p className="mt-3 text-xs text-muted-foreground">A price or snapshot alone does not make a route available. This UI cannot raise a gate.</p></section>
    </div></>;
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-medium" dir="ltr">{value}</dd></div>;
}

function WalletAmount({ label, amount }: { label: string; amount: number }) {
  return <div className="rounded-lg bg-muted/45 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-semibold" dir="ltr">{amount} credits</div></div>;
}

function Empty({ label }: { label: string }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{label}</div>;
}

function FinanceList({ title, empty, rows, alert = false, onSelect }: { title: string; empty: string; rows: Array<{ id: string; primary: string; secondary: string }>; alert?: boolean; onSelect?: (id: string) => void }) {
  return <div className={`rounded-xl border p-3 ${alert && rows.length ? "border-destructive/50 bg-destructive/5" : ""}`}><div className="mb-2 text-sm font-medium">{title}</div>{rows.length ? <div className="space-y-2">{rows.map((row) => <button type="button" onClick={() => onSelect?.(row.id)} key={row.id} className="w-full rounded-md bg-muted/50 p-2 text-right text-xs transition hover:bg-muted"><div className="font-medium" dir="ltr">{row.primary}</div><div className="mt-1 text-muted-foreground" dir="ltr">{row.secondary}</div></button>)}</div> : <p className="py-3 text-xs text-muted-foreground">{empty}</p>}</div>;
}

function HistorySection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  return <section className="rounded-xl border p-3"><h3 className="mb-3 text-sm font-medium">{title}</h3>{children || <p className="text-xs text-muted-foreground">{empty}</p>}</section>;
}

function WorkflowStep({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{number}</span><div><div className="text-xs font-medium" dir="ltr">{title}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{description}</div></div></div>;
}
