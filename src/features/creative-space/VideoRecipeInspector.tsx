import { useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, CircleDollarSign, ImageIcon, Info, Loader2, Plus, ShieldCheck, SlidersHorizontal, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import type { CreativeSpaceProject, SpaceAsset } from "./domain";
import type { VideoComposerDraft, VideoDraftBinding } from "./video-composer-draft";
import { getVideoRecipeManifest, videoRecipeList, type VideoBindingSlot, type VideoRecipeId } from "./video-recipes";
import { planVideoRecipeCompatibility, validateVideoComposerDraft, type VideoRecipeCompatibilityDiff } from "./video-composer-validation";
import type { ConfirmedVideoQuote, ExecutedVideoOperation, VideoQuote } from "./video-quote-client";
import { reconcilePublishedOfferSettings, type PublishedOffer } from "./published-offers-client";

type Props = {
  offers: ReadonlyArray<PublishedOffer>;
  project: CreativeSpaceProject;
  selectedAsset: SpaceAsset | null;
  draft: VideoComposerDraft;
  onChange: (draft: VideoComposerDraft) => void;
  onClose: () => void;
  quote: VideoQuote | null;
  confirmation: ConfirmedVideoQuote | null;
  quoteLoading: boolean;
  confirmLoading: boolean;
  execution: ExecutedVideoOperation | null;
  executionLoading: boolean;
  onRequestQuote: () => void;
  onConfirmQuote: () => void;
  onRunOperation: () => void;
};

const slotLabels: Record<VideoBindingSlot, string> = {
  FIRST_FRAME: "الإطار الأول",
  LAST_FRAME: "الإطار الأخير",
  REFERENCE: "مرجع",
};

export function VideoRecipeInspector({ offers, project, selectedAsset, draft, onChange, onClose, quote, confirmation, quoteLoading, confirmLoading, execution, executionLoading, onRequestQuote, onConfirmQuote, onRunOperation }: Props) {
  const [compatibility, setCompatibility] = useState<VideoRecipeCompatibilityDiff | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const manifest = getVideoRecipeManifest(draft.recipeId);
  const selectedOffer = offers.find((offer) => offer.offerId === draft.offerId) ?? null;
  const publishedRecipe = selectedOffer?.capability.controlSchema.recipes.find((recipe) => recipe.recipeId === draft.recipeId) ?? null;
  const bindingBounds = publishedRecipe?.bindings ?? manifest.bindings;
  const validation = validateVideoComposerDraft(draft, project, undefined, selectedOffer);
  const readyForQuote = validation.valid && !!draft.offerId;
  const operationLocked = !!confirmation && !execution;
  const promptVisible = publishedRecipe?.prompt.visible ?? true;
  const promptMaxLength = publishedRecipe?.prompt.maxLength ?? 1_200;
  const publishedRecipeIds = new Set(offers.flatMap((offer) => offer.capability.controlSchema.recipes.map((recipe) => recipe.recipeId)));
  const availableRecipes = offers.length ? videoRecipeList.filter((recipe) => publishedRecipeIds.has(recipe.id)) : videoRecipeList;
  const update = (patch: Partial<VideoComposerDraft>) => onChange({ ...draft, ...patch, updatedAt: new Date().toISOString() });
  const slotForOrdinal = (ordinal: number): VideoBindingSlot | undefined => {
    const slot = publishedRecipe
      ? (publishedRecipe.bindings.roles.length === 1 ? publishedRecipe.bindings.roles[0] : publishedRecipe.bindings.roles[ordinal])
      : (manifest.bindings.slots.length === 1 ? manifest.bindings.slots[0] : manifest.bindings.slots[ordinal]);
    return slot as VideoBindingSlot | undefined;
  };
  const slotLabel = (slot: string | undefined) => slot ? (slotLabels[slot as VideoBindingSlot] ?? slot) : "دور غير متاح";
  const boundIds = new Set(draft.bindings.map(({ assetId }) => assetId));
  const candidate = selectedAsset?.kind === "IMAGE" && selectedAsset.status === "READY" && !boundIds.has(selectedAsset.id)
    ? selectedAsset
    : null;
  const requestRecipeChange = (recipeId: VideoRecipeId) => {
    if (recipeId === draft.recipeId) return;
    const diff = planVideoRecipeCompatibility(draft, recipeId, candidate?.id ?? null);
    if (!diff.changes.length) onChange(diff.nextDraft);
    else setCompatibility(diff);
  };

  const addCandidate = () => {
    if (!candidate || draft.bindings.length >= bindingBounds.max) return;
    const ordinal = draft.bindings.length;
    const slot = slotForOrdinal(ordinal);
    if (!slot) return;
    update({ bindings: [...draft.bindings, { assetId: candidate.id, slot, ordinal }] });
  };

  const removeBinding = (binding: VideoDraftBinding) => {
    const remaining = draft.bindings.filter((item) => item !== binding).map((item, ordinal) => ({
      ...item,
      ordinal,
      slot: slotForOrdinal(ordinal) ?? item.slot,
    }));
    update({ bindings: remaining });
  };

  return (
    <div className="flex h-full flex-col" data-testid="video-recipe-composer">
      <div className="border-b border-white/10 px-5 py-4">
        <button className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={operationLocked} onClick={onClose}><ArrowRight className="h-3.5 w-3.5" />{operationLocked ? "أكمل العملية قبل الإغلاق" : "العودة للوصفات"}</button>
        <p className="text-[10px] uppercase tracking-[.18em] text-muted-foreground">{manifest.actionLabel} · Stage 11.3</p>
        <h2 className="mt-1 text-lg font-bold">{manifest.label}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{manifest.description}</p>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <section>
          <Label className="text-xs">الوصفة</Label>
          <Select value={draft.recipeId} disabled={operationLocked} onValueChange={(recipeId: VideoRecipeId) => requestRecipeChange(recipeId)}><SelectTrigger className="mt-2 bg-white/[.03]" aria-label="تغيير وصفة الفيديو"><SelectValue /></SelectTrigger><SelectContent>{availableRecipes.map((recipe) => <SelectItem key={recipe.id} value={recipe.id}>{recipe.label}</SelectItem>)}</SelectContent></Select>
          <p className="mt-1.5 text-[10px] text-muted-foreground">أي Binding سيُحذف أو يتغير دوره يظهر في Compatibility Diff قبل التطبيق.</p>
        </section>

        {bindingBounds.max > 0 && <section>
          <div className="flex items-center justify-between"><Label className="text-xs">المدخلات</Label><span className="text-[10px] text-muted-foreground">{draft.bindings.length}/{bindingBounds.max}</span></div>
          <div className="mt-2 space-y-2">
            {draft.bindings.map((binding) => {
              const asset = project.assets[binding.assetId];
              return <div key={`${binding.slot}-${binding.ordinal}`} className="flex items-center gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3"><ImageIcon className="h-4 w-4 text-sky-300" /><span className="min-w-0 flex-1"><span className="block text-[10px] text-muted-foreground">{slotLabel(binding.slot)}{binding.slot === "REFERENCE" ? ` · @image${binding.ordinal + 1}` : ""}</span><span className="block truncate text-xs font-bold">{asset?.name ?? "Asset missing"}</span></span><button aria-label={`إزالة ${slotLabel(binding.slot)}`} disabled={operationLocked} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40" onClick={() => removeBinding(binding)}><Trash2 className="h-3.5 w-3.5" /></button></div>;
            })}
            {!draft.bindings.length && <div className="rounded-xl border border-dashed border-white/15 p-4 text-center text-xs text-muted-foreground">حدد صورة من المساحة ثم اربطها بالدور المطلوب.</div>}
          </div>
          {candidate && draft.bindings.length < bindingBounds.max && slotForOrdinal(draft.bindings.length) && <Button variant="outline" size="sm" className="mt-2 w-full gap-2" disabled={operationLocked} onClick={addCandidate}><Plus className="h-3.5 w-3.5" />ربط {candidate.name} كـ{slotLabel(slotForOrdinal(draft.bindings.length))}</Button>}
        </section>}

        {promptVisible && <section><div className="mb-2 flex items-center justify-between"><Label htmlFor="video-recipe-prompt" className="text-xs">Prompt</Label><span className="text-[10px] text-muted-foreground">{draft.prompt.length}/{promptMaxLength}</span></div><Textarea id="video-recipe-prompt" autoFocus value={draft.prompt} disabled={operationLocked} maxLength={promptMaxLength} rows={5} placeholder={manifest.prompt.placeholder} className="resize-none bg-white/[.03] text-sm leading-6" onChange={(event) => update({ prompt: event.target.value })} /></section>}

        <section><Label className="text-xs">النموذج المنشور</Label><Select value={draft.offerId ?? undefined} disabled={operationLocked} onValueChange={(offerId) => { const offer = offers.find((candidate) => candidate.offerId === offerId); const settings = offer ? reconcilePublishedOfferSettings(offer, draft.recipeId, draft.settings) : null; if (offer && settings) update({ offerId, modelId: offer.providerModelId, settings }); }}><SelectTrigger className="mt-2 bg-white/[.03]" aria-label="اختيار نموذج الفيديو المنشور"><SelectValue placeholder={offers.length ? "اختر نموذج فيديو منشوراً" : "لا توجد عروض فيديو منشورة"} /></SelectTrigger><SelectContent>{offers.filter((offer) => offer.capability.controlSchema.recipes.some((recipe) => recipe.recipeId === draft.recipeId)).map((offer) => <SelectItem key={offer.offerId} value={offer.offerId}>{offer.displayName} · {offer.providerId}</SelectItem>)}</SelectContent></Select><p className="mt-1.5 text-[10px] text-muted-foreground">يحدد العرض المنشور السعر والمسار؛ لا يقرر المتصفح الموديل التنفيذي.</p></section>

        {publishedRecipe ? <section className="space-y-4"><div className="flex items-center gap-2"><SlidersHorizontal className="h-3.5 w-3.5" /><Label className="text-xs">الإعدادات المنشورة</Label></div>{publishedRecipe.controls.map((control) => {
          const label = manifest.settings.find((setting) => setting.id === control.id)?.label ?? control.id;
          const value = draft.settings[control.id] ?? control.defaultValue;
          if (control.kind === "enum" || control.kind === "boolean") return <div key={control.id}><Label className="text-[11px] text-muted-foreground">{label}</Label><Select value={String(value)} disabled={operationLocked} onValueChange={(next) => { const resolved = control.values?.find((option) => String(option) === next) ?? next; update({ settings: { ...draft.settings, [control.id]: resolved } }); }}><SelectTrigger className="mt-1.5 bg-white/[.03]" aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{(control.values ?? []).map((option) => <SelectItem key={String(option)} value={String(option)}>{typeof option === "boolean" ? option ? "مفعّل" : "غير مفعّل" : String(option)}</SelectItem>)}</SelectContent></Select></div>;
          return <div key={control.id}><div className="mb-2 flex items-center justify-between"><Label className="text-[11px] text-muted-foreground">{label}</Label><span className="text-xs tabular-nums">{Number(value)}</span></div><Slider value={[Number(value)]} min={control.min ?? 0} max={control.max ?? 100} step={control.step ?? 1} disabled={operationLocked} onValueChange={([next]) => update({ settings: { ...draft.settings, [control.id]: next } })} /></div>;
        })}</section> : <section className="space-y-3"><Label className="text-xs">الإعدادات</Label>{manifest.settings.map((setting) => <div key={setting.id}><Label className="text-[11px] text-muted-foreground">{setting.label}</Label><Select value={String(draft.settings[setting.id])} disabled={operationLocked} onValueChange={(value) => {
          const original = setting.options.find((option) => String(option) === value) ?? setting.defaultValue;
          update({ settings: { ...draft.settings, [setting.id]: original } });
        }}><SelectTrigger className="mt-1.5 bg-white/[.03]" aria-label={setting.label}><SelectValue /></SelectTrigger><SelectContent>{setting.options.map((option) => <SelectItem key={String(option)} value={String(option)}>{typeof option === "boolean" ? option ? "مفعّل" : "غير مفعّل" : setting.id === "durationSeconds" ? `${option} ثوانٍ` : String(option)}</SelectItem>)}</SelectContent></Select></div>)}</section>}
        <section className={`rounded-xl border p-3 ${readyForQuote ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"}`} data-testid="video-composer-validation"><div className="flex items-center gap-2">{readyForQuote ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertCircle className="h-4 w-4 text-amber-300" />}<p className="text-xs font-bold">{readyForQuote ? "الـBindings والعرض المنشور والإعدادات صالحة" : `${validation.issues.length + (draft.offerId ? 0 : 1)} متطلبات تحتاج معالجة`}</p></div>{!readyForQuote && <ul className="mt-2 space-y-1.5">{!draft.offerId && <li className="flex gap-2 text-[11px] leading-5 text-amber-100/80"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-300" /><span>اختر نموذج فيديو منشوراً ومفعّلاً.</span></li>}{validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`} className="flex gap-2 text-[11px] leading-5 text-amber-100/80"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-300" /><span>{issue.message}</span></li>)}</ul>}</section>
      </div>
      <div className="border-t border-white/10 p-4"><div className="rounded-xl bg-white/5 p-3">
        <div className="flex items-center justify-between text-xs"><span>Video billing</span><span className={execution?.operation.state === "SETTLED" ? "text-emerald-400" : readyForQuote ? "text-sky-300" : "text-amber-300"}>{execution?.operation.state === "SETTLED" ? "تمت التسوية" : readyForQuote ? "جاهزة للتسعير" : "غير مكتملة"}</span></div>
        {quote && <div className="mt-3 space-y-1.5 rounded-lg border border-white/10 bg-black/20 p-3 text-[11px]" data-testid="video-quote-summary"><div className="flex justify-between"><span>سعر الموقع</span><strong>{quote.customerCredits} كريديت</strong></div><p className="border-t border-white/10 pt-2 text-muted-foreground">لن يُحجز أي رصيد قبل تأكيدك.</p></div>}
        {confirmation && <div className={`mt-3 rounded-lg border p-3 text-[11px] ${execution?.operation.state === "SETTLED" ? "border-emerald-500/20 bg-emerald-500/5" : "border-violet-500/20 bg-violet-500/5"}`} data-testid="video-operation-financials"><div className={`flex items-center gap-2 font-bold ${execution?.operation.state === "SETTLED" ? "text-emerald-300" : "text-violet-200"}`}><ShieldCheck className="h-4 w-4" />{execution?.operation.state === "SETTLED" ? "اكتمل الفيديو والتسوية" : "تم حجز رصيد الموقع"}</div><p className="mt-2 text-muted-foreground">Operation <span className="font-mono text-foreground">{confirmation.operation.id.slice(0, 8)}</span> · {execution?.operation.state ?? confirmation.operation.state}</p><p className="mt-1">{execution ? `مدفوع: ${execution.operation.financials.customerChargedCredits} كريديت` : confirmation.wallet ? `محجوز: ${confirmation.wallet.customerCredits.held}` : `تم حجز ${confirmation.operation.financials.customerQuotedCredits} كريديت`}</p>{execution?.operation.assetChecksumSha256 && <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">SHA-256 {execution.operation.assetChecksumSha256}</p>}</div>}
        {!quote && <Button className="mt-3 w-full gap-2" disabled={!readyForQuote || quoteLoading} onClick={onRequestQuote}>{quoteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}{readyForQuote ? "احسب السعر النهائي" : "أكمل المتطلبات للمتابعة"}</Button>}
        {quote && !confirmation && <Button className="mt-3 w-full" disabled={confirmLoading} onClick={() => setConfirmOpen(true)}>{confirmLoading ? "جارٍ الحجز..." : `تأكيد وحجز ${quote.customerCredits} كريديت`}</Button>}
        {confirmation && !execution && <Button className="mt-3 w-full gap-2" disabled><Loader2 className="h-4 w-4 animate-spin" />المحرك ينفذ الفيديو تلقائياً...</Button>}
        {execution?.operation.state === "SETTLED" && <Button className="mt-3 w-full" disabled>Video Output جاهز على المساحة</Button>}
      </div></div>
      <Dialog open={!!compatibility} onOpenChange={(open) => !open && setCompatibility(null)}><DialogContent className="max-w-md" dir="rtl"><DialogHeader><DialogTitle>Video Compatibility Diff</DialogTitle><DialogDescription>{compatibility?.canApply ? `راجع التغييرات قبل الانتقال إلى ${getVideoRecipeManifest(compatibility.toRecipeId).label}. لن يُسقط أي Binding بصمت.` : `لا يمكن الانتقال إلى ${compatibility ? getVideoRecipeManifest(compatibility.toRecipeId).label : "الوصفة"} بالمدخلات الحالية.`}</DialogDescription></DialogHeader><div className="space-y-2">{compatibility?.changes.map((change, index) => <div key={`${change.code}-${index}`} className={`flex gap-3 rounded-xl border p-3 ${change.severity === "BLOCKING" ? "border-destructive/30 bg-destructive/10" : change.severity === "WARNING" ? "border-amber-500/25 bg-amber-500/10" : "border-sky-500/20 bg-sky-500/5"}`}>{change.severity === "BLOCKING" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : change.severity === "WARNING" ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />}<div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{change.severity}</p><p className="mt-1 text-xs leading-5">{change.message}</p></div></div>)}</div><DialogFooter className="gap-2 sm:gap-0"><Button variant="outline" onClick={() => setCompatibility(null)}>إلغاء</Button>{compatibility?.canApply && <Button onClick={() => { onChange(compatibility.nextDraft); setCompatibility(null); }}>تطبيق التغيير بوضوح</Button>}</DialogFooter></DialogContent></Dialog>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent className="max-w-md" dir="rtl"><DialogHeader><DialogTitle>تأكيد سعر الفيديو والحجز</DialogTitle><DialogDescription>التأكيد يحجز الرصيد مرة واحدة ثم يبدأ المحرك التنفيذ تلقائياً. لا تتم التسوية إلا بعد استلام ملف MP4 موثق.</DialogDescription></DialogHeader>{quote && <div className="space-y-2 rounded-xl border border-white/10 bg-white/[.03] p-4 text-sm"><div className="flex justify-between"><span>سعر الموقع</span><strong>{quote.customerCredits} كريديت</strong></div><div className="flex justify-between text-muted-foreground"><span>حالة الخصم الحالية</span><span>لن يُخصم شيء قبل التأكيد</span></div></div>}<DialogFooter className="gap-2 sm:gap-0"><Button variant="outline" onClick={() => setConfirmOpen(false)}>إلغاء</Button><Button disabled={confirmLoading} onClick={() => { onConfirmQuote(); setConfirmOpen(false); }}>{confirmLoading ? "جارٍ التأكيد..." : `تأكيد وحجز ${quote?.customerCredits ?? 0}`}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
