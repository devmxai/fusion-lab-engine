import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, ImageIcon, Loader2, Sparkles, Video } from "lucide-react";
import type { CreativeSpaceProject, SpaceAsset } from "./domain";
import { imageRequestErrorMessage } from "./image-quote-client";
import {
  publishedOfferFamilyControls,
  publishedOfferFamilyControlValues,
  publishedOfferFamilyKey,
  publishedOfferFamilyMembers,
  reconcilePublishedOfferSettings,
  resolvePublishedOfferFamilyVariant,
  type PublishedOffer,
  type PublishedSettingValue,
} from "./published-offers-client";
import type { UiFuxLocale } from "./product-decisions";
import { confirmVideoQuote, requestVideoQuote, runVideoOperation, type ConfirmedVideoQuote, type ExecutedVideoOperation } from "./video-quote-client";
import type { VideoComposerDraft } from "./video-composer-draft";
import type { VideoRecipeId } from "./video-recipes";
import { CustomerSelect } from "./CustomerSelect";
import { PublishedModelPicker } from "./PublishedModelPicker";
import { ReferenceAssetThumbnail } from "./ReferenceAssetThumbnail";
import { customerModelVersionKey } from "./model-presentation";

type Props = Readonly<{
  locale: UiFuxLocale;
  offers: readonly PublishedOffer[];
  project: CreativeSpaceProject;
  onReserved: (input: { draft: VideoComposerDraft; confirmation: ConfirmedVideoQuote }) => Promise<void>;
  onCompleted: (input: { draft: VideoComposerDraft; execution: ExecutedVideoOperation }) => Promise<void>;
  onUploadReference: (file: File) => Promise<UploadedReference>;
  onWalletChanged: () => void;
  /** Asset explicitly picked from the visible Project assets grid. */
  referenceAssetId?: string | null;
  onResolveAssetPreview: (asset: SpaceAsset) => Promise<string | null>;
}>;

type UploadedReference = Readonly<{ assetId: string; name: string }>;
type VideoSourceImage = Readonly<{ asset: SpaceAsset; sourceAssetId: string }>;

const executableStandardVideoRecipes: readonly VideoRecipeId[] = [
  "video.text-to-video",
  "video.image-to-video",
];

function offerRecipe(offer: PublishedOffer, recipeId: VideoRecipeId) {
  return offer.capability.controlSchema.recipes.find((recipe) => recipe.recipeId === recipeId) ?? null;
}

function draftFor(projectId: string, offer: PublishedOffer, recipeId: VideoRecipeId, sourceAssetId: string | null, prompt: string, settings?: Record<string, PublishedSettingValue>): VideoComposerDraft | null {
  const recipe = offerRecipe(offer, recipeId);
  const nextSettings = reconcilePublishedOfferSettings(offer, recipeId, settings);
  if (!recipe || !nextSettings) return null;
  return {
    schemaVersion: 1,
    projectId,
    recipeId,
    bindings: sourceAssetId && recipe.bindings.min > 0 ? [{ assetId: sourceAssetId, slot: "FIRST_FRAME", ordinal: 0 }] : [],
    prompt,
    offerId: offer.offerId,
    modelId: offer.providerModelId,
    settings: nextSettings,
    anchor: { x: 0, y: 0 },
    updatedAt: new Date().toISOString(),
  };
}

function labelFor(control: { id: string; ui?: { labelKey: string } }, locale: UiFuxLocale) {
  const labels: Record<string, { en: string; ar: string }> = {
    durationSeconds: { en: "Duration", ar: "المدة" },
    resolution: { en: "Resolution", ar: "الدقة" },
    aspectRatio: { en: "Aspect ratio", ar: "نسبة الأبعاد" },
    quality: { en: "Quality", ar: "الجودة" },
    audio: { en: "Audio", ar: "الصوت" },
  };
  return labels[control.id]?.[locale] ?? control.ui?.labelKey ?? control.id;
}

function aspectRatioParts(value: string) {
  const match = /^(\d+)\s*:\s*(\d+)$/.exec(value);
  return match ? `${match[1]} / ${match[2]}` : "1 / 1";
}

