import { useState } from "react";
import { AlertCircle, ArrowRight, Check, ChevronLeft, CircleDollarSign, Film, ImageIcon, Info, Loader2, ShieldCheck, SlidersHorizontal, Sparkles, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import type { CreativeSpaceProject, SpaceAsset, SpaceOperationState } from "./domain";
import type { ImageComposerDraft } from "./composer-draft";
import { getImageRecipeManifest, imageRecipeList, type ImageRecipeId } from "./image-recipes";
import {
  planRecipeCompatibility,
  validateImageComposerDraft,
  type RecipeCompatibilityDiff,
} from "./image-composer-validation";
import type { ConfirmedImageQuote, ExecutedImageOperation, ImageQuote } from "./image-quote-client";
import type { VideoRecipeId } from "./video-recipes";
import type { AdvancedRecipeId } from "./advanced-recipes";
import { reconcilePublishedOfferSettings, type PublishedOffer } from "./published-offers-client";

type Props = {
  offers: ReadonlyArray<PublishedOffer>;
  selectedAsset: SpaceAsset | null;
  project: CreativeSpaceProject;
  draft: ImageComposerDraft | null;
  onStart: (recipeId: ImageRecipeId) => void;
  onChange: (draft: ImageComposerDraft) => void;
  onCloseDraft: () => void;
  onViewAsset: () => void;
  onAddAsset: () => void;
  quote: ImageQuote | null;
  confirmation: ConfirmedImageQuote | null;
  quoteLoading: boolean;
  confirmLoading: boolean;
  onRequestQuote: () => void;
  onConfirmQuote: () => void;
  execution: ExecutedImageOperation | null;
  executionLoading: boolean;
  onRunOperation: () => void;
  onViewOutput: () => void;
  onStartVideo: (recipeId: VideoRecipeId) => void;
  onStartAdvanced: (recipeId: AdvancedRecipeId) => void;
};

function operationPresentation(state: SpaceOperationState) {
  if (state === "SETTLED") return { label: "اكتملت النتيجة", detail: "تم حفظ الملف وتسليمه وخصم السعر النهائي مرة واحدة.", progress: 100, tone: "success" as const };
  if (state === "PROVIDER_FAILED" || state === "DELIVERY_FAILED") return { label: "تعذرت العملية وتمت حمايتها", detail: "توقفت العملية قبل التسوية؛ راجع سجل الرصيد والعملية.", progress: 100, tone: "failure" as const };
  if (state === "RECONCILIATION_REQUIRED" || state === "SUBMISSION_UNKNOWN") return { label: "العملية قيد المراجعة الآمنة", detail: "لا تعِد الإرسال. الرصيد يبقى محميًا حتى تثبت النتيجة المالية.", progress: 70, tone: "review" as const };
  if (state === "PROVIDER_SUCCEEDED" || state === "ASSET_STORED" || state === "DELIVERED") return { label: "جاري حفظ النتيجة", detail: "نجح المزود ويجري فحص الملف وحفظه في التخزين الخاص.", progress: 85, tone: "active" as const };
  if (state === "SUBMITTED" || state === "RUNNING") return { label: "جاري التوليد", detail: "استلم المزود الطلب، ويجري تحديث الحالة تلقائيًا.", progress: 55, tone: "active" as const };
  if (state === "QUEUED" || state === "DISPATCHING") return { label: "جاري إرسال الطلب", detail: "تم تثبيت السعر والحجز، والطلب في طريقه إلى المزود.", progress: 30, tone: "active" as const };
  return { label: "تم حجز الرصيد", detail: "بدأ المحرك التنفيذ، ولا يوجد خصم نهائي قبل التسليم.", progress: 15, tone: "active" as const };
}

export function ImageRecipeInspector({ offers, selectedAsset, project, draft, onStart, onChange, onCloseDraft, onViewAsset, onAddAsset, quote, confirmation, quoteLoading, confirmLoading, onRequestQuote, onConfirmQuote, execution, executionLoading, onRunOperation, onViewOutput, onStartVideo, onStartAdvanced }: Props) {
  if (draft) return <ComposerForm offers={offers} draft={draft} project={project} boundAsset={draft.inputAssetId ? project.assets[draft.inputAssetId] ?? null : null} candidateAsset={selectedAsset} onChange={onChange} onClose={onCloseDraft} quote={quote} confirmation={confirmation} quoteLoading={quoteLoading} confirmLoading={confirmLoading} onRequestQuote={onRequestQuote} onConfirmQuote={onConfirmQuote} execution={execution} executionLoading={executionLoading} onRunOperation={onRunOperation} onViewOutput={onViewOutput} />;

  const imageSelected = selectedAsset?.kind === "IMAGE";
  const recipes = imageSelected
    ? imageRecipeList.filter(({ id }) => id !== "image.create")
    : selectedAsset ? [] : imageRecipeList.filter(({ id }) => id === "image.create");
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-5 py-5">
        <p className="text-[11px] uppercase tracking-[.18em] text-muted-foreground">Inspector · Image-first</p>
        <h2 className="mt-2 truncate text-lg font-bold">{selectedAsset ? selectedAsset.name : "ابدأ وصفة جديدة"}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{selectedAsset ? `${selectedAsset.kind} · ${selectedAsset.status}` : "اختر إنشاء صورة أو أضف أصلاً للمساحة"}</p>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <section>
          <p className="mb-2 text-xs font-bold">ماذا تريد؟</p>
          <div className="grid grid-cols-1 gap-2">
            {recipes.map((recipe) => (
              <button key={recipe.id} className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3 text-right hover:border-white/25 hover:bg-white/[.06]" onClick={() => onStart(recipe.id)}>
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/5"><Sparkles className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{recipe.label}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{recipe.description}</span></span>
                <ChevronLeft className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-x-1" />
              </button>
            ))}
            {imageSelected && <button className="group flex items-center gap-3 rounded-xl border border-sky-500/20 bg-sky-500/[.04] p-3 text-right hover:border-sky-400/40 hover:bg-sky-500/[.08]" onClick={() => onStartVideo("video.image-to-video")}><span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500/10"><Film className="h-4 w-4 text-sky-300" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold">تحريك الصورة</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">استخدامها كإطار أول ضمن Video Recipe حقيقية.</span></span><ChevronLeft className="h-4 w-4 text-muted-foreground" /></button>}
            {imageSelected && <button className="group flex items-center gap-3 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[.04] p-3 text-right hover:border-fuchsia-400/40" onClick={() => onStartAdvanced("video.avatar")}><span className="grid h-9 w-9 place-items-center rounded-lg bg-fuchsia-500/10"><Film className="h-4 w-4 text-fuchsia-300" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold">Avatar / Lip-sync</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">الصورة كـSource ثم اربط Voice Audio.</span></span><ChevronLeft className="h-4 w-4 text-muted-foreground" /></button>}
            {imageSelected && <button className="group flex items-center gap-3 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/[.04] p-3 text-right hover:border-fuchsia-400/40" onClick={() => onStartAdvanced("video.motion-control")}><span className="grid h-9 w-9 place-items-center rounded-lg bg-fuchsia-500/10"><Film className="h-4 w-4 text-fuchsia-300" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold">Motion Control</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">الصورة كهدف ثم اربط Motion Video.</span></span><ChevronLeft className="h-4 w-4 text-muted-foreground" /></button>}
            {selectedAsset?.kind === "VIDEO" && <button className="group flex items-center gap-3 rounded-xl border border-sky-500/20 bg-sky-500/[.04] p-3 text-right hover:border-sky-400/40" onClick={() => onStartAdvanced("video.edit")}><span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500/10"><Film className="h-4 w-4 text-sky-300" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold">تحرير الفيديو</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">استخدم الفيديو كـSource مع Reference اختيارية.</span></span><ChevronLeft className="h-4 w-4 text-muted-foreground" /></button>}
            {selectedAsset?.kind === "VIDEO" && <button className="group flex items-center gap-3 rounded-xl border border-sky-500/20 bg-sky-500/[.04] p-3 text-right hover:border-sky-400/40" onClick={() => onStartAdvanced("video.extend")}><span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500/10"><Film className="h-4 w-4 text-sky-300" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold">تمديد الفيديو</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">مدّد المشهد من Video Source الحالية.</span></span><ChevronLeft className="h-4 w-4 text-muted-foreground" /></button>}
            {selectedAsset?.kind === "AUDIO" && <button className="group flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[.04] p-3 text-right hover:border-amber-400/40" onClick={() => onStartAdvanced("video.avatar")}><span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-500/10"><Film className="h-4 w-4 text-amber-300" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold">استخدامه كـVoice Audio</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">ابدأ Avatar ثم اربط صورة الشخصية.</span></span><ChevronLeft className="h-4 w-4 text-muted-foreground" /></button>}
          </div>
        </section>
        {selectedAsset ? (
          <Button variant="secondary" className="w-full gap-2" onClick={onViewAsset}><ImageIcon className="h-4 w-4" />عرض الأصل</Button>
        ) : (
          <button className="w-full rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-muted-foreground hover:border-white/30 hover:text-foreground" onClick={onAddAsset}>
            <ImageIcon className="mx-auto mb-2 h-5 w-5" />أضف صورة للتعديل أو Remix
          </button>
        )}
        {selectedAsset && !imageSelected && <p className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-3 text-xs text-sky-100">اختر وصفة النوع أعلاه؛ الـBindings ستبقى صريحة وقابلة للتحقق قبل Quote.</p>}
      </div>
      <InspectorFooter />
    </div>
  );
}

function ComposerForm({ offers, draft, project, boundAsset, candidateAsset, onChange, onClose, quote, confirmation, quoteLoading, confirmLoading, onRequestQuote, onConfirmQuote, execution, executionLoading, onRunOperation, onViewOutput }: { offers: ReadonlyArray<PublishedOffer>; draft: ImageComposerDraft; project: CreativeSpaceProject; boundAsset: SpaceAsset | null; candidateAsset: SpaceAsset | null; onChange: (draft: ImageComposerDraft) => void; onClose: () => void; quote: ImageQuote | null; confirmation: ConfirmedImageQuote | null; quoteLoading: boolean; confirmLoading: boolean; onRequestQuote: () => void; onConfirmQuote: () => void; execution: ExecutedImageOperation | null; executionLoading: boolean; onRunOperation: () => void; onViewOutput: () => void }) {
  const [compatibility, setCompatibility] = useState<RecipeCompatibilityDiff | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const manifest = getImageRecipeManifest(draft.recipeId);
  const selectedOffer = offers.find((offer) => offer.offerId === draft.offerId) ?? null;
  const publishedRecipe = selectedOffer?.capability.controlSchema.recipes.find((recipe) => recipe.recipeId === draft.recipeId) ?? null;
  const validation = validateImageComposerDraft(draft, project, undefined, selectedOffer);
  const readyForQuote = validation.valid && !!draft.offerId;
  const inputRequired = publishedRecipe ? publishedRecipe.bindings.min > 0 : manifest.input.required;
  const promptVisible = publishedRecipe?.prompt.visible ?? manifest.prompt.visible;
  const promptMaxLength = publishedRecipe?.prompt.maxLength ?? 1_200;
  const liveState = execution?.operation.state ?? confirmation?.operation.state ?? null;
  const liveStatus = liveState ? operationPresentation(liveState) : null;
  const update = (patch: Partial<ImageComposerDraft>) => onChange({ ...draft, ...patch, updatedAt: new Date().toISOString() });
  const requestRecipeChange = (recipeId: ImageRecipeId) => {
    if (recipeId === draft.recipeId) return;
    const diff = planRecipeCompatibility(draft, recipeId);
    if (diff.changes.length === 0) onChange(diff.nextDraft);
    else setCompatibility(diff);
  };
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-5 py-4">
        <button className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={onClose}><ArrowRight className="h-3.5 w-3.5" />العودة للوصفات</button>
        <p className="text-[10px] uppercase tracking-[.18em] text-muted-foreground">{manifest.actionLabel}</p>
        <h2 className="mt-1 text-lg font-bold">{manifest.label}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{manifest.description}</p>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <section>
          <Label className="text-xs">الوصفة</Label>
          <Select value={draft.recipeId} onValueChange={(recipeId: ImageRecipeId) => requestRecipeChange(recipeId)}>
            <SelectTrigger className="mt-2 h-11 bg-white/[.03]" aria-label="تغيير الوصفة"><SelectValue /></SelectTrigger>
            <SelectContent>{imageRecipeList.map((recipe) => <SelectItem key={recipe.id} value={recipe.id}>{recipe.label}</SelectItem>)}</SelectContent>
          </Select>
          <p className="mt-1.5 text-[10px] text-muted-foreground">أي تغيير يسقط Prompt أو إعداداً سيعرض Compatibility Diff قبل التطبيق.</p>
        </section>
        {inputRequired && (
          <section>
            <Label className="text-xs">المدخل المثبت</Label>
            <div className={`mt-2 flex items-center gap-2 rounded-xl border p-3 ${boundAsset ? "border-emerald-500/20 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}`}>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/5"><ImageIcon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{boundAsset?.name ?? "لم تُربط صورة"}</span><span className="text-[10px] text-muted-foreground">{manifest.input.role}</span></span>
              {boundAsset ? <button className="rounded-md p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground" aria-label="إزالة المدخل" onClick={() => update({ inputAssetId: null })}><X className="h-4 w-4" /></button> : <X className="h-4 w-4 text-destructive" />}
            </div>
            {candidateAsset?.kind === "IMAGE" && candidateAsset.id !== boundAsset?.id && <Button type="button" size="sm" variant="outline" className="mt-2 w-full gap-2" onClick={() => update({ inputAssetId: candidateAsset.id })}><Check className="h-3.5 w-3.5" />{boundAsset ? "استبدال بالصورة المحددة" : "ربط الصورة المحددة"}</Button>}
          </section>
        )}
        {promptVisible && (
          <section>
            <div className="mb-2 flex items-center justify-between"><Label htmlFor="image-recipe-prompt" className="text-xs">Prompt</Label><span className="text-[10px] text-muted-foreground">{draft.prompt.length}/{promptMaxLength}</span></div>
            <Textarea id="image-recipe-prompt" autoFocus value={draft.prompt} maxLength={promptMaxLength} rows={5} placeholder={manifest.prompt.placeholder} className="resize-none bg-white/[.03] text-sm leading-6" onChange={(event) => update({ prompt: event.target.value })} />
          </section>
        )}
        <section>
          <Label className="text-xs">النموذج المنشور</Label>
          <Select value={draft.offerId ?? undefined} onValueChange={(offerId) => { const offer = offers.find((candidate) => candidate.offerId === offerId); const settings = offer ? reconcilePublishedOfferSettings(offer, draft.recipeId, draft.settings) : null; if (offer && settings) update({ offerId, modelId: offer.providerModelId, settings: settings as ImageComposerDraft["settings"] }); }}>
            <SelectTrigger className="mt-2 h-11 bg-white/[.03]" aria-label="اختيار نموذج الصورة المنشور"><SelectValue placeholder={offers.length ? "اختر نموذجاً منشوراً" : "لا توجد عروض صور منشورة"} /></SelectTrigger>
            <SelectContent>{offers.map((offer) => <SelectItem key={offer.offerId} value={offer.offerId}>{offer.displayName} · {offer.providerId}</SelectItem>)}</SelectContent>
          </Select>
          <p className="mt-1.5 text-[10px] text-muted-foreground">يرسل المتصفح العرض المنشور فقط؛ يثبت الخادم المسار والسعر قبل الحجز.</p>
        </section>
        {publishedRecipe ? <section className="space-y-4"><div className="flex items-center gap-2"><SlidersHorizontal className="h-3.5 w-3.5" /><Label className="text-xs">الإعدادات المنشورة</Label></div>{publishedRecipe.controls.map((setting) => {
          const label = manifest.settings.find((candidate) => candidate.id === setting.id)?.label ?? setting.id;
          const value = draft.settings[setting.id] ?? setting.defaultValue;
          if (setting.kind === "enum" || setting.kind === "boolean") return <div key={setting.id}><Label className="text-[11px] text-muted-foreground">{label}</Label><Select value={String(value)} onValueChange={(next) => { const resolved = setting.values?.find((option) => String(option) === next) ?? next; update({ settings: { ...draft.settings, [setting.id]: resolved } as ImageComposerDraft["settings"] }); }}><SelectTrigger className="mt-1.5 bg-white/[.03]" aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{(setting.values ?? []).map((option) => <SelectItem key={String(option)} value={String(option)}>{String(option)}</SelectItem>)}</SelectContent></Select></div>;
          return <div key={setting.id}><div className="mb-2 flex items-center justify-between"><Label className="text-[11px] text-muted-foreground">{label}</Label><span className="text-xs tabular-nums">{Number(value)}</span></div><Slider value={[Number(value)]} min={setting.min ?? 0} max={setting.max ?? 100} step={setting.step ?? 1} onValueChange={([next]) => update({ settings: { ...draft.settings, [setting.id]: next } })} /></div>;
        })}</section> : !!manifest.settings.length && <section className="space-y-4"><div className="flex items-center gap-2"><SlidersHorizontal className="h-3.5 w-3.5" /><Label className="text-xs">الإعدادات</Label></div>{manifest.settings.map((setting) => {
          const value = draft.settings[setting.id] ?? setting.defaultValue;
          if (setting.kind === "SELECT") return <div key={setting.id}><Label className="text-[11px] text-muted-foreground">{setting.label}</Label><Select value={String(value)} onValueChange={(next) => update({ settings: { ...draft.settings, [setting.id]: next } })}><SelectTrigger className="mt-1.5 bg-white/[.03]" aria-label={setting.label}><SelectValue /></SelectTrigger><SelectContent>{setting.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>;
          return <div key={setting.id}><div className="mb-2 flex items-center justify-between"><Label className="text-[11px] text-muted-foreground">{setting.label}</Label><span className="text-xs tabular-nums">{Number(value)}%</span></div><Slider value={[Number(value)]} min={setting.min} max={setting.max} step={setting.step} onValueChange={([next]) => update({ settings: { ...draft.settings, [setting.id]: next } })} /></div>;
        })}</section>}
        <section className={`rounded-xl border p-3 ${readyForQuote ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"}`} data-testid="composer-validation">
          <div className="flex items-center gap-2">
            {readyForQuote ? <ShieldCheck className="h-4 w-4 text-emerald-400" /> : <AlertCircle className="h-4 w-4 text-amber-300" />}
            <p className="text-xs font-bold">{readyForQuote ? "الـBindings والإعدادات والعرض المنشور صالحة" : `${validation.issues.length + (draft.offerId ? 0 : 1)} متطلبات تحتاج إكمالاً`}</p>
          </div>
          {!readyForQuote && <ul className="mt-2 space-y-1.5">{!draft.offerId && <li className="flex gap-2 text-[11px] leading-5 text-amber-100/80"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-300" /><span>اختر نموذجاً منشوراً ومفعّلاً.</span></li>}{validation.issues.map((issue, index) => <li key={`${issue.code}-${index}`} className="flex gap-2 text-[11px] leading-5 text-amber-100/80"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-300" /><span>{issue.message}</span></li>)}</ul>}
        </section>
      </div>
      <div className="border-t border-white/10 p-4">
        <div className="rounded-xl bg-white/5 p-3">
          <div className="flex items-center justify-between text-xs"><span>Final quote</span><span className={readyForQuote ? "text-emerald-400" : "text-amber-300"}>{readyForQuote ? "جاهز للتسعير" : "غير مكتمل"}</span></div>
          {quote && !confirmation && <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-[11px]">
            <div><p className="text-muted-foreground">سعر الموقع</p><p className="mt-1 font-bold text-white">{quote.customerCredits} كريديت</p></div>
            <p className="mt-2 border-t border-white/10 pt-2 leading-5 text-muted-foreground">لا يوجد خصم الآن. عند التأكيد سيُحجز {quote.customerCredits} كريديت من محفظتك فقط.</p>
          </div>}
          {confirmation && liveStatus && <div className={`mt-3 rounded-lg border p-3 text-[11px] ${liveStatus.tone === "success" ? "border-emerald-500/20 bg-emerald-500/5" : liveStatus.tone === "failure" ? "border-red-500/25 bg-red-500/5" : liveStatus.tone === "review" ? "border-amber-500/25 bg-amber-500/5" : "border-violet-500/20 bg-violet-500/5"}`}>
            <div className={`flex items-center gap-2 font-bold ${liveStatus.tone === "success" ? "text-emerald-300" : liveStatus.tone === "failure" ? "text-red-300" : liveStatus.tone === "review" ? "text-amber-300" : "text-violet-200"}`}>{liveStatus.tone === "active" ? <Loader2 className="h-4 w-4 animate-spin" /> : liveStatus.tone === "success" ? <ShieldCheck className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}{liveStatus.label}</div>
            <p className="mt-2 leading-5 text-muted-foreground">{liveStatus.detail}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/30" aria-label={`تقدم العملية ${liveStatus.progress}%`}><div className={`h-full rounded-full transition-[width] duration-500 ${liveStatus.tone === "success" ? "bg-emerald-400" : liveStatus.tone === "failure" ? "bg-red-400" : liveStatus.tone === "review" ? "bg-amber-400" : "bg-violet-400"}`} style={{ width: `${liveStatus.progress}%` }} /></div>
            <p className="mt-2 text-muted-foreground">رقم العملية <span className="font-mono text-foreground" dir="ltr">{confirmation.operation.id.slice(0, 8)}</span> · {liveState}</p>
            <p className="mt-1">{execution ? `الخصم النهائي: ${execution.operation.financials.customerChargedCredits} كريديت` : confirmation.wallet ? `المحجوز: ${confirmation.wallet.customerCredits.held} · المتاح: ${confirmation.wallet.customerCredits.available}` : `تم حجز ${confirmation.operation.financials.customerQuotedCredits} كريديت`}</p>
            {execution?.operation.assetChecksumSha256 && <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">SHA-256 {execution.operation.assetChecksumSha256}</p>}
          </div>}
          {!quote && <Button className="mt-3 w-full gap-2" disabled={!readyForQuote || quoteLoading} onClick={onRequestQuote}>{quoteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}{readyForQuote ? "احسب السعر النهائي" : "أكمل المتطلبات للمتابعة"}</Button>}
          {quote && !confirmation && <Button className="mt-3 w-full" disabled={confirmLoading} onClick={() => setConfirmOpen(true)}>{confirmLoading ? "جارٍ الحجز..." : `تأكيد وحجز ${quote.customerCredits} كريديت`}</Button>}
          {confirmation && !execution && <Button className="mt-3 w-full gap-2" disabled><Loader2 className="h-4 w-4 animate-spin" />المحرك ينفذ تلقائياً...</Button>}
          {execution?.operation.state === "SETTLED" && <Button className="mt-3 w-full gap-2" onClick={onViewOutput}><ImageIcon className="h-4 w-4" />عرض وتنزيل النتيجة</Button>}
        </div>
      </div>
      <CompatibilityDialog diff={compatibility} onClose={() => setCompatibility(null)} onApply={() => {
        if (!compatibility?.canApply) return;
        onChange(compatibility.nextDraft);
        setCompatibility(null);
      }} />
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent className="max-w-md" dir="rtl"><DialogHeader><DialogTitle>تأكيد السعر والحجز</DialogTitle><DialogDescription>هذا التأكيد ينشئ عملية واحدة، يحجز الرصيد مرة واحدة، ثم يبدأ المحرك التنفيذ تلقائياً ويتابع النتيجة حتى التسوية أو الاسترداد.</DialogDescription></DialogHeader>{quote && <div className="space-y-2 rounded-xl border border-white/10 bg-white/[.03] p-4 text-sm"><div className="flex justify-between"><span>سعر الموقع</span><strong>{quote.customerCredits} كريديت</strong></div><div className="flex justify-between text-muted-foreground"><span>حالة الخصم الحالية</span><span>لن يُخصم شيء قبل التأكيد</span></div></div>}<DialogFooter className="gap-2 sm:gap-0"><Button variant="outline" onClick={() => setConfirmOpen(false)}>إلغاء</Button><Button disabled={confirmLoading} onClick={() => { onConfirmQuote(); setConfirmOpen(false); }}>{confirmLoading ? "جارٍ التأكيد..." : `تأكيد وحجز ${quote?.customerCredits ?? 0}`}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function CompatibilityDialog({ diff, onClose, onApply }: { diff: RecipeCompatibilityDiff | null; onClose: () => void; onApply: () => void }) {
  const target = diff ? getImageRecipeManifest(diff.toRecipeId) : null;
  return <Dialog open={!!diff} onOpenChange={(open) => !open && onClose()}><DialogContent className="max-w-md" dir="rtl"><DialogHeader><DialogTitle>Compatibility Diff</DialogTitle><DialogDescription>{diff?.canApply ? `راجع التغييرات قبل الانتقال إلى ${target?.label}. لن يُحذف شيء بصمت.` : `لا يمكن الانتقال إلى ${target?.label} حالياً.`}</DialogDescription></DialogHeader><div className="space-y-2">{diff?.changes.map((change, index) => <div key={`${change.code}-${index}`} className={`flex gap-3 rounded-xl border p-3 ${change.severity === "BLOCKING" ? "border-destructive/30 bg-destructive/10" : change.severity === "WARNING" ? "border-amber-500/25 bg-amber-500/10" : "border-sky-500/20 bg-sky-500/5"}`}>{change.severity === "BLOCKING" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : change.severity === "WARNING" ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />}<div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{change.severity}</p><p className="mt-1 text-xs leading-5">{change.message}</p></div></div>)}</div><DialogFooter className="gap-2 sm:gap-0"><Button variant="outline" onClick={onClose}>إلغاء</Button>{diff?.canApply && <Button onClick={onApply}>تطبيق التغيير بوضوح</Button>}</DialogFooter></DialogContent></Dialog>;
}

function InspectorFooter() {
  return <div className="border-t border-white/10 p-4"><div className="rounded-xl bg-white/5 p-3"><div className="flex items-center justify-between text-xs"><span>Final quote</span><span className="text-muted-foreground">بعد اكتمال الـBindings</span></div><Button className="mt-3 w-full" disabled>Generate</Button></div></div>;
}
