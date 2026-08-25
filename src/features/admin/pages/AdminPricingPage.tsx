import { BadgeDollarSign, ChevronRight, CircleAlert, ExternalLink, Loader2, RefreshCw, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { configureCustomerPrice, getAdminCapabilities, getAdminPricing, syncProviderPricing, type AdminPricingRow } from "@/lib/admin-v2-client";
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminSection, StatusBadge, formatAdminDate } from "../components/AdminUi";
import { adminQueryKeys, useAdminReadQuery } from "../data/admin-queries";

const rowId = (row: AdminPricingRow) => `${row.referenceModelId}:${row.providerRate?.rateKey ?? "unpriced"}`;
const generationPattern = /(text-to-image|image-to-image|image-edit|text-to-video|image-to-video|video-to-video|text-to-audio|text-to-speech)$/i;
const modelGroupKey = (row: AdminPricingRow) => `${row.providerId}:${row.providerModelId.replace(new RegExp(`(?:/|-)${generationPattern.source}`, "i"), "")}`;
const modelDisplayName = (row: AdminPricingRow) => row.model
  .replace(/\s*-\s*(?:text|image|video)\s+to\s+(?:image|video|audio).*$/i, "")
  .replace(/(?<=[A-Za-z])-(?=\d)/g, " ")
  .trim();
const dimensionLabels: Record<string, string> = { generationType: "Type", quality: "Quality", resolution: "Resolution", durationSeconds: "Duration", audio: "Audio", aspectRatio: "Ratio", billingBasis: "Billing", meter: "Meter" };
const titleValue = (value: unknown) => String(value).replace(/_/g, " ").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function variantTags(row: AdminPricingRow) {
  const dimensions = row.providerRate?.variant.dimensions;
  const order = ["generationType", "quality", "resolution", "durationSeconds", "audio", "aspectRatio", "billingBasis", "meter"];
  // `supportedResolutions` and `supportedAspectRatios` are capability lists
  // for the workspace, not one pricing configuration. Rendering them here
  // created an unreadable tag that looked like a malformed price.
  const entries = dimensions && typeof dimensions === "object"
    ? Object.entries(dimensions as Record<string, unknown>)
      .filter(([key]) => order.includes(key))
      .sort(([left], [right]) => order.indexOf(left) - order.indexOf(right))
    : [];
  if (entries.length) return entries.map(([key, value]) => ({
    key,
    label: dimensionLabels[key] ?? titleValue(key),
    value: key === "durationSeconds" ? `${String(value)}s` : key === "audio" ? (value ? "On" : "Off") : titleValue(value),
  }));
  const label = row.providerRate?.variant.label;
  if (typeof label === "string" && label.trim()) {
    const value = label.trim();
    const key = /^(?:\d+k|\d{3,4}p)$/i.test(value) ? "resolution" : /^(?:low|medium|high|standard|pro|ultra|balanced|fast)$/i.test(value) ? "quality" : "configuration";
    return [{ key, label: dimensionLabels[key] ?? "Option", value: titleValue(value) }];
  }
  const generationType = row.providerModelId.match(generationPattern)?.[1];
  if (generationType) return [{ key: "generationType", label: "Type", value: titleValue(generationType) }];
  return [{ key: "default", label: "Configuration", value: "Default" }];
}

