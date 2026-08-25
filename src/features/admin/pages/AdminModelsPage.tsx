import { Boxes, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createAdminCommandId, getAdminCapabilities, getReferenceCatalogModels, getReferenceCatalogSnapshots, importProviderReferenceCatalog, reviewReferenceModelPresentation, selectReferenceModel, unselectReferenceModel, type ReferenceCatalogModel } from "@/lib/admin-v2-client";
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminSection, StatusBadge, TableFrame, formatAdminDate } from "../components/AdminUi";
import { adminQueryKeys, useAdminReadQuery } from "../data/admin-queries";

function presentationDefaults(model: ReferenceCatalogModel) {
  const hint = model.taxonomyHint && typeof model.taxonomyHint === "object" ? model.taxonomyHint as { productFamily?: { id?: unknown; displayName?: unknown }; version?: { id?: unknown; displayName?: unknown }; edition?: { id?: unknown; displayName?: unknown }; experienceCategories?: unknown } : null;
  const category = Array.isArray(hint?.experienceCategories) && ["IMAGE", "VIDEO", "AVATAR", "AUDIO"].includes(String(hint.experienceCategories[0]))
    ? String(hint.experienceCategories[0]) : model.modalities.includes("video") ? "VIDEO" : model.modalities.includes("image") ? "IMAGE" : "AUDIO";
  return {
    familyId: typeof hint?.productFamily?.id === "string" ? hint.productFamily.id : model.familyId,
    familyName: typeof hint?.productFamily?.displayName === "string" ? hint.productFamily.displayName : model.displayName,
    versionId: typeof hint?.version?.id === "string" ? hint.version.id : "",
    versionName: typeof hint?.version?.displayName === "string" ? hint.version.displayName : "",
    editionId: typeof hint?.edition?.id === "string" ? hint.edition.id : "",
    editionName: typeof hint?.edition?.displayName === "string" ? hint.edition.displayName : "",
    category,
  };
}

