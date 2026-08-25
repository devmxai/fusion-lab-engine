import { ArrowRight, CheckCircle2, Copy, KeyRound, Link2, Loader2, ShieldCheck, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  activateProviderCredential, getAdminCapabilities, getAdminProviderDetail, getAdminProviderDirectory,
  revokeProviderCredential, testProviderCredential, writeProviderCredential, type CredentialMetadata,
} from "@/lib/admin-v2-client";
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminSection, StatusBadge, formatAdminDate } from "../components/AdminUi";
import { adminQueryKeys, useAdminReadQuery } from "../data/admin-queries";

function ProviderList() {
  const directory = useAdminReadQuery(adminQueryKeys.providerDirectory, getAdminProviderDirectory);
  return <AdminSection title="Known providers" description="Configure a provider once, then select only the models you want to offer.">
    {directory.isLoading ? <AdminLoadingState rows={2} /> : directory.isError ? <AdminErrorState message="Providers could not be loaded." onRetry={() => void directory.refetch()} /> : directory.data?.providers.length ? <div className="divide-y divide-white/[0.06]">{directory.data.providers.map((provider) => {
      const records = directory.data.credentials.filter((credential) => credential.providerId === provider.providerId);
      return <article key={provider.providerId} className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-white">{provider.displayName}</h2><StatusBadge status={provider.connectionState ?? "DISCONNECTED"} /><StatusBadge status={provider.status} /></div><p className="mt-2 text-sm text-slate-400">{provider.capabilities.join(" · ")}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>{provider.referenceSnapshotCount} catalog snapshots</span><span>{provider.routeCount} selected routes</span><span>{records.length ? `${records.length} credential versions` : "No API key"}</span></div></div>
        <Link to={`/admin/providers/${encodeURIComponent(provider.providerId)}`} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/[0.1] px-3 text-sm font-medium text-white transition hover:bg-white/[0.06]">Configure <ArrowRight className="h-4 w-4" /></Link>
      </article>;
    })}</div> : <AdminEmptyState title="No providers registered" description="Known provider profiles will appear here when the server registry exposes them." />}
  </AdminSection>;
}

type CredentialPurpose = "PROVIDER_GENERATION_KEY" | "PROVIDER_WEBHOOK_HMAC";

function CredentialSetup({ providerId, purpose, onChanged }: { providerId: string; purpose: CredentialPurpose; onChanged: () => Promise<unknown> }) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null); setMessage(null);
    try {
      await writeProviderCredential({ providerId, secret, purpose });
      setSecret("");
      setMessage(purpose === "PROVIDER_WEBHOOK_HMAC"
        ? "Webhook signing key stored securely. Validate it locally, then activate it."
        : "API key stored securely. Run the connection test when you are ready.");
      await onChanged();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Credential could not be stored."); }
    finally { setBusy(false); }
  };
  const webhook = purpose === "PROVIDER_WEBHOOK_HMAC";
  const minimumLength = webhook ? 16 : 12;
  return <form onSubmit={submit} className="space-y-4 p-5">
    <div><label htmlFor={`${providerId}-${purpose}`} className="text-sm font-medium text-white">{webhook ? "Webhook HMAC key" : "API key"}</label><p className="mt-1 text-xs leading-5 text-slate-500">{webhook ? "Copy the webhookHmacKey from KIE Settings. Validation is local and never calls a model." : "Stored write-only in Supabase Vault. Saving does not contact the provider or consume credits."}</p></div>
    <input id={`${providerId}-${purpose}`} type="password" value={secret} onChange={(event) => setSecret(event.target.value)} minLength={minimumLength} maxLength={16384} autoComplete="off" required placeholder={webhook ? "Paste webhookHmacKey" : "Paste API key"} dir="ltr" className="h-11 w-full rounded-lg border border-white/[0.1] bg-[#0b0d10] px-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20" />
    {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}{message ? <p className="text-sm text-emerald-300">{message}</p> : null}
    <Button type="submit" disabled={busy || secret.length < minimumLength}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : webhook ? <Webhook className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}{busy ? "Saving securely…" : webhook ? "Save webhook key" : "Save API key"}</Button>
  </form>;
}