function decimalAtomic(value: string, decimals: number, maximumFractionDigits: number) {
  const atomic = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const whole = atomic / scale;
  const fraction = (atomic % scale).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, maximumFractionDigits);
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function ProviderRate({ row, onSync, syncing, canSync }: { row: AdminPricingRow; onSync: (providerId: "kie" | "openrouter") => void; syncing: boolean; canSync: boolean }) {
  const rate = row.providerRate;
  if (!rate) return <div><p className="text-sm font-medium text-amber-200">Official rate not matched</p><p className="mt-1 text-xs leading-5 text-slate-500">No verified price was found for this exact model configuration. Sync its provider to try again; FusionLab pricing stays locked until a source rate is imported.</p><Button type="button" size="sm" variant="outline" className="mt-3" disabled={!canSync || syncing} onClick={() => onSync(row.providerId)}>{syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}Sync {row.providerId === "kie" ? "KIE.ai" : "OpenRouter"} rates</Button></div>;
  return <div className="min-w-48"><p className="font-medium text-white">{rate.providerCreditMicros ? `${decimalAtomic(rate.providerCreditMicros, 6, 6)} provider credits` : "Metered rate"}</p>{rate.providerUsdPicos ? <p className="mt-1 text-sm text-emerald-200">${decimalAtomic(rate.providerUsdPicos, 12, 8)} · {rate.billingUnit}</p> : <p className="mt-1 text-xs text-slate-400">{rate.billingUnit}</p>}<a href={rate.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-violet-300 hover:text-violet-200">Official source <ExternalLink className="h-3 w-3" /></a><p className="mt-1 text-[10px] text-slate-600">Rate v{rate.version} · {formatAdminDate(rate.effectiveAt)}</p></div>;
}

function PricingRow({ row, canConfigure, canSync, syncing, onSync, onSaved }: { row: AdminPricingRow; canConfigure: boolean; canSync: boolean; syncing: boolean; onSync: (providerId: "kie" | "openrouter") => void; onSaved: () => Promise<unknown> }) {
  const [credits, setCredits] = useState(row.customerPrice?.customerCredits ? String(row.customerPrice.customerCredits) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const parsedCredits = Number(credits);
  const tags = variantTags(row);
  const valid = Number.isSafeInteger(parsedCredits) && parsedCredits > 0 && parsedCredits <= 1_000_000_000;
  const save = async () => {
    if (!row.providerRate || !valid) return;
    setBusy(true); setMessage(null);
    try {
      const result = await configureCustomerPrice({ referenceModelId: row.referenceModelId, rateKey: row.providerRate.rateKey, customerCredits: parsedCredits });
      setMessage(result.publishedOfferId ? "Saved and published to Standard." : "Saved. This configuration is not yet release-ready for Standard.");
      await onSaved();
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Price could not be saved."); }
    finally { setBusy(false); }
  };
  return <div className="grid gap-4 border-t border-white/[0.06] px-5 py-4 first:border-t-0 lg:grid-cols-[minmax(120px,0.65fr)_minmax(210px,1fr)_minmax(280px,1.35fr)_minmax(150px,0.7fr)] lg:items-start">
    <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 lg:hidden">Configuration</p><div className="mt-1 flex flex-wrap gap-1.5">{tags.map((tag) => <span key={`${tag.key}:${tag.value}`} className="inline-flex rounded-md border border-violet-400/20 bg-violet-400/10 px-2 py-1 text-[11px] font-medium text-violet-100"><span className="mr-1 text-violet-400">{tag.label}:</span>{tag.value}</span>)}</div></div>
    <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 lg:hidden">Provider official cost</p><ProviderRate row={row} onSync={onSync} syncing={syncing} canSync={canSync} /></div>
    <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 lg:hidden">FusionLab price</p><div className="flex min-w-56 items-center gap-2"><Input type="number" min={1} step={1} value={credits} onChange={(event) => { setCredits(event.target.value); setMessage(null); }} disabled={!row.providerRate || !canConfigure || busy} aria-label={`FusionLab credits for ${row.model} ${tags.map((tag) => tag.value).join(" ")}`} placeholder="Set credits" className="h-9 border-white/[0.1] bg-[#0b0d10] text-white" /><Button type="button" size="sm" disabled={!row.providerRate || !canConfigure || !valid || busy} onClick={() => void save()}>{busy ? <Loader2 className="animate-spin" /> : <Save />}Save</Button></div><p className="mt-2 text-[11px] text-slate-500">Your customer price for this configuration</p>{message ? <p className={`mt-1 text-xs ${message.startsWith("Saved") ? "text-emerald-300" : "text-rose-300"}`}>{message}</p> : null}{row.customerPrice ? <p className="mt-1 text-[10px] text-slate-600">Price v{row.customerPrice.version} · {formatAdminDate(row.customerPrice.updatedAt)}</p> : null}</div>
    <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 lg:hidden">Readiness</p><StatusBadge status={row.status === "CONFIGURED" ? "CONFIGURED" : "PENDING"} fallback={row.status === "RATE_SYNC_REQUIRED" ? "Rate needed" : "Customer price needed"} /><p className="mt-2 max-w-44 text-xs leading-5 text-slate-500">{row.status === "CONFIGURED" ? "Price configured; compatible routes publish to Standard when saved." : row.status === "RATE_SYNC_REQUIRED" ? "Sync official provider evidence" : "Set your customer price"}</p></div>
  </div>;
}

function PricingModelGroup({ rows, canConfigure, canSync, syncing, onSync, onSaved }: { rows: AdminPricingRow[]; canConfigure: boolean; canSync: boolean; syncing: boolean; onSync: (providerId: "kie" | "openrouter") => void; onSaved: () => Promise<unknown> }) {
  const model = rows[0]!;
  const [open, setOpen] = useState(false);
  const configuredCount = rows.filter((row) => row.status === "CONFIGURED").length;
  const panelId = `pricing-model-${modelGroupKey(model).replace(/[^a-z0-9_-]+/gi, "-")}`;
  return <article className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b0d10]">
    <h3>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)} className="group flex w-full items-center gap-3 bg-white/[0.025] px-4 py-4 text-left transition-colors hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400 sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-violet-400/20 bg-violet-400/10 text-violet-200" aria-hidden="true"><BadgeDollarSign className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-white">{modelDisplayName(model)}</span>
            <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{model.mediaType}</span>
          </span>
          <span className="mt-1 block truncate text-xs text-slate-500">{model.providerId.toUpperCase()} · {rows.length} {rows.length === 1 ? "configuration" : "configurations"}</span>
        </span>
        <span className="hidden shrink-0 text-right sm:block">
          <span className={`block text-xs font-medium ${configuredCount === rows.length ? "text-emerald-300" : "text-slate-300"}`}>{configuredCount}/{rows.length} priced</span>
          <span className="mt-0.5 block text-[11px] text-slate-600">{open ? "Hide details" : "View details"}</span>
        </span>
        <ChevronRight className={`h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200 group-hover:text-slate-300 ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
    </h3>
    <div id={panelId} className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
      <div className="min-h-0 overflow-hidden">
        <div className="hidden grid-cols-[minmax(120px,0.65fr)_minmax(210px,1fr)_minmax(280px,1.35fr)_minmax(150px,0.7fr)] gap-4 border-b border-t border-white/[0.06] px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 lg:grid"><span>Configuration</span><span>Provider official cost</span><span>FusionLab price</span><span>Readiness</span></div>
        <div>{rows.map((row) => <PricingRow key={rowId(row)} row={row} canConfigure={canConfigure} canSync={canSync} syncing={syncing} onSync={onSync} onSaved={onSaved} />)}</div>
      </div>
    </div>
  </article>;
}

export default function AdminPricingPage() {
  const queryClient = useQueryClient();
  const pricing = useAdminReadQuery(adminQueryKeys.pricing, getAdminPricing);
  const capabilities = useAdminReadQuery(adminQueryKeys.capabilities, getAdminCapabilities);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const providers = useMemo(() => [...new Set((pricing.data ?? []).map((row) => row.providerId))], [pricing.data]);
  const modelGroups = useMemo(() => [...(pricing.data ?? []).reduce((groups, row) => {
    const key = modelGroupKey(row);
    const group = groups.get(key) ?? [];
    group.push(row); groups.set(key, group); return groups;
  }, new Map<string, AdminPricingRow[]>()).values()], [pricing.data]);
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: adminQueryKeys.pricing }); };
  const sync = async (providerId: "kie" | "openrouter") => {
    setSyncing(providerId); setSyncMessage(null);
    try {
      const result = await syncProviderPricing(providerId);
      const unmatched = result.unmatchedReferenceModelIds.map((id) => pricing.data?.find((row) => row.referenceModelId === id)?.model ?? id);
      setSyncMessage(unmatched.length
        ? `${result.importedRateCount} official rate${result.importedRateCount === 1 ? "" : "s"} imported from ${providerId}. No verified rate was found for: ${unmatched.join(", ")}. Their FusionLab price fields remain locked.`
        : `${result.importedRateCount} official rate${result.importedRateCount === 1 ? "" : "s"} imported for all ${result.matchedModelCount} selected ${providerId} model${result.matchedModelCount === 1 ? "" : "s"}.`);
      await refresh();
    }
    catch (error) { setSyncMessage(error instanceof Error ? error.message : "Official rates could not be imported."); }
    finally { setSyncing(null); }
  };

  return <div className="space-y-6">
    <AdminPageHeader eyebrow="AI GATEWAY" title="Pricing" description="Compare the provider's official cost with your FusionLab customer price. The two values are versioned independently and every change is audited." action={<div className="flex flex-wrap gap-2">{providers.map((providerId) => <Button key={providerId} type="button" variant="outline" disabled={Boolean(syncing) || !capabilities.data?.permissions.pricing.sync} onClick={() => void sync(providerId)}>{syncing === providerId ? <Loader2 className="animate-spin" /> : <RefreshCw />}Sync {providerId === "kie" ? "KIE.ai" : "OpenRouter"} rates</Button>)}</div>} />
    {syncMessage ? <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-slate-300">{syncMessage}</div> : null}
    <AdminSection title="Model prices" description={`${modelGroups.length} selected ${modelGroups.length === 1 ? "model" : "models"}. Resolution, quality, duration, audio and billing variants stay grouped under their model.`}>
      {pricing.isLoading || capabilities.isLoading ? <AdminLoadingState /> : pricing.isError || capabilities.isError ? <AdminErrorState message="Pricing could not be loaded." onRetry={() => { void pricing.refetch(); void capabilities.refetch(); }} /> : modelGroups.length ? <div className="space-y-4 p-4 sm:p-5">{modelGroups.map((rows) => <PricingModelGroup key={modelGroupKey(rows[0]!)} rows={rows} canConfigure={Boolean(capabilities.data?.permissions.pricing.configure)} canSync={Boolean(capabilities.data?.permissions.pricing.sync)} syncing={syncing === rows[0]!.providerId} onSync={(providerId) => { void sync(providerId); }} onSaved={refresh} />)}</div> : <AdminEmptyState title="No models selected" description="Select a model from Models first. It will then appear here for official-rate synchronization and customer pricing." icon={BadgeDollarSign} />}
      <div className="flex gap-3 border-t border-white/[0.08] bg-amber-400/[0.04] px-5 py-4 text-xs leading-5 text-amber-100"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><p>Syncing reads the provider's public pricing catalog only; it does not call a generation model or consume provider credits. Pricing a model does not activate it for customers.</p></div>
    </AdminSection>
  </div>;
}