function ModelPresentationDialog({ model, onOpenChange, onSaved }: { model: ReferenceCatalogModel | null; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaults = model ? presentationDefaults(model) : null;
  const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-white/[0.1] bg-[#0b0d10] px-3 text-sm text-white outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!model || saving) return;
    const form = new FormData(event.currentTarget);
    const optionalPart = (idField: string, nameField: string) => {
      const id = String(form.get(idField) ?? "").trim(); const displayName = String(form.get(nameField) ?? "").trim();
      return id || displayName ? { id, displayName } : undefined;
    };
    setSaving(true); setError(null);
    try {
      await reviewReferenceModelPresentation(model.id, {
        productFamily: { id: String(form.get("familyId")).trim(), displayName: String(form.get("familyName")).trim() },
        ...(optionalPart("versionId", "versionName") ? { version: optionalPart("versionId", "versionName") } : {}),
        ...(optionalPart("editionId", "editionName") ? { edition: optionalPart("editionId", "editionName") } : {}),
        experienceCategories: [String(form.get("category")) as "IMAGE" | "VIDEO" | "AVATAR" | "AUDIO"],
      }, { commandId: createAdminCommandId() });
      await onSaved(); onOpenChange(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The reviewed presentation could not be saved."); }
    finally { setSaving(false); }
  };
  return <Dialog open={Boolean(model)} onOpenChange={onOpenChange}><DialogContent className="border-white/[0.1] bg-[#12161b] text-white sm:max-w-xl">
    <DialogHeader><DialogTitle>Customer model presentation</DialogTitle><DialogDescription className="text-slate-400">Review the customer-facing family and version. Source observations are only suggestions; saving creates an immutable revision pinned to this catalog snapshot.</DialogDescription></DialogHeader>
    {model && defaults ? <form key={`${model.id}:${model.snapshotId}`} onSubmit={submit} className="mt-2 grid gap-4 sm:grid-cols-2">
      <label className="text-xs font-medium text-slate-300">Product family name<input name="familyName" required minLength={2} defaultValue={defaults.familyName} className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-300">Product family ID<input name="familyId" required minLength={2} defaultValue={defaults.familyId} className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-300">Version <span className="text-slate-500">(optional)</span><input name="versionName" defaultValue={defaults.versionName} placeholder="3.0" className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-300">Version ID <span className="text-slate-500">(optional)</span><input name="versionId" defaultValue={defaults.versionId} placeholder="3" className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-300">Edition <span className="text-slate-500">(optional)</span><input name="editionName" defaultValue={defaults.editionName} placeholder="Turbo" className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-300">Edition ID <span className="text-slate-500">(optional)</span><input name="editionId" defaultValue={defaults.editionId} placeholder="turbo" className={inputClass} /></label>
      <label className="text-xs font-medium text-slate-300 sm:col-span-2">Customer experience<select name="category" defaultValue={defaults.category} className={inputClass}><option value="IMAGE">Image</option><option value="VIDEO">Video</option><option value="AVATAR">AI Avatar</option><option value="AUDIO">Audio</option></select></label>
      {error ? <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/[0.07] p-3 text-sm text-rose-200 sm:col-span-2">{error}</p> : null}
      <div className="flex justify-end gap-2 border-t border-white/[0.08] pt-4 sm:col-span-2"><Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving} className="bg-white text-black hover:bg-slate-200">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save reviewed presentation</Button></div>
    </form> : null}
  </DialogContent></Dialog>;
}

export default function AdminModelsPage() {
  const modelsQuery = useAdminReadQuery(adminQueryKeys.referenceModels, getReferenceCatalogModels);
  const snapshotsQuery = useAdminReadQuery(adminQueryKeys.referenceSnapshots, getReferenceCatalogSnapshots);
  const capabilitiesQuery = useAdminReadQuery(adminQueryKeys.capabilities, getAdminCapabilities);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("all");
  const [mediaType, setMediaType] = useState("all");
  const [selection, setSelection] = useState("all");
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState<"kie" | "openrouter" | null>(null);
  const [changingModel, setChangingModel] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presentationModel, setPresentationModel] = useState<ReferenceCatalogModel | null>(null);
  const providers = useMemo(() => [...new Set((modelsQuery.data ?? []).map((model) => model.providerId))], [modelsQuery.data]);
  const models = useMemo(() => (modelsQuery.data ?? []).filter((model) => {
    const term = search.trim().toLowerCase();
    return (provider === "all" || model.providerId === provider)
      && (mediaType === "all" || model.modalities.includes(mediaType))
      && (selection === "all" || (selection === "selected") === (model.selectionState === "SELECTED"))
      && (!term || `${model.displayName} ${model.providerModelId} ${model.familyId} ${model.modalities.join(" ")}`.toLowerCase().includes(term));
  }), [mediaType, modelsQuery.data, provider, search, selection]);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(models.length / pageSize));
  const visibleModels = models.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => { setPage(1); }, [search, provider, mediaType, selection]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const importCatalog = async (providerId: "kie" | "openrouter") => {
    setImporting(providerId); setMessage(null); setError(null);
    try {
      const result = await importProviderReferenceCatalog(providerId);
      setMessage(`${providerId === "kie" ? "KIE.ai" : "OpenRouter"}: ${result.modelCount} official models imported.`);
      await Promise.all([modelsQuery.refetch(), snapshotsQuery.refetch()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Catalog import failed.");
    } finally { setImporting(null); }
  };

  const changeSelection = async (referenceModelId: string, selected: boolean) => {
    setChangingModel(referenceModelId); setMessage(null); setError(null);
    try {
      if (selected) await selectReferenceModel(referenceModelId);
      else await unselectReferenceModel(referenceModelId);
      setMessage(selected ? "Model selected. It is now ready for pricing." : "Model removed from the pricing workspace.");
      await modelsQuery.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Model selection failed.");
    } finally { setChangingModel(null); }
  };

  const canImport = capabilitiesQuery.data?.permissions.catalog.import === true;
  return <div className="space-y-6">
    <ModelPresentationDialog model={presentationModel} onOpenChange={(open) => { if (!open) setPresentationModel(null); }} onSaved={async () => { await modelsQuery.refetch(); setMessage("Customer presentation saved as an immutable reviewed model revision."); }} />
    <AdminPageHeader eyebrow="AI GATEWAY" title="Models" description="Browse official provider catalogs, choose what FusionLab may offer, and keep customer activation separate." />
    <AdminSection title="Official catalog intake" description="These actions read public provider documentation only. They never generate media and never consume provider credits.">
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="text-sm font-medium text-white">Refresh model catalogs</p><p className="mt-1 text-sm text-slate-400">Run manually when you want a new immutable source snapshot.</p></div>
        {canImport ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={Boolean(importing)} onClick={() => void importCatalog("kie")}>{importing === "kie" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Import KIE.ai</Button><Button type="button" variant="outline" disabled={Boolean(importing)} onClick={() => void importCatalog("openrouter")}>{importing === "openrouter" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Import OpenRouter</Button></div>
          : <div className="flex max-w-md items-start gap-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.07] p-3 text-sm text-amber-100"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>Super Admin permission is required to import a provider catalog.</span></div>}
      </div>
      {message ? <p role="status" className="border-t border-white/[0.08] px-5 py-3 text-sm text-emerald-200">{message}</p> : null}
      {error ? <p role="alert" className="border-t border-white/[0.08] px-5 py-3 text-sm text-rose-200">{error}</p> : null}
    </AdminSection>
    <AdminSection title="Available models" description="Available means discovered from an official source. It does not make a model visible to customers or authorize generation.">
      <div className="flex flex-col gap-3 border-b border-white/[0.08] p-4 xl:flex-row xl:items-center xl:justify-between"><div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_170px_150px_150px]"><label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search models" className="h-10 w-full rounded-lg border border-white/[0.1] bg-[#0b0d10] pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20" /></label><select value={provider} onChange={(event) => setProvider(event.target.value)} className="h-10 rounded-lg border border-white/[0.1] bg-[#0b0d10] px-3 text-sm text-slate-200 outline-none focus:border-violet-400/60"><option value="all">All providers</option>{providers.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select><select value={mediaType} onChange={(event) => setMediaType(event.target.value)} className="h-10 rounded-lg border border-white/[0.1] bg-[#0b0d10] px-3 text-sm text-slate-200 outline-none focus:border-violet-400/60"><option value="all">All media</option><option value="image">Images</option><option value="video">Video</option><option value="text">Text</option><option value="audio">Audio</option></select><select value={selection} onChange={(event) => setSelection(event.target.value)} className="h-10 rounded-lg border border-white/[0.1] bg-[#0b0d10] px-3 text-sm text-slate-200 outline-none focus:border-violet-400/60"><option value="all">All states</option><option value="selected">Selected</option><option value="available">Available</option></select></div><span className="shrink-0 text-xs text-slate-500">{models.length} shown · {modelsQuery.data?.length ?? 0} total</span></div>
      {modelsQuery.isLoading ? <AdminLoadingState /> : modelsQuery.isError ? <AdminErrorState message="Reference models could not be loaded." onRetry={() => void modelsQuery.refetch()} /> : models.length ? <><TableFrame><thead className="border-b border-white/[0.08] bg-white/[0.025] text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-medium">Model</th><th className="py-3 font-medium">Provider</th><th className="py-3 font-medium">Type</th><th className="py-3 font-medium">Customer label</th><th className="py-3 font-medium">State</th><th className="py-3 font-medium">Observed</th><th className="px-5 py-3 text-right font-medium">Action</th></tr></thead><tbody>{visibleModels.map((model) => <tr key={model.id} className="border-b border-white/[0.06] last:border-0"><td className="max-w-80 px-5 py-3"><p className="truncate font-medium text-white">{model.displayName}</p><p className="mt-0.5 truncate text-xs text-slate-500">{model.providerModelId}</p></td><td className="py-3 text-sm text-slate-300">{model.providerId}<span className="mt-0.5 block text-xs text-slate-500">{model.familyId}</span></td><td className="py-3"><div className="flex flex-wrap gap-1">{model.modalities.map((modality) => <span key={modality} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-slate-300">{modality}</span>)}</div></td><td className="py-3 text-xs text-slate-300">{model.reviewedTaxonomy ? <><p>{model.reviewedTaxonomy.productFamily.displayName}{model.reviewedTaxonomy.version ? ` · ${model.reviewedTaxonomy.version.displayName}` : ""}{model.reviewedTaxonomy.edition ? ` · ${model.reviewedTaxonomy.edition.displayName}` : ""}</p><p className="mt-1 text-[11px] text-emerald-300">Reviewed · {model.reviewedTaxonomy.experienceCategories.join(" / ")}</p></> : <span className="text-slate-500">Not reviewed</span>}</td><td className="py-3"><StatusBadge status={model.selectionState === "SELECTED" ? "SELECTED" : "AVAILABLE"} /></td><td className="py-3 text-xs text-slate-500">{formatAdminDate(model.observedAt)}</td><td className="px-5 py-3 text-right"><div className="flex justify-end gap-2">{capabilitiesQuery.data?.permissions.catalog.select ? <Button type="button" size="sm" variant="ghost" onClick={() => setPresentationModel(model)}>Present</Button> : null}{capabilitiesQuery.data?.permissions.catalog.select ? <Button type="button" size="sm" variant={model.selectionState === "SELECTED" ? "ghost" : "outline"} disabled={Boolean(changingModel)} onClick={() => void changeSelection(model.id, model.selectionState !== "SELECTED")}>{changingModel === model.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{model.selectionState === "SELECTED" ? "Remove" : "Select"}</Button> : <span className="text-xs text-slate-500">Permission required</span>}</div></td></tr>)}</tbody></TableFrame>{pageCount > 1 ? <div className="flex items-center justify-between border-t border-white/[0.08] px-5 py-4"><span className="text-xs text-slate-500">Page {page} of {pageCount}</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft />Previous</Button><Button type="button" size="sm" variant="outline" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight /></Button></div></div> : null}</> : <AdminEmptyState title={modelsQuery.data?.length ? "No matching models" : "No official catalog imported"} description={modelsQuery.data?.length ? "Try another provider or search phrase." : "Import KIE.ai or OpenRouter from the actions above."} icon={Boxes} />}
    </AdminSection>
  </div>;
}