function AspectRatioMark({ value }: Readonly<{ value: string }>) {
  return <span
    aria-hidden="true"
    className="inline-block h-4 max-w-7 shrink-0 rounded-[2px] border border-current"
    style={{ aspectRatio: aspectRatioParts(value) }}
  />;
}

/**
 * The Standard video flow deliberately accepts one first-frame image only.
 * It is driven by the published offer contract, never a browser-side model
 * list, so a customer cannot request an unsupported model or price.
 */
export function StandardVideoComposer({ locale, offers, project, onReserved, onCompleted, onUploadReference, onWalletChanged, referenceAssetId = null, onResolveAssetPreview }: Props) {
  const availableOffers = useMemo(
    () => offers.filter((offer) => offer.capability.mediaType === "video" && executableStandardVideoRecipes.some((recipeId) => !!offerRecipe(offer, recipeId))),
    [offers],
  );
  // Commercial SKUs (5s, 10s, 4K …) are not separate customer-facing
  // models.  A customer chooses a model family once; certified variants are
  // then exposed as its exact, price-bearing settings.
  const sourceImages = useMemo<readonly VideoSourceImage[]>(() => Object.values(project.assets)
    // Accept legacy documents whose persisted enum casing predates the
    // canonical upper-case contract.  The Engine still performs the final
    // owner/project/ready-image verification before a quote is issued.
    .filter((asset): asset is SpaceAsset => {
      const isImage = String(asset.kind).toUpperCase() === "IMAGE" || asset.mimeType.toLowerCase().startsWith("image/");
      // A persisted delivery ID is issued only after the Engine has accepted
      // the generated file.  Older project documents can still carry a stale
      // presentation status, so do not hide a verifiably delivered result.
      const isVerifiedGeneratedResult = asset.origin === "GENERATED" && Boolean(asset.deliveryAssetId);
      return isImage && (asset.status === "READY" || isVerifiedGeneratedResult);
    })
    // Keep the project presentation ID in the draft. The request boundary
    // resolves it to `deliveryAssetId` for generated results, preserving the
    // project-document lookup and the Engine's durable asset identity.
    .map((asset) => ({ asset, sourceAssetId: asset.id }))
    .sort((left, right) => right.asset.createdAt.localeCompare(left.asset.createdAt)), [project.assets]);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [recipeId, setRecipeId] = useState<VideoRecipeId>("video.image-to-video");
  const [sourceAssetId, setSourceAssetId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [settings, setSettings] = useState<Record<string, PublishedSettingValue>>({});
  const [confirmation, setConfirmation] = useState<ConfirmedVideoQuote | null>(null);
  const [execution, setExecution] = useState<ExecutedVideoOperation | null>(null);
  const [loading, setLoading] = useState<"quote" | "confirm" | "run" | null>(null);
  const [uploading, setUploading] = useState(false);
  // The canonical project document is persisted asynchronously.  Keep the
  // verified Engine identity available until its project update arrives, so a
  // valid upload can never be lost between the upload response and React's
  // next project render.
  const [pendingReference, setPendingReference] = useState<UploadedReference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = availableOffers.find((offer) => offer.offerId === offerId) ?? null;
  // A reference is never inferred from the first gallery card. The customer
  // either chooses "Use as reference" on an asset or uploads a new file.
  const effectiveSourceAssetId = sourceAssetId ?? pendingReference?.assetId ?? null;
  const selectedSourceAsset = sourceImages.find((source) => source.sourceAssetId === effectiveSourceAssetId)?.asset ?? null;
  const recipe = selected ? offerRecipe(selected, recipeId) : null;
  const selectedVersionOffers = useMemo(
    () => selected ? availableOffers.filter((offer) => customerModelVersionKey(offer) === customerModelVersionKey(selected)) : [],
    [availableOffers, selected],
  );
  const selectedRecipes = useMemo(
    () => executableStandardVideoRecipes.filter((candidate) => selectedVersionOffers.some((offer) => !!offerRecipe(offer, candidate))),
    [selectedVersionOffers],
  );
  const requiresReference = Boolean(recipe && recipe.bindings.min > 0);
  const familyOffers = useMemo(
    () => selected ? publishedOfferFamilyMembers(availableOffers, selected, recipeId) : [],
    [availableOffers, recipeId, selected],
  );
  const controls = useMemo(
    () => selected ? publishedOfferFamilyControls(familyOffers, recipeId, settings) : [],
    [familyOffers, recipeId, selected, settings],
  );
  // A resolution is the customer-facing quality choice. Some provider
  // payloads expose it twice (`quality` and `resolution`) even though both
  // describe the delivered output. Keep the certified resolution control and
  // hide the duplicate tier from Standard; the full settings remain in the
  // price-bearing offer passed to the Engine.
  const visibleControls = useMemo(() => {
    const hasResolution = controls.some(({ control }) => control.id === "resolution");
    return controls.filter(({ control }) => !(hasResolution && control.id === "quality"));
  }, [controls]);

  useEffect(() => {
    if (!availableOffers.length) {
      setOfferId(null);
      return;
    }
    // Prefer the complete Kling 3.0 route when there is no persisted
    // selection. Kling 3.0 Turbo remains an explicit version choice, but it
    // must not silently become the default for the newer 3.0 product.
    const next = availableOffers.find((offer) => offer.offerId === offerId)
      ?? availableOffers.find((offer) => offer.providerModelId === "kling-3.0/video")
      ?? availableOffers[0]!;
    if (next.offerId !== offerId) setOfferId(next.offerId);
    const nextRecipe = executableStandardVideoRecipes.find((candidate) => !!offerRecipe(next, candidate));
    if (!nextRecipe) return;
    if (!offerRecipe(next, recipeId)) setRecipeId(nextRecipe);
    const reconciled = reconcilePublishedOfferSettings(next, offerRecipe(next, recipeId) ? recipeId : nextRecipe, settings);
    if (reconciled && JSON.stringify(reconciled) !== JSON.stringify(settings)) setSettings(reconciled);
  }, [availableOffers, offerId, recipeId, settings]);

  useEffect(() => {
    if (!referenceAssetId || !sourceImages.some((source) => source.sourceAssetId === referenceAssetId)) return;
    setSourceAssetId(referenceAssetId);
    setConfirmation(null);
    setExecution(null);
    setError(null);
  }, [referenceAssetId, sourceImages]);

  useEffect(() => {
    if (!sourceAssetId) return;
    if (sourceImages.some((source) => source.sourceAssetId === sourceAssetId) || pendingReference?.assetId === sourceAssetId) return;
    setSourceAssetId(null);
  }, [pendingReference?.assetId, sourceAssetId, sourceImages]);

  useEffect(() => {
    if (pendingReference && sourceImages.some((source) => source.sourceAssetId === pendingReference.assetId)) setPendingReference(null);
  }, [pendingReference, sourceImages]);

  useEffect(() => {
    if (effectiveSourceAssetId) setError(null);
  }, [effectiveSourceAssetId]);

  const resetQuote = () => {
    setConfirmation(null);
    setExecution(null);
    setError(null);
  };
  const selectOffer = (nextId: string) => {
    const next = availableOffers.find((offer) => offer.offerId === nextId);
    if (!next) return;
    const nextRecipe = executableStandardVideoRecipes.find((candidate) => !!offerRecipe(next, candidate));
    if (!nextRecipe) return;
    setOfferId(nextId);
    setRecipeId(nextRecipe);
    setSettings(reconcilePublishedOfferSettings(next, nextRecipe) ?? {});
    resetQuote();
  };
  const selectRecipe = (nextRecipe: VideoRecipeId) => {
    if (!selected) return;
    const nextOffer = selectedVersionOffers.find((offer) => !!offerRecipe(offer, nextRecipe));
    if (!nextOffer) return;
    setOfferId(nextOffer.offerId);
    setRecipeId(nextRecipe);
    setSettings(reconcilePublishedOfferSettings(nextOffer, nextRecipe) ?? {});
    if (nextRecipe === "video.text-to-video") setSourceAssetId(null);
    resetQuote();
  };
  const selectSetting = (controlId: string, value: PublishedSettingValue) => {
    if (!selected) return;
    const resolved = resolvePublishedOfferFamilyVariant({
      offers: availableOffers,
      selectedOffer: selected,
      recipeId,
      desiredSettings: { ...settings, [controlId]: value },
      changedControlId: controlId,
    });
    if (!resolved) return;
    setOfferId(resolved.offer.offerId);
    setSettings(resolved.settings);
    resetQuote();
  };
  const createDraft = () => selected ? draftFor(project.projectId, selected, recipeId, effectiveSourceAssetId, prompt, settings) : null;
  const missingReference = requiresReference && !effectiveSourceAssetId;
  const missingPrompt = !prompt.trim();
  const ready = Boolean(selected && recipe && !missingReference && !missingPrompt && !confirmation);
  const generate = async () => {
    const draft = createDraft();
    if (!draft || !ready) return;
    setLoading("quote"); setError(null);
    try {
      const quote = await requestVideoQuote(draft, project);
      if (new Date(quote.expiresAt).getTime() <= Date.now()) throw new Error(locale === "en" ? "The price changed before generation could start. Try again." : "تغير السعر قبل بدء التوليد. حاول مرة أخرى.");
      setLoading("confirm");
      const confirmed = await confirmVideoQuote(quote, crypto.randomUUID());
      await onReserved({ draft, confirmation: confirmed });
      setConfirmation(confirmed);
      onWalletChanged();
      setLoading("run");
      const completed = await runVideoOperation(confirmed.operation.id);
      await onCompleted({ draft, execution: completed });
      setExecution(completed);
      onWalletChanged();
    } catch (reason) { setError(imageRequestErrorMessage(reason, locale)); }
    finally { setLoading(null); }
  };
  const uploadReference = async (file: File | null) => {
    if (!file || confirmation) return;
    setUploading(true); setError(null);
    try {
      const uploaded = await onUploadReference(file);
      setPendingReference(uploaded);
      setSourceAssetId(uploaded.assetId);
      resetQuote();
    }
    catch (reason) { setError(imageRequestErrorMessage(reason, locale)); }
    finally { setUploading(false); }
  };
  const copy = locale === "en" ? {
    unavailable: "No published video model is available yet.", source: "Reference image", sourceHint: "Choose the first frame for your video.", selectedSource: "Selected reference", upload: "Upload image", model: "Video model", mode: "Mode", createVideo: "Create video", editVideo: "Edit video", motionControl: "Motion control", method: "Input method", textToVideo: "Text to video", imageToVideo: "Image to video", prompt: "Describe the motion, camera, and scene", generate: "Generate", ready: "Video ready", generating: "Generating video", needs: "Choose a reference image and write a prompt.", needsReference: "Choose a reference image first.", needsPrompt: "Write a prompt to continue.", noImages: "Generate or upload an image to this project first.",
  } : {
    unavailable: "لا يوجد نموذج فيديو منشور ومفعّل حالياً.", source: "الصورة المرجعية", sourceHint: "اختر الإطار الأول للفيديو.", selectedSource: "الصورة المرجعية المختارة", upload: "رفع صورة", model: "نموذج الفيديو", mode: "المهمة", createVideo: "إنشاء فيديو", editVideo: "تعديل فيديو", motionControl: "التحكم بالحركة", method: "طريقة الإدخال", textToVideo: "نص إلى فيديو", imageToVideo: "صورة إلى فيديو", prompt: "اكتب وصف الحركة والكاميرا والمشهد", generate: "توليد", ready: "الفيديو جاهز", generating: "جارٍ توليد الفيديو", needs: "اختر صورة مرجعية واكتب الوصف.", needsReference: "اختر صورة مرجعية أولاً.", needsPrompt: "اكتب وصفاً للّقطة للمتابعة.", noImages: "أنشئ أو ارفع صورة داخل المشروع أولاً.",
  };
  if (!availableOffers.length) return <section className="rounded-xl border border-dashed border-amber-400/30 bg-amber-400/5 p-4 text-center text-sm text-amber-100">{copy.unavailable}</section>;
  return <div className="space-y-3">
    <CustomerSelect
      ariaLabel={copy.mode}
      label={copy.mode}
      value="create"
      options={[
        { value: "create", label: copy.createVideo },
        { value: "edit", label: copy.editVideo, disabled: true },
        { value: "motion", label: copy.motionControl, disabled: true },
      ]}
      onValueChange={() => undefined}
    />
    <PublishedModelPicker
      locale={locale}
      offers={availableOffers}
      mediaType="video"
      recipeId={null}
      selectedOfferId={selected?.offerId ?? null}
      onSelect={(offer) => selectOffer(offer.offerId)}
    />
    {selectedRecipes.length > 0 && <CustomerSelect
      ariaLabel={copy.method}
      label={copy.method}
      disabled={Boolean(confirmation)}
      value={recipeId}
      options={selectedRecipes.map((candidate) => ({
        value: candidate,
        label: candidate === "video.text-to-video" ? copy.textToVideo : copy.imageToVideo,
      }))}
      onValueChange={(candidate) => selectRecipe(candidate as VideoRecipeId)}
    />}
    {requiresReference && <section>
      {selectedSourceAsset ? (
        <div className="standard-quiet-surface flex items-center gap-2.5 p-2">
          <ReferenceAssetThumbnail asset={selectedSourceAsset} onResolvePreview={onResolveAssetPreview} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white">{copy.selectedSource}</p>
            <p className="mt-0.5 text-[11px] text-white/55">{locale === "en" ? "Use another Project asset from its action menu." : "لاختيار أصل آخر، استخدم زر «استخدام كمرجع» من الكارت."}</p>
          </div>
          {!confirmation && <button type="button" onClick={() => { setSourceAssetId(null); resetQuote(); }} className="text-[11px] font-semibold text-white/75 underline">{locale === "en" ? "Remove" : "إزالة"}</button>}
        </div>
      ) : pendingReference ? (
        <div className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-300/[0.06] px-2.5 py-2 text-[11px] text-emerald-100">{locale === "en" ? "Upload verified. Adding it to Project assets…" : "تم التحقق من الرفع. تتم إضافته إلى أصول المشروع…"}</div>
      ) : <label className="standard-reference-dropzone cursor-pointer px-4 py-3" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void uploadReference(event.dataTransfer.files?.[0] ?? null); }}><input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={Boolean(confirmation) || uploading} onChange={(event) => { void uploadReference(event.currentTarget.files?.[0] ?? null); event.currentTarget.value = ""; }} /><span className="relative z-10 flex flex-col items-center"><span className="standard-reference-icon">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}</span><span className="mt-2 text-[13px] font-bold text-white">{uploading ? (locale === "en" ? "Verifying upload" : "جارٍ التحقق من الصورة") : copy.source}</span><span className="mt-0.5 text-[11px] text-white/50">{locale === "en" ? "Click or drop an image" : "انقر أو اسحب صورة هنا"}</span></span></label>}
    </section>}
    <div className="grid grid-cols-2 gap-2">
    {visibleControls.map(({ control, value }) => {
      const values = publishedOfferFamilyControlValues({
        offers: availableOffers,
        selectedOffer: selected,
        recipeId,
        settings,
        control,
      });
      const numericDuration = control.id === "durationSeconds" && values.every((item) => typeof item === "number");
      if (numericDuration && values.length > 1) {
        const durations = [...values].map(Number).sort((left, right) => left - right);
        return <CustomerSelect
          key={control.id}
          ariaLabel={locale === "en" ? "Duration" : "المدة"}
          compact
          icon={<Clock3 className="h-3.5 w-3.5" />}
          disabled={Boolean(confirmation)}
          value={String(value)}
          options={durations.map((duration) => ({ value: String(duration), label: `${duration}s` }))}
          onValueChange={(nextValue) => {
            const duration = durations.find((candidate) => String(candidate) === nextValue);
            if (duration !== undefined) selectSetting(control.id, duration);
          }}
        />;
      }
      if (control.kind === "number") return <label key={control.id} className="block text-sm"><span className="standard-field-label">{labelFor(control, locale)}</span><input type="number" min={control.min} max={control.max} step={control.step ?? 1} value={Number(value)} disabled={Boolean(confirmation)} onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) selectSetting(control.id, next); }} className="w-full px-2.5 py-2 text-[13px] disabled:cursor-not-allowed" /></label>;
      if (values.length === 1) {
        const isDuration = control.id === "durationSeconds";
        const isAspectRatio = control.id === "aspectRatio";
        const label = control.id === "resolution" ? (locale === "en" ? "Quality" : "الجودة") : labelFor(control, locale);
        return <div key={control.id} className="standard-compact-readout flex items-center gap-2 px-2.5">
          {isDuration ? <Clock3 className="h-3.5 w-3.5 shrink-0 text-white/65" /> : isAspectRatio ? <AspectRatioMark value={String(value)} /> : null}
          <span className="min-w-0">{!isDuration && !isAspectRatio && <span className="standard-compact-label">{label}</span>}<strong className="block truncate text-[12px]">{isDuration ? `${value}s` : String(value)}</strong></span>
        </div>;
      }
      const isDuration = control.id === "durationSeconds";
      const isAspectRatio = control.id === "aspectRatio";
      const displayLabel = control.id === "resolution" ? (locale === "en" ? "Quality" : "الجودة") : labelFor(control, locale);
      const compactIcon = isDuration ? <Clock3 className="h-3.5 w-3.5" /> : undefined;
      const options = values.map((item) => {
        const optionValue = String(item);
        return isAspectRatio
          ? { value: optionValue, label: optionValue, visual: <><AspectRatioMark value={optionValue} /><span>{optionValue}</span></> }
          : { value: optionValue, label: isDuration ? `${optionValue}s` : optionValue };
      });
      return <div key={control.id}><CustomerSelect ariaLabel={isDuration ? (locale === "en" ? "Duration" : "المدة") : displayLabel} compact icon={compactIcon} label={isDuration || isAspectRatio ? undefined : displayLabel} disabled={Boolean(confirmation)} value={String(value)} options={options} onValueChange={(nextValue) => { const next = values.find((item) => String(item) === nextValue); if (next !== undefined) selectSetting(control.id, next); }} /></div>;
    })}
    </div>
    <label className="standard-panel-section block text-sm"><span className="standard-prompt-surface block"><span className="standard-field-label px-2.5 pt-2.5">Prompt</span><textarea value={prompt} disabled={Boolean(confirmation)} maxLength={recipe?.prompt.maxLength ?? 1200} onChange={(event) => { setPrompt(event.target.value); resetQuote(); }} placeholder={copy.prompt} className="w-full resize-none px-2.5 pb-2.5 text-[13px] leading-5" /></span></label>
    {error && <p role="alert" className="rounded-xl border border-red-300/25 bg-red-300/5 p-3 text-xs text-red-100">{error}</p>}
    <section className="standard-panel-section">
      {execution?.operation.state === "SETTLED" ? <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] p-3 text-center"><CheckCircle2 className="mx-auto h-5 w-5 text-emerald-300" /><p className="mt-1.5 text-[13px] font-bold">{copy.ready}</p></div> : confirmation || loading === "run" ? <div className="rounded-lg border border-white/[0.14] bg-white/[0.03] p-3 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-white" /><p className="mt-1.5 text-[13px] font-semibold">{copy.generating}</p></div> : <button type="button" disabled={!ready || loading === "quote" || loading === "confirm"} onClick={() => void generate()} className="standard-primary-action flex w-full items-center justify-center gap-2 px-3 py-2.5">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{loading === "quote" ? (locale === "en" ? "Checking price…" : "جارٍ التحقق من السعر…") : loading === "confirm" ? (locale === "en" ? "Starting generation…" : "جارٍ بدء التوليد…") : ready ? copy.generate : missingReference ? (missingPrompt ? copy.needs : copy.needsReference) : copy.needsPrompt}</button>}
    </section>
  </div>;
}
