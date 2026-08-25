import { CalendarDays, Check, CircleDollarSign, Copy, CreditCard, KeyRound, LoaderCircle, PackageOpen, Plus, UsersRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createAdminCommandId, generateSubscriptionActivationKey, getCommerceAdminOverview, publishSubscriptionPlan, retireSubscriptionPlan, revokeSubscriptionActivationKey, type CommerceAdminOverview } from "@/lib/admin-v2-client";
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminSection, MetricCard, StatusBadge, TableFrame } from "../components/AdminUi";
import { adminQueryKeys, useAdminReadQuery } from "../data/admin-queries";

function money(amountMinor: string, currency: string) {
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  const amount = Number(amountMinor) / (10 ** digits);
  if (!Number.isFinite(amount)) return `${amountMinor} ${currency}`;
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount); }
  catch { return `${amount.toFixed(2)} ${currency}`; }
}

function PlanDialog({ open, onOpenChange, onPublished }: { open: boolean; onOpenChange: (open: boolean) => void; onPublished: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-white/[0.1] bg-[#0b0d10] px-3 text-sm text-white outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const customerAmount = Number(form.get("amount"));
    const creditsPerPeriod = Number(form.get("credits"));
    const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    if (!Number.isFinite(customerAmount) || customerAmount < 0 || !Number.isSafeInteger(creditsPerPeriod) || creditsPerPeriod < 1) {
      toast.error("Enter a valid customer price and credit amount.");
      return;
    }
    setSaving(true);
    try {
      await publishSubscriptionPlan({
        planKey: String(form.get("planKey")).trim().toLowerCase(), displayName: String(form.get("displayName")).trim(),
        amountMinor: String(Math.round(customerAmount * (10 ** digits))), currency,
        interval: form.get("interval") === "YEAR" ? "YEAR" : "MONTH", creditsPerPeriod,
        termsVersion: String(form.get("termsVersion")).trim(),
        features: String(form.get("features") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      }, { commandId: createAdminCommandId() });
      await onPublished();
      toast.success("A new immutable plan version was published.");
      onOpenChange(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : "The plan could not be published."); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="border-white/[0.1] bg-[#12161b] text-white sm:max-w-xl">
    <DialogHeader><DialogTitle>Publish plan version</DialogTitle><DialogDescription className="text-slate-400">Creates a new immutable catalog version. It does not charge a customer, start a subscription or grant credits.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="mt-2 grid gap-4 sm:grid-cols-2">
      <label className="text-xs font-medium text-slate-300">Plan name<input name="displayName" required minLength={2} placeholder="Pro" className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-300">Plan key<input name="planKey" required minLength={3} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="pro" className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-300">Customer price<input name="amount" required type="number" min="0" step="0.01" placeholder="29.00" className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-300">Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)} className={inputClass}><option value="USD">USD</option><option value="IQD">IQD</option><option value="EUR">EUR</option></select></label>
      <label className="text-xs font-medium text-slate-300">Billing interval<select name="interval" className={inputClass}><option value="MONTH">Monthly</option><option value="YEAR">Annual</option></select></label>
      <label className="text-xs font-medium text-slate-300">Credits per period<input name="credits" required type="number" min="1" step="1" placeholder="1000" className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-300">Terms version<input name="termsVersion" required minLength={3} placeholder="terms-2026-01" className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-300">Features <span className="text-slate-500">(comma separated)</span><input name="features" placeholder="image, video, priority" className={inputClass} /></label>
      <div className="flex justify-end gap-2 border-t border-white/[0.08] pt-4 sm:col-span-2"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving} className="bg-white text-black hover:bg-slate-200">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Publish version</Button></div>
    </form>
  </DialogContent></Dialog>;
}

type PlanOption = NonNullable<CommerceAdminOverview["plans"]>[number];

function ActivationKeyDialog({ open, onOpenChange, plans, onGenerated }: { open: boolean; onOpenChange: (open: boolean) => void; plans: PlanOption[]; onGenerated: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [generated, setGenerated] = useState<Awaited<ReturnType<typeof generateSubscriptionActivationKey>> | null>(null);
  const [copied, setCopied] = useState(false);
  const availablePlans = plans.filter((plan) => plan.lifecycle === "PUBLISHED");
  const close = (next: boolean) => { if (!next) { setGenerated(null); setCopied(false); } onOpenChange(next); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const result = await generateSubscriptionActivationKey({ planVersionId: String(form.get("planVersionId")), expiresInDays: Number(form.get("expiresInDays")) }, { commandId: createAdminCommandId() });
      setGenerated(result);
      await onGenerated();
      toast.success("Activation key generated. Copy and send it securely.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "The activation key could not be generated."); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={close}><DialogContent className="border-white/[0.1] bg-[#12161b] text-white sm:max-w-xl">
    <DialogHeader><DialogTitle>Generate activation key</DialogTitle><DialogDescription className="text-slate-400">The key is linked to one exact plan version and can activate one account only. FusionLab stores its hash, not the plaintext value.</DialogDescription></DialogHeader>
    {generated ? <div className="mt-3 space-y-4"><div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-emerald-200">{generated.displayName} · {generated.interval === "MONTH" ? "Monthly" : "Annual"}</p><p className="mt-1 text-xs text-slate-400">{generated.creditsPerPeriod.toLocaleString()} credits · expires {new Date(generated.expiresAt).toLocaleDateString()}</p></div><KeyRound className="h-5 w-5 text-emerald-300" /></div><div className="mt-4 flex items-center gap-2 rounded-lg border border-white/[0.1] bg-[#080a0d] p-2"><code className="min-w-0 flex-1 break-all px-2 text-xs text-white">{generated.activationKey}</code><Button type="button" size="sm" onClick={async () => { await navigator.clipboard.writeText(generated.activationKey); setCopied(true); toast.success("Activation key copied."); }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy"}</Button></div></div><p className="text-xs leading-5 text-amber-200">Send this value through a secure channel. Anyone holding it can activate the linked plan until it expires or is revoked.</p><div className="flex justify-end"><Button type="button" onClick={() => close(false)} className="bg-white text-black hover:bg-slate-200">Done</Button></div></div> : availablePlans.length ? <form onSubmit={submit} className="mt-2 space-y-4"><label className="block text-xs font-medium text-slate-300">Subscription plan<select name="planVersionId" required className="mt-1.5 h-11 w-full rounded-lg border border-white/[0.1] bg-[#0b0d10] px-3 text-sm text-white outline-none focus:border-violet-400/60">{availablePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.displayName} · {plan.interval === "MONTH" ? "Monthly" : "Annual"} · {plan.creditsPerPeriod.toLocaleString()} credits</option>)}</select></label><label className="block text-xs font-medium text-slate-300">Key expires after<select name="expiresInDays" defaultValue="30" className="mt-1.5 h-11 w-full rounded-lg border border-white/[0.1] bg-[#0b0d10] px-3 text-sm text-white outline-none focus:border-violet-400/60"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></label><div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-3 text-xs leading-5 text-slate-400">The customer receives the credits only after successful redemption. Generating a key does not change any wallet.</div><div className="flex justify-end gap-2 border-t border-white/[0.08] pt-4"><Button type="button" variant="ghost" onClick={() => close(false)} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving} className="bg-white text-black hover:bg-slate-200">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Generate key</Button></div></form> : <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-sm leading-6 text-amber-100">Publish a subscription plan first. Internal test plans cannot issue customer activation keys.</div>}
  </DialogContent></Dialog>;
}

export default function AdminSubscriptionsPage() {
  const queryClient = useQueryClient();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [retiringPlan, setRetiringPlan] = useState<string | null>(null);
  const commerce = useAdminReadQuery(adminQueryKeys.commerce, getCommerceAdminOverview);
  const plans = commerce.data?.plans ?? [];
  const products = commerce.data?.products ?? [];
  const subscriptions = commerce.data?.subscriptions ?? [];
  const activationKeys = commerce.data?.activationKeys ?? [];
  const active = subscriptions.filter((subscription) => subscription.state === "ACTIVE");
  const recurringCredits = active.reduce((sum, subscription) => sum + subscription.creditsPerPeriod, 0);
  return <div className="space-y-6">
    <AdminPageHeader eyebrow="BUSINESS" title="Subscriptions" description="Plan catalog, activation keys, subscribers and recurring credit commitments in one place." action={<div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setKeyDialogOpen(true)} className="border-white/[0.12] bg-transparent text-white hover:bg-white/[0.06]"><KeyRound className="h-4 w-4" />Generate key</Button><Button type="button" onClick={() => setPlanDialogOpen(true)} className="bg-white text-black hover:bg-slate-200"><Plus className="h-4 w-4" />New plan version</Button></div>} />
    <PlanDialog open={planDialogOpen} onOpenChange={setPlanDialogOpen} onPublished={async () => { await queryClient.invalidateQueries({ queryKey: adminQueryKeys.commerce }); }} />
    <ActivationKeyDialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen} plans={plans} onGenerated={async () => { await queryClient.invalidateQueries({ queryKey: adminQueryKeys.commerce }); }} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={CreditCard} label="Plan versions" value={String(plans.length)} note={`${plans.filter((plan) => plan.lifecycle === "PUBLISHED").length} published`} />
      <MetricCard icon={UsersRound} label="Active subscribers" value={String(active.length)} note={`${subscriptions.length} total subscriptions`} tone="success" />
      <MetricCard icon={CircleDollarSign} label="Period credits" value={new Intl.NumberFormat("en-US").format(recurringCredits)} note="Committed to active periods" />
      <MetricCard icon={KeyRound} label="Unused keys" value={String(activationKeys.filter((key) => key.state === "ISSUED").length)} note={`${activationKeys.length} activation keys total`} tone="attention" />
    </div>
    {commerce.isLoading ? <AdminLoadingState rows={6} /> : commerce.isError ? <AdminErrorState message="Subscription data could not be loaded." onRetry={() => void commerce.refetch()} /> : !commerce.data?.enabled ? <AdminEmptyState title="Subscriptions are unavailable" description="The commerce read model is not enabled in this environment." /> : <>
      <AdminSection title="Plan catalog" description="Every row is an immutable plan version. A published plan is never edited in place.">
        {plans.length ? <TableFrame><thead className="border-b border-white/[0.08] bg-white/[0.025] text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-medium">Plan</th><th className="py-3 font-medium">Billing</th><th className="py-3 font-medium">Customer price</th><th className="py-3 font-medium">Credits</th><th className="py-3 font-medium">Status</th><th className="px-5 py-3 font-medium">Action</th></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id} className="border-b border-white/[0.06] last:border-0"><td className="px-5 py-3"><p className="font-medium text-white">{plan.displayName}</p><p className="mt-0.5 text-xs text-slate-500">{plan.planKey} · version {plan.version}</p></td><td className="py-3 text-sm text-slate-300">{plan.interval === "MONTH" ? "Monthly" : "Annual"}</td><td className="py-3 text-sm font-medium text-white">{money(plan.amountMinor, plan.currency)}</td><td className="py-3 text-sm text-slate-300">{new Intl.NumberFormat("en-US").format(plan.creditsPerPeriod)} / period</td><td className="py-3"><StatusBadge status={plan.lifecycle} /></td><td className="px-5 py-3">{plan.lifecycle === "PUBLISHED" ? <button type="button" disabled={retiringPlan === plan.planKey} onClick={async () => { if (!window.confirm(`Retire ${plan.displayName}? Existing subscriptions stay unchanged.`)) return; setRetiringPlan(plan.planKey); try { await retireSubscriptionPlan(plan.planKey, { commandId: createAdminCommandId() }); await queryClient.invalidateQueries({ queryKey: adminQueryKeys.commerce }); toast.success("Plan retired. Existing subscriptions were not changed."); } catch (error) { toast.error(error instanceof Error ? error.message : "Plan could not be retired."); } finally { setRetiringPlan(null); } }} className="text-xs font-medium text-slate-400 hover:text-rose-300 disabled:opacity-50">{retiringPlan === plan.planKey ? "Retiring…" : "Retire"}</button> : <span className="text-xs text-slate-600">—</span>}</td></tr>)}</tbody></TableFrame> : <AdminEmptyState title="No plan versions" description="No subscription plan has been published." icon={CalendarDays} />}
      </AdminSection>
      <AdminSection title="Activation keys" description="One-time subscription codes. Plaintext values are shown only when generated; this list remains redacted.">
        {activationKeys.length ? <TableFrame><thead className="border-b border-white/[0.08] bg-white/[0.025] text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-medium">Key</th><th className="py-3 font-medium">Plan</th><th className="py-3 font-medium">Expires</th><th className="py-3 font-medium">Customer</th><th className="py-3 font-medium">Status</th><th className="px-5 py-3 font-medium">Action</th></tr></thead><tbody>{activationKeys.map((key) => <tr key={key.id} className="border-b border-white/[0.06] last:border-0"><td className="px-5 py-3 font-mono text-xs text-slate-300">{key.keyHint}</td><td className="py-3"><p className="text-sm font-medium text-white">{key.displayName}</p><p className="mt-0.5 text-xs text-slate-500">{key.interval === "MONTH" ? "Monthly" : "Annual"} · {key.creditsPerPeriod.toLocaleString()} credits</p></td><td className="py-3 text-xs text-slate-400">{new Date(key.expiresAt).toLocaleDateString()}</td><td className="max-w-56 py-3 text-xs text-slate-400">{key.redeemedBy ? <Link to={`/admin/users/${encodeURIComponent(key.redeemedBy)}`} className="truncate text-violet-200 hover:text-violet-100">{key.redeemedByEmail ?? key.redeemedBy}</Link> : "—"}</td><td className="py-3"><StatusBadge status={key.state} /></td><td className="px-5 py-3">{key.state === "ISSUED" ? <button type="button" onClick={async () => { if (!window.confirm("Revoke this unused activation key?")) return; try { await revokeSubscriptionActivationKey(key.id, { commandId: createAdminCommandId() }); await queryClient.invalidateQueries({ queryKey: adminQueryKeys.commerce }); toast.success("Activation key revoked."); } catch (error) { toast.error(error instanceof Error ? error.message : "The key could not be revoked."); } }} className="text-xs font-medium text-slate-400 hover:text-rose-300">Revoke</button> : <span className="text-xs text-slate-600">—</span>}</td></tr>)}</tbody></TableFrame> : <AdminEmptyState title="No activation keys" description="Generate a one-time key for a published monthly or annual plan." icon={KeyRound} />}
      </AdminSection>
      <AdminSection title="Subscribers" description="Current and historical subscriptions joined with the customer's wallet.">
        {subscriptions.length ? <TableFrame><thead className="border-b border-white/[0.08] bg-white/[0.025] text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-medium">Customer</th><th className="py-3 font-medium">Plan</th><th className="py-3 font-medium">Period</th><th className="py-3 font-medium">Wallet</th><th className="px-5 py-3 font-medium">Status</th></tr></thead><tbody>{subscriptions.map((subscription) => <tr key={subscription.id} className="border-b border-white/[0.06] last:border-0"><td className="max-w-72 px-5 py-3"><Link to={`/admin/users/${encodeURIComponent(subscription.ownerId)}`} className="font-medium text-white hover:text-violet-200">{subscription.ownerDisplayName || subscription.ownerEmail || "Customer"}</Link><p className="mt-0.5 truncate text-xs text-slate-500">{subscription.ownerEmail ?? subscription.ownerId}</p></td><td className="py-3"><p className="text-sm font-medium text-white">{subscription.displayName}</p><p className="mt-0.5 text-xs text-slate-500">{new Intl.NumberFormat("en-US").format(subscription.creditsPerPeriod)} credits / period</p></td><td className="py-3 text-xs text-slate-400"><p>{new Date(subscription.currentPeriodStart).toLocaleDateString()}</p><p className="mt-1">to {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p></td><td className="py-3 text-sm text-slate-300">{subscription.wallet ? <><p>{new Intl.NumberFormat("en-US").format(subscription.wallet.availableCredits)} available</p><p className="mt-0.5 text-xs text-slate-500">{new Intl.NumberFormat("en-US").format(subscription.wallet.spentCredits)} spent</p></> : "No wallet"}</td><td className="px-5 py-3"><StatusBadge status={subscription.state} /></td></tr>)}</tbody></TableFrame> : <AdminEmptyState title="No subscriptions" description="Subscriptions will appear after a verified payment or protected internal assignment." icon={CalendarDays} />}
      </AdminSection>
      {products.length ? <AdminSection title="Credit products" description="One-time products remain separate from recurring subscription plans."><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{products.map((product) => <article key={product.id} className="rounded-lg border border-white/[0.08] bg-[#0b0d10] p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-white">{product.displayName}</p><p className="mt-1 text-xs text-slate-500">{product.kind} · version {product.version}</p></div><PackageOpen className="h-4 w-4 text-violet-300" /></div><p className="mt-5 text-sm text-slate-300">{new Intl.NumberFormat("en-US").format(product.grantedCredits)} credits</p><p className="mt-1 text-xs text-slate-500">{money(product.amountMinor, product.currency)}</p></article>)}</div></AdminSection> : null}
    </>}
  </div>;
}