function CredentialRecord({ credential, capabilities, onChanged }: { credential: CredentialMetadata; capabilities: Awaited<ReturnType<typeof getAdminCapabilities>>; onChanged: () => Promise<unknown> }) {
  const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const run = async (action: string, work: () => Promise<unknown>) => { setBusy(action); setError(null); try { await work(); await onChanged(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Credential command failed."); } finally { setBusy(null); } };
  const webhook = credential.purpose === "PROVIDER_WEBHOOK_HMAC";
  return <article className="border-t border-white/[0.06] p-5 first:border-t-0"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium text-white">{webhook ? "Webhook key" : "API key"} v{credential.version}</p><StatusBadge status={credential.status} /></div><p className="mt-1 text-xs text-slate-500">Fingerprint {credential.fingerprint} · {credential.accountId}</p>{credential.createdAt ? <p className="mt-1 text-xs text-slate-600">Stored {formatAdminDate(credential.createdAt)}</p> : null}</div><div className="flex flex-wrap gap-2">
    {credential.status === "PENDING_TEST" && capabilities.permissions.providerCredentials.test ? <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("test", () => testProviderCredential(credential.id))}>{busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{webhook ? "Validate key" : "Test connection"}</Button> : null}
    {credential.status === "TESTED" && capabilities.permissions.providerCredentials.activate ? <Button type="button" size="sm" disabled={Boolean(busy)} onClick={() => void run("activate", () => activateProviderCredential(credential.id))}>{busy === "activate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Activate</Button> : null}
    {credential.status !== "REVOKED" && capabilities.permissions.providerCredentials.revoke ? <Button type="button" size="sm" variant="ghost" className="text-rose-300 hover:bg-rose-400/10 hover:text-rose-200" disabled={Boolean(busy)} onClick={() => void run("revoke", () => revokeProviderCredential(credential.id))}>{busy === "revoke" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Revoke</Button> : null}
  </div></div>{credential.status === "TESTED" ? <p className="mt-3 text-xs leading-5 text-amber-200">{capabilities.safeguards.superAdminSelfActivationAllowed ? `${webhook ? "Cryptographic validation passed" : "Connection verified"}. As Super Admin, you can activate this credential now; the action remains audited.` : `${webhook ? "Cryptographic validation passed" : "Connection verified"}. A different administrator must approve activation (maker/checker).`}</p> : null}{error ? <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p> : null}</article>;
}

function WebhookSetup({ onChanged, records, capabilities }: { onChanged: () => Promise<unknown>; records: CredentialMetadata[]; capabilities: Awaited<ReturnType<typeof getAdminCapabilities>> }) {
  const [copied, setCopied] = useState(false);
  const callbackUrl = `${window.location.origin}/api/engine/v2/provider-callbacks/kie`;
  const active = records.some((record) => record.status === "ACTIVE");
  const copy = async () => {
    await navigator.clipboard.writeText(callbackUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <div className="grid gap-0 xl:grid-cols-2">
    <div className="border-b border-white/[0.06] p-5 xl:border-b-0 xl:border-r">
      <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium text-white">Signed callback endpoint</p><p className="mt-1 text-xs leading-5 text-slate-500">Set this URL as the KIE callback URL. Unsigned or stale requests are rejected.</p></div><StatusBadge status={active ? "ACTIVE" : "NOT CONFIGURED"} /></div>
      <div className="mt-4 flex gap-2"><code dir="ltr" className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-white/[0.08] bg-[#0b0d10] px-3 py-3 text-xs text-slate-300">{callbackUrl}</code><Button type="button" variant="outline" size="icon" aria-label="Copy callback URL" onClick={() => void copy()}><Copy className="h-4 w-4" /></Button></div>
      {copied ? <p className="mt-2 text-xs text-emerald-300">Callback URL copied.</p> : null}
      <ol className="mt-5 space-y-2 text-xs leading-5 text-slate-400"><li>1. Open KIE Settings and generate or reveal webhookHmacKey.</li><li>2. Paste the same key here, validate it, then activate it.</li><li>3. KIE signs taskId and timestamp; FusionLab rejects replays and wakes the durable operation.</li></ol>
      <a href="https://docs.kie.ai/common-api/webhook-verification" target="_blank" rel="noreferrer" className="mt-4 inline-flex text-xs font-medium text-violet-200 hover:text-violet-100">Open KIE webhook documentation <ArrowRight className="ml-1 h-3.5 w-3.5" /></a>
    </div>
    <div>{capabilities.permissions.providerCredentials.write ? <CredentialSetup providerId="kie" purpose="PROVIDER_WEBHOOK_HMAC" onChanged={onChanged} /> : <AccessRequired />}</div>
  </div>;
}

function ProviderDetail() {
  const { providerId = "" } = useParams();
  const queryClient = useQueryClient();
  const detail = useAdminReadQuery(["admin", "provider-detail", providerId], () => getAdminProviderDetail(providerId));
  const capabilities = useAdminReadQuery(adminQueryKeys.capabilities, getAdminCapabilities);
  const provider = detail.data?.provider;
  const records = detail.data?.credentials ?? [];
  const generationRecords = records.filter((credential) => credential.purpose === "PROVIDER_GENERATION_KEY");
  const webhookRecords = records.filter((credential) => credential.purpose === "PROVIDER_WEBHOOK_HMAC");
  const refresh = async () => {
    await Promise.all([detail.refetch(), capabilities.refetch()]);
    await queryClient.invalidateQueries({ queryKey: adminQueryKeys.providerDirectory });
  };
  if (detail.isLoading || capabilities.isLoading) return <AdminLoadingState rows={4} />;
  if (detail.isError || capabilities.isError) return <AdminErrorState message="Provider details could not be loaded." onRetry={() => void refresh()} />;
  if (!provider || !capabilities.data) return <AdminEmptyState title="Provider not found" description="This provider is not present in the current server registry." />;
  return <div className="space-y-6"><AdminPageHeader eyebrow="AI GATEWAY" title={provider.displayName} description="Connect generation and callback security separately. Opening this page never contacts the provider." action={<Link to="/admin/providers" className="text-sm font-medium text-violet-200 hover:text-violet-100">Back to providers</Link>} />
    <div className="grid gap-6 xl:grid-cols-2"><AdminSection title="Overview" description="Live readiness from the Production server."><dl className="grid gap-4 p-5 sm:grid-cols-2"><Fact label="Connection" value={provider.connectionState ?? "DISCONNECTED"} icon={Link2} /><Fact label="Catalog" value={provider.status === "CATALOG_IMPORTED" ? "IMPORTED" : "IMPORT REQUIRED"} icon={ShieldCheck} /><Fact label="Selected routes" value={String(provider.routeCount)} icon={ShieldCheck} /><Fact label="Capabilities" value={provider.capabilities.join(", ")} icon={ShieldCheck} /></dl></AdminSection><AdminSection title="Generation API key" description="Used only for provider API requests. The secret is write-only.">{capabilities.data.permissions.providerCredentials.write ? <CredentialSetup providerId={providerId} purpose="PROVIDER_GENERATION_KEY" onChanged={refresh} /> : <AccessRequired />}</AdminSection></div>
    {providerId === "kie" ? <AdminSection title="Webhook security" description="Authenticate KIE completion callbacks independently from the generation API key."><WebhookSetup onChanged={refresh} records={webhookRecords} capabilities={capabilities.data} /></AdminSection> : null}
    <AdminSection title="Generation credential history" description="Only redacted metadata, state and fingerprint are shown.">{generationRecords.length ? generationRecords.map((credential) => <CredentialRecord key={credential.id} credential={credential} capabilities={capabilities.data!} onChanged={refresh} />) : <AdminEmptyState title="No API key stored" description="Complete the protected setup above. No provider request has been made." icon={KeyRound} />}</AdminSection>
    {providerId === "kie" ? <AdminSection title="Webhook key history" description="Webhook keys are versioned and rotated independently from generation keys.">{webhookRecords.length ? webhookRecords.map((credential) => <CredentialRecord key={credential.id} credential={credential} capabilities={capabilities.data!} onChanged={refresh} />) : <AdminEmptyState title="No webhook key stored" description="Paste the KIE webhookHmacKey above to enable signed callbacks." icon={Webhook} />}</AdminSection> : null}
    <AdminSection title="Official sources" description="Catalog and pricing evidence stay separate from connection status."><div className="grid gap-3 p-5 sm:grid-cols-3"><ExternalLink label="Documentation" href={provider.documentationUrl} /><ExternalLink label="Catalog" href={provider.catalogUrl} /><ExternalLink label="Pricing" href={provider.pricingUrl} /></div></AdminSection>
  </div>;
}

function AccessRequired() { return <div className="p-5"><p className="text-sm font-medium text-white">Super Admin permission required</p><p className="mt-1 max-w-xl text-sm leading-6 text-slate-400">This account can inspect provider status but cannot change provider credentials.</p></div>; }
function Fact({ label, value, icon: Icon }: { label: string; value: string; icon: typeof ShieldCheck }) { return <div className="rounded-lg border border-white/[0.08] bg-[#0b0d10] p-4"><Icon className="h-4 w-4 text-violet-300" /><dt className="mt-4 text-xs text-slate-500">{label}</dt><dd className="mt-1 text-sm text-slate-200">{value}</dd></div>; }
function ExternalLink({ label, href }: { label: string; href: string }) { return <a href={href} target="_blank" rel="noreferrer" className="rounded-lg border border-white/[0.08] bg-[#0b0d10] p-4 text-sm font-medium text-violet-200 transition hover:bg-white/[0.04]">{label}<span className="mt-1 block truncate text-xs font-normal text-slate-500">{href}</span></a>; }

export default function AdminProvidersPage() { const { providerId } = useParams(); return <div className="space-y-6">{providerId ? <ProviderDetail /> : <><AdminPageHeader eyebrow="AI GATEWAY" title="Providers" description="Connect KIE.ai or OpenRouter with a write-only API key and explicit verification." /><ProviderList /></>}</div>; }
