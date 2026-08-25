import { useState } from "react";
import { AlertCircle, ArrowRight, CircleDollarSign, FileAudio2, FileVideo2, Link2, Loader2, Plus, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import type { AdvancedComposerDraft, AdvancedDraftBinding } from "./advanced-composer-draft";
import { validateAdvancedComposerDraft } from "./advanced-composer-validation";
import { getAdvancedRecipeManifest } from "./advanced-recipes";
import type { ConfirmedAdvancedQuote, ExecutedAdvancedOperation, AdvancedQuote } from "./advanced-quote-client";
import type { CreativeSpaceProject, SpaceAsset } from "./domain";
import { reconcilePublishedOfferSettings, type PublishedOffer } from "./published-offers-client";

type Props = {
  offers: ReadonlyArray<PublishedOffer>;
  project: CreativeSpaceProject;
  selectedAsset: SpaceAsset | null;
  draft: AdvancedComposerDraft;
  onChange: (draft: AdvancedComposerDraft) => void;
  onClose: () => void;
  quote: AdvancedQuote | null;
  confirmation: ConfirmedAdvancedQuote | null;
  execution: ExecutedAdvancedOperation | null;
  quoteLoading: boolean;
  confirmLoading: boolean;
  executionLoading: boolean;
  onRequestQuote: () => void;
  onConfirmQuote: () => void;
  onRunOperation: () => void;
};

export function AdvancedRecipeInspector({ offers, project, selectedAsset, draft, onChange, onClose, quote, confirmation, execution, quoteLoading, confirmLoading, executionLoading, onRequestQuote, onConfirmQuote, onRunOperation }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const manifest = getAdvancedRecipeManifest(draft.recipeId);
  const selectedOffer = offers.find((offer) => offer.offerId === draft.offerId) ?? null;
  const publishedRecipe = selectedOffer?.capability.controlSchema.recipes.find((recipe) => recipe.recipeId === draft.recipeId) ?? null;
  const bindingSlots = publishedRecipe?.bindings.slots ?? manifest.bindings;
  const validation = validateAdvancedComposerDraft(draft, project, selectedOffer);
  const readyForQuote = validation.valid && !!draft.offerId;
  const operationLocked = !!confirmation && !execution;
  const boundRoles = new Set(draft.bindings.map(({ role }) => role));
  const candidateSlot = selectedAsset
    ? bindingSlots.find(({ role, kind }) => !boundRoles.has(role as AdvancedDraftBinding["role"]) && kind === selectedAsset.kind)
    : null;
  const prompt = publishedRecipe?.prompt ?? { required: manifest.prompt.required, visible: true, maxLength: manifest.prompt.maxLength };
  const slotLabel = (slot: { role: string; kind: string; required: boolean }) => manifest.bindings.find((candidate) => candidate.role === slot.role)?.label ?? slot.role;
  const update = (patch: Partial<AdvancedComposerDraft>) => onChange({ ...draft, ...patch, updatedAt: new Date().toISOString() });

  const addCandidate = () => {
    if (!selectedAsset || !candidateSlot || selectedAsset.status !== "READY") return;
    const ordinal = bindingSlots.findIndex(({ role }) => role === candidateSlot.role);
    const next = [...draft.bindings, { assetId: selectedAsset.id, role: candidateSlot.role as AdvancedDraftBinding["role"], ordinal }]
      .sort((left, right) => left.ordinal - right.ordinal);
    update({ bindings: next });
  };

  const removeBinding = (binding: AdvancedDraftBinding) => update({ bindings: draft.bindings.filter((item) => item !== binding) });
  const OutputIcon = manifest.outputKind === "AUDIO" ? FileAudio2 : FileVideo2;

  return (
    <div className="flex h-full flex-col" data-testid="advanced-recipe-composer">
      <div className="border-b border-white/10 px-5 py-4">
        <button className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50" disabled={operationLocked} onClick={onClose}><ArrowRight className="h-3.5 w-3.5" />{operationLocked ? "أكمل العملية قبل الإغلاق" : "العودة للوصفات"}</button>
        <p className="text-[10px] uppercase tracking-[.18em] text-muted-foreground">{manifest.actionLabel} · Stage 11.4</p>
        <h2 className="mt-1 flex items-center gap-2 text-lg font-bold"><OutputIcon className="h-5 w-5" />{manifest.label}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{manifest.description}</p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {!!bindingSlots.length && <section>
          <Label className="text-xs">Bindings</Label>
          <div className="mt-2 space-y-2">{bindingSlots.map((slot, ordinal) => {
            const binding = draft.bindings.find(({ role }) => role === slot.role);
            const asset = binding ? project.assets[binding.assetId] : null;
            return <div key={slot.role} className={`flex items-center gap-2 rounded-xl border p-3 ${binding ? "border-sky-500/20 bg-sky-500/5" : slot.required ? "border-dashed border-amber-500/25 bg-amber-500/5" : "border-dashed border-white/10"}`}><Link2 className={`h-4 w-4 ${binding ? "text-sky-300" : "text-muted-foreground"}`} /><span className="min-w-0 flex-1"><span className="block text-[10px] text-muted-foreground">{slotLabel(slot)} · {slot.kind}{slot.required ? " · مطلوب" : " · اختياري"}</span><span className="block truncate text-xs font-bold">{asset?.name ?? "غير مربوط"}</span></span>{binding && <button aria-label={`إزالة ${slotLabel(slot)}`} disabled={operationLocked} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-40" onClick={() => removeBinding(binding)}><Trash2 className="h-3.5 w-3.5" /></button>}<span className="text-[9px] text-muted-foreground">#{ordinal + 1}</span></div>;
          })}</div>
          {selectedAsset && candidateSlot && selectedAsset.status === "READY" && <Button variant="outline" size="sm" className="mt-2 w-full gap-2" disabled={operationLocked} onClick={addCandidate}><Plus className="h-3.5 w-3.5" />ربط {selectedAsset.name} كـ{slotLabel(candidateSlot)}</Button>}
        </section>}

        {prompt.visible && <section><div className="mb-2 flex items-center justify-between"><Label htmlFor="advanced-prompt" className="text-xs">{manifest.prompt.label}{prompt.required ? "" : " · اختياري"}</Label><span className="text-[10px] text-muted-foreground">{draft.prompt.length}/{prompt.maxLength}</span></div><Textarea id="advanced-prompt" autoFocus value={draft.prompt} disabled={operationLocked} maxLength={prompt.maxLength} rows={manifest.outputKind === "AUDIO" ? 7 : 4} placeholder={manifest.prompt.placeholder} className="resize-none bg-white/[.03] text-sm leading-6" onChange={(event) => update({ prompt: event.target.value })} /></section>}

        <section><Label className="text-xs">النموذج المنشور</Label><Select value={draft.offerId ?? undefined} disabled={operationLocked} onValueChange={(offerId) => { const offer = offers.find((candidate) => candidate.offerId === offerId); const settings = offer ? reconcilePublishedOfferSettings(offer, draft.recipeId, draft.settings) : null; if (offer && settings) update({ offerId, modelId: offer.providerModelId, settings }); }}><SelectTrigger className="mt-2 bg-white/[.03]" aria-label="اختيار الموديل المتقدم المنشور"><SelectValue placeholder={offers.length ? "اختر نموذجاً منشوراً" : "لا توجد عروض منشورة"} /></SelectTrigger><SelectContent>{offers.filter((offer) => offer.capability.controlSchema.recipes.some((recipe) => recipe.recipeId === draft.recipeId)).map((offer) => <SelectItem key={offer.offerId} value={offer.offerId}>{offer.displayName} · {offer.providerId}</SelectItem>)}</SelectContent></Select><p className="mt-1.5 text-[10px] text-muted-foreground">العرض المنشور يثبت الموديل والسعر والمسار في الخادم قبل الحجز.</p></section>

        {publishedRecipe ? <section className="space-y-4"><div className="flex items-center gap-2"><SlidersHorizontal className="h-3.5 w-3.5" /><Label className="text-xs">الإعدادات المنشورة</Label></div>{publishedRecipe.controls.map((control) => {
          const label = manifest.settings.find((setting) => setting.id === control.id)?.label ?? control.id;
          const value = draft.settings[control.id] ?? control.defaultValue;
          if (control.kind === "enum" || control.kind === "boolean") return <div key={control.id}><Label className="text-[11px] text-muted-foreground">{label}</Label><Select value={String(value)} disabled={operationLocked} onValueChange={(next) => { const resolved = control.values?.find((option) => String(option) === next) ?? next; update({ settings: { ...draft.settings, [control.id]: resolved } }); }}><SelectTrigger className="mt-1.5 bg-white/[.03]" aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{(control.values ?? []).map((option) => <SelectItem key={String(option)} value={String(option)}>{typeof option === "boolean" ? option ? "مفعّل" : "غير مفعّل" : String(option)}</SelectItem>)}</SelectContent></Select></div>;
          return <div key={control.id}><div className="mb-2 flex items-center justify-between"><Label className="text-[11px] text-muted-foreground">{label}</Label><span className="text-xs tabular-nums">{Number(value)}</span></div><Slider value={[Number(value)]} min={control.min ?? 0} max={control.max ?? 100} step={control.step ?? 1} disabled={operationLocked} onValueChange={([next]) => update({ settings: { ...draft.settings, [control.id]: next } })} /></div>;
        })}</section> : <section className="space-y-3"><Label className="text-xs">الإعدادات</Label>{manifest.settings.map((setting) => <div key={setting.id}><Label className="text-[11px] text-muted-foreground">{setting.label}</Label><Select value={String(draft.settings[setting.id])} disabled={operationLocked || setting.options.length === 1} onValueChange={(value) => {
          const original = setting.options.find((option) => String(option) === value) ?? setting.defaultValue;
          update({ settings: { ...draft.settings, [setting.id]: original } });
        }}><SelectTrigger className="mt-1.5 bg-white/[.03]" aria-label={setting.label}><SelectValue /></SelectTrigger><SelectContent>{setting.options.map((option) => <SelectItem key={String(option)} value={String(option)}>{typeof option === "boolean" ? option ? "مفعّل" : "غير مفعّل" : setting.id === "durationSeconds" ? `${option} ثوانٍ` : setting.id === "speed" ? `${option}x` : String(option)}</SelectItem>)}</SelectContent></Select></div>)}</section>}

        <section className={`rounded-xl border p-3 ${readyForQuote ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"}`} data-testid="advanced-composer-validation"><div className="flex items-center gap-2"><AlertCircle className={`h-4 w-4 ${readyForQuote ? "text-emerald-400" : "text-amber-300"}`} /><p className="text-xs font-bold">{readyForQuote ? "الوصفة والـBindings والعرض المنشور صالحة للتسعير" : `${validation.issues.length + (draft.offerId ? 0 : 1)} متطلبات تحتاج معالجة`}</p></div>{!readyForQuote && <ul className="mt-2 space-y-1">{!draft.offerId && <li className="text-[11px] leading-5 text-amber-100/80">• اختر نموذجاً منشوراً ومفعّلاً.</li>}{validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`} className="text-[11px] leading-5 text-amber-100/80">• {issue.message}</li>)}</ul>}</section>
      </div>

      <div className="border-t border-white/10 p-4"><div className="rounded-xl bg-white/5 p-3">
        <div className="flex items-center justify-between text-xs"><span>Offer billing</span><span className={execution?.operation.state === "SETTLED" ? "text-emerald-400" : readyForQuote ? "text-sky-300" : "text-amber-300"}>{execution?.operation.state === "SETTLED" ? "تمت التسوية" : readyForQuote ? "جاهز" : "غير مكتمل"}</span></div>
        {quote && <div className="mt-3 space-y-1.5 rounded-lg border border-white/10 bg-black/20 p-3 text-[11px]" data-testid="advanced-quote-summary"><div className="flex justify-between"><span>سعر الموقع</span><strong>{quote.customerCredits} كريديت</strong></div><p className="border-t border-white/10 pt-2 text-muted-foreground">لن يُحجز أي رصيد قبل تأكيدك.</p></div>}
        {confirmation && <div className={`mt-3 rounded-lg border p-3 text-[11px] ${execution?.operation.state === "SETTLED" ? "border-emerald-500/20 bg-emerald-500/5" : "border-violet-500/20 bg-violet-500/5"}`} data-testid="advanced-operation-financials"><div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4" />{execution?.operation.state === "SETTLED" ? "اكتملت النتيجة والتسوية" : "تم حجز رصيد الموقع"}</div><p className="mt-2">{execution ? `مدفوع: ${execution.operation.financials.customerChargedCredits} كريديت` : confirmation.wallet ? `محجوز: ${confirmation.wallet.customerCredits.held}` : `تم حجز ${confirmation.operation.financials.customerQuotedCredits} كريديت`}</p>{execution?.operation.assetChecksumSha256 && <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">SHA-256 {execution.operation.assetChecksumSha256}</p>}</div>}
        {!quote && <Button className="mt-3 w-full gap-2" disabled={!readyForQuote || quoteLoading} onClick={onRequestQuote}>{quoteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}{readyForQuote ? "احسب السعر النهائي" : "أكمل المتطلبات"}</Button>}
        {quote && !confirmation && <Button className="mt-3 w-full" disabled={confirmLoading} onClick={() => setConfirmOpen(true)}>{confirmLoading ? "جارٍ الحجز..." : `تأكيد وحجز ${quote.customerCredits} كريديت`}</Button>}
        {confirmation && !execution && <Button className="mt-3 w-full gap-2" disabled><Loader2 className="h-4 w-4 animate-spin" />المحرك ينفذ تلقائياً...</Button>}
        {execution?.operation.state === "SETTLED" && <Button className="mt-3 w-full" disabled>{manifest.outputKind} Output جاهز على المساحة</Button>}
      </div></div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent className="max-w-md" dir="rtl"><DialogHeader><DialogTitle>تأكيد السعر والحجز</DialogTitle><DialogDescription>سيُحجز رصيد الموقع مرة واحدة ثم يبدأ المحرك التنفيذ تلقائياً. لا تتم التسوية إلا بعد التحقق من الملف الناتج.</DialogDescription></DialogHeader>{quote && <div className="space-y-2 rounded-xl border border-white/10 bg-white/[.03] p-4 text-sm"><div className="flex justify-between"><span>سعر الموقع</span><strong>{quote.customerCredits}</strong></div><div className="flex justify-between text-muted-foreground"><span>حالة الخصم الحالية</span><span>لن يُخصم شيء قبل التأكيد</span></div></div>}<DialogFooter className="gap-2 sm:gap-0"><Button variant="outline" onClick={() => setConfirmOpen(false)}>إلغاء</Button><Button disabled={confirmLoading} onClick={() => { onConfirmQuote(); setConfirmOpen(false); }}>{confirmLoading ? "جارٍ التأكيد..." : `تأكيد وحجز ${quote?.customerCredits ?? 0}`}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
