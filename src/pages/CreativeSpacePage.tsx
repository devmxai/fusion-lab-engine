import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider,
  useNodesState, useReactFlow, type NodeMouseHandler, type OnMoveEnd,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Activity, Bug, ChevronLeft, CircleDollarSign, Download, FileAudio2, FileImage,
  FileVideo2, Focus, FolderOpen, ImagePlus, Library, Loader2, Maximize2, MousePointer2, PanelLeftClose,
  PanelLeftOpen, Plus, Redo2, Sparkles, Undo2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { addLocalAsset, applyAdvancedOperationResult, applyImageOperationResult, applyVideoOperationResult, createCreativeSpaceProject, createProfessionalAdvancedShot, createProfessionalGroup, createProfessionalSubflow, getProfessionalGraph, getSpaceViewMode, moveCanvasItem, placeReservedAdvancedOperation, placeReservedImageOperation, placeReservedVideoOperation, prepareProfessionalBatchBranch, saveProfessionalTemplate, setProjectViewport, setSpaceViewMode, type CreativeSpaceProject, type SpaceAsset, type SpaceOperation, type SpaceOperationState } from "@/features/creative-space/domain";
import { loadPersistedCreativeSpaceProject, projectDocumentForPersistence, ProjectPersistenceError, savePersistedCreativeSpaceProject } from "@/features/creative-space/project-client";
import { SpaceAssetNode } from "@/features/creative-space/SpaceAssetNode";
import { SpaceOperationNode } from "@/features/creative-space/SpaceOperationNode";
import { ProfessionalAssetNode } from "@/features/creative-space/ProfessionalAssetNode";
import { ProfessionalOperationNode } from "@/features/creative-space/ProfessionalOperationNode";
import { projectToFlow, type SpaceFlowNode } from "@/features/creative-space/xyflow-adapter";
import { assessProfessionalGraphBudget, projectToProfessionalGraph } from "@/features/creative-space/professional-graph";
import { ImageRecipeInspector } from "@/features/creative-space/ImageRecipeInspector";
import { VideoRecipeInspector } from "@/features/creative-space/VideoRecipeInspector";
import {
  clearImageComposerDraft, createImageComposerDraft, loadImageComposerDraft,
  saveImageComposerDraft, type ImageComposerDraft,
} from "@/features/creative-space/composer-draft";
import { getImageRecipeManifest, type ImageRecipeId } from "@/features/creative-space/image-recipes";
import { confirmImageQuote, downloadDeliveredAsset, readDeliveredAsset, recoverImageOperation, requestImageQuote, runImageOperation, type ConfirmedImageQuote, type ExecutedImageOperation, type ImageQuote, type RecoveredImageOperation } from "@/features/creative-space/image-quote-client";
import { clearVideoComposerDraft, createVideoComposerDraft, loadVideoComposerDraft, saveVideoComposerDraft, type VideoComposerDraft } from "@/features/creative-space/video-composer-draft";
import { getVideoRecipeManifest, type VideoRecipeId } from "@/features/creative-space/video-recipes";
import { confirmVideoQuote, recoverVideoOperation, requestVideoQuote, runVideoOperation, type ConfirmedVideoQuote, type ExecutedVideoOperation, type VideoQuote } from "@/features/creative-space/video-quote-client";
import { AdvancedRecipeInspector } from "@/features/creative-space/AdvancedRecipeInspector";
import { clearAdvancedComposerDraft, createAdvancedComposerDraft, loadAdvancedComposerDraft, saveAdvancedComposerDraft, type AdvancedComposerDraft } from "@/features/creative-space/advanced-composer-draft";
import { isAdvancedRecipeId, type AdvancedRecipeId } from "@/features/creative-space/advanced-recipes";
import { confirmAdvancedQuote, recoverAdvancedOperation, requestAdvancedQuote, runAdvancedOperation, type AdvancedQuote, type ConfirmedAdvancedQuote, type ExecutedAdvancedOperation } from "@/features/creative-space/advanced-quote-client";
import { loadPublishedOffers, publishedOfferSupportsRecipe, publishedSettingsEqual, reconcilePublishedOfferSettings, type PublishedOffer } from "@/features/creative-space/published-offers-client";
import { useProjectWriterLease } from "@/features/creative-space/project-writer-lease";
import { userFacingProjectActivitySummary } from "@/features/creative-space/product-decisions";
import { PROJECT_SAVE_LABELS, reduceProjectSaveState, type ProjectSaveState } from "@/features/creative-space/project-save-state";
import { clearOfflineStandardDraft, saveOfflineStandardDraft } from "@/features/creative-space/offline-standard-draft";
import { getStandardProjection } from "@/features/creative-space/standard-projection";
import { projectConflictAreas } from "@/features/creative-space/project-conflict";

const nodeTypes = { spaceAsset: SpaceAssetNode, spaceOperation: SpaceOperationNode, professionalAsset: ProfessionalAssetNode, professionalOperation: ProfessionalOperationNode };

type QuickAddState = { screen: { x: number; y: number }; flow: { x: number; y: number } } | null;

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export default function CreativeSpacePage() {
  return <ReactFlowProvider><CreativeSpaceInner /></ReactFlowProvider>;
}

function CreativeSpaceInner() {
  const { projectId = "local-demo" } = useParams();
  const navigate = useNavigate();
  const writerLease = useProjectWriterLease(projectId);
  const flow = useReactFlow<SpaceFlowNode>();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const fileInput = useRef<HTMLInputElement>(null);
  const [project, setProject] = useState<CreativeSpaceProject>(() => createCreativeSpaceProject(projectId));
  const [projectVersion, setProjectVersion] = useState<number | null>(null);
  const [projectReady, setProjectReady] = useState(false);
  const [saveState, setSaveState] = useState<ProjectSaveState>("LOADING");
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddState>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [graphToolsOpen, setGraphToolsOpen] = useState(false);
  const [debugViewOpen, setDebugViewOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const [viewerAsset, setViewerAsset] = useState<SpaceAsset | null>(null);
  const [downloadingAssetId, setDownloadingAssetId] = useState<string | null>(null);
  const [imageDraft, setImageDraft] = useState<ImageComposerDraft | null>(() => loadImageComposerDraft(projectId));
  const [videoDraft, setVideoDraft] = useState<VideoComposerDraft | null>(() => loadVideoComposerDraft(projectId));
  const [videoQuote, setVideoQuote] = useState<VideoQuote | null>(null);
  const [videoConfirmation, setVideoConfirmation] = useState<ConfirmedVideoQuote | null>(null);
  const [videoExecution, setVideoExecution] = useState<ExecutedVideoOperation | null>(null);
  const [advancedDraft, setAdvancedDraft] = useState<AdvancedComposerDraft | null>(() => loadAdvancedComposerDraft(projectId));
  const [advancedQuote, setAdvancedQuote] = useState<AdvancedQuote | null>(null);
  const [advancedConfirmation, setAdvancedConfirmation] = useState<ConfirmedAdvancedQuote | null>(null);
  const [advancedExecution, setAdvancedExecution] = useState<ExecutedAdvancedOperation | null>(null);
  const [imageQuote, setImageQuote] = useState<ImageQuote | null>(null);
  const [imageConfirmation, setImageConfirmation] = useState<ConfirmedImageQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [imageExecution, setImageExecution] = useState<ExecutedImageOperation | null>(null);
  const [executionLoading, setExecutionLoading] = useState(false);
  const [publishedOffers, setPublishedOffers] = useState<ReadonlyArray<PublishedOffer>>([]);
  const [publishedOffersState, setPublishedOffersState] = useState<"LOADING" | "READY" | "UNAVAILABLE">("LOADING");
  const confirmKeys = useRef(new Map<string, string>());
  const recoveredOperations = useRef(new Set<string>());
  const persistedProjectDocument = useRef<string | null>(null);
  const projectConflictBlocked = useRef(false);
  const hydratedDeliveryAssets = useRef(new Set<string>());
  const viewMode = getSpaceViewMode(project);
  const professionalGraph = getProfessionalGraph(project);
  const adapted = useMemo(() => projectToFlow(project, viewMode), [project, viewMode]);
  const professionalProjection = useMemo(() => {
    const startedAt = performance.now();
    const projection = projectToProfessionalGraph(project);
    return { projection, projectionMilliseconds: performance.now() - startedAt };
  }, [project]);
  const professionalBudget = useMemo(() => assessProfessionalGraphBudget(professionalProjection.projection, {
    timelineClipCount: Object.keys(professionalGraph.timelineClips).length,
    projectionMilliseconds: professionalProjection.projectionMilliseconds,
  }), [professionalGraph.timelineClips, professionalProjection]);
  const [nodes, setNodes, onNodesChange] = useNodesState<SpaceFlowNode>(adapted.nodes);
  const selectedAsset = selectedAssetId ? project.assets[selectedAssetId] ?? null : null;
  const inspectorAsset = imageDraft?.inputAssetId
    ? project.assets[imageDraft.inputAssetId] ?? null
    : selectedAsset;
  const hasPendingFinancialOperation = (!!imageConfirmation && !imageExecution)
    || (!!videoConfirmation && !videoExecution)
    || (!!advancedConfirmation && !advancedExecution);

  useEffect(() => setNodes(adapted.nodes), [adapted.nodes, setNodes]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    setSaveState((current) => reduceProjectSaveState(current, online
      ? { type: "NETWORK_ONLINE", hasUnsavedChanges: !!projectReady && JSON.stringify(projectDocumentForPersistence(project)) !== persistedProjectDocument.current }
      : { type: "NETWORK_OFFLINE" }));
  }, [online]);
  useEffect(() => {
    if (!writerLease.ready || writerLease.isWriter) return;
    setSaveState((current) => reduceProjectSaveState(current, { type: "SECONDARY_TAB" }));
    toast.error("هذا المشروع مفتوح في تبويب آخر. استخدم التبويب الأصلي للتعديل.");
    navigate("/projects", { replace: true });
  }, [navigate, writerLease.isWriter, writerLease.ready]);
  useEffect(() => {
    let cancelled = false;
    void loadPublishedOffers().then((offers) => {
      if (cancelled) return;
      setPublishedOffers(offers);
      setPublishedOffersState("READY");
    }).catch((error) => {
      if (cancelled) return;
      setPublishedOffers([]);
      setPublishedOffersState("UNAVAILABLE");
      toast.error(error instanceof Error ? error.message : "تعذر تحميل كتالوج النماذج المنشورة");
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (publishedOffersState !== "READY") return;
    setImageDraft((current) => {
      if (!current?.offerId) return current;
      const offer = publishedOffers.find((candidate) => candidate.offerId === current.offerId);
      if (!offer) return current;
      const settings = reconcilePublishedOfferSettings(offer, current.recipeId, current.settings);
      if (!settings || (current.modelId === offer.providerModelId && publishedSettingsEqual(current.settings, settings))) return current;
      return { ...current, modelId: offer.providerModelId, settings: settings as ImageComposerDraft["settings"], updatedAt: new Date().toISOString() };
    });
    setVideoDraft((current) => {
      if (!current?.offerId) return current;
      const offer = publishedOffers.find((candidate) => candidate.offerId === current.offerId);
      if (!offer) return current;
      const settings = reconcilePublishedOfferSettings(offer, current.recipeId, current.settings);
      if (!settings || (current.modelId === offer.providerModelId && publishedSettingsEqual(current.settings, settings))) return current;
      return { ...current, modelId: offer.providerModelId, settings, updatedAt: new Date().toISOString() };
    });
    setAdvancedDraft((current) => {
      if (!current?.offerId) return current;
      const offer = publishedOffers.find((candidate) => candidate.offerId === current.offerId);
      if (!offer) return current;
      const settings = reconcilePublishedOfferSettings(offer, current.recipeId, current.settings);
      if (!settings || (current.modelId === offer.providerModelId && publishedSettingsEqual(current.settings, settings))) return current;
      return { ...current, modelId: offer.providerModelId, settings, updatedAt: new Date().toISOString() };
    });
  }, [publishedOffers, publishedOffersState]);
  useEffect(() => {
    let cancelled = false;
    setSaveState((current) => reduceProjectSaveState(current, { type: "LOAD_STARTED" }));
    setProjectReady(false);
    setProjectVersion(null);
    projectConflictBlocked.current = false;
    persistedProjectDocument.current = null;
    setProject(createCreativeSpaceProject(projectId));
    void loadPersistedCreativeSpaceProject(projectId).then((saved) => {
      if (cancelled) return;
      const next = saved?.document ?? createCreativeSpaceProject(projectId);
      persistedProjectDocument.current = saved ? JSON.stringify(next) : null;
      setProject(next);
      setProjectVersion(saved?.version ?? 0);
      setProjectReady(true);
      setSaveState((current) => reduceProjectSaveState(current, { type: "LOAD_SUCCEEDED" }));
    }).catch((error) => {
      if (!cancelled) {
        setSaveState((current) => reduceProjectSaveState(current, { type: "SAVE_FAILED" }));
        toast.error(error instanceof Error ? error.message : "تعذر تحميل المشروع من المحرك");
      }
    });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!writerLease.ready || !writerLease.isWriter || !projectReady || projectVersion === null) return;
    const document = projectDocumentForPersistence(project);
    const snapshot = JSON.stringify(document);
    if (snapshot === persistedProjectDocument.current) return;
    if (projectConflictBlocked.current) return;
    if (!online) {
      saveOfflineStandardDraft({
        schemaVersion: 1,
        projectId,
        baseProjectVersion: projectVersion,
        projection: getStandardProjection(project),
        savedAt: new Date().toISOString(),
      });
      setSaveState((current) => reduceProjectSaveState(current, { type: "NETWORK_OFFLINE" }));
      return;
    }
    setSaveState((current) => reduceProjectSaveState(current, { type: "LOCAL_CHANGE", online: true }));
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSaveState((current) => reduceProjectSaveState(current, { type: "SAVE_STARTED" }));
      void savePersistedCreativeSpaceProject(document, projectVersion).then((saved) => {
        if (cancelled) return;
        persistedProjectDocument.current = snapshot;
        setProjectVersion(saved.version);
        clearOfflineStandardDraft(projectId);
        setSaveState((current) => reduceProjectSaveState(current, { type: "SAVE_SUCCEEDED" }));
      }).catch(async (error) => {
        if (cancelled) return;
        if (error instanceof ProjectPersistenceError && error.status === 409) {
          saveOfflineStandardDraft({
            schemaVersion: 1,
            projectId,
            baseProjectVersion: projectVersion,
            projection: getStandardProjection(project),
            savedAt: new Date().toISOString(),
          });
          setSaveState((current) => reduceProjectSaveState(current, { type: "VERSION_CONFLICT" }));
          const latest = await loadPersistedCreativeSpaceProject(projectId).catch(() => null);
          if (latest && !cancelled) {
            projectConflictBlocked.current = true;
            const areas = projectConflictAreas(document, latest.document);
            toast.error(`توقف الحفظ بسبب تعديل من جلسة أخرى. احتفظنا بتعديلاتك محلياً ولم نستبدلها. مواضع التعارض: ${areas.join(", ") || "PROJECT"}.`);
            return;
          }
        }
        setSaveState((current) => reduceProjectSaveState(current, { type: "SAVE_FAILED" }));
        toast.error(error instanceof Error ? error.message : "تعذر حفظ المشروع في المحرك");
      });
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [online, project, projectId, projectReady, projectVersion, writerLease.isWriter, writerLease.ready]);
  useEffect(() => {
    if (!projectReady) return;
    for (const asset of Object.values(project.assets)) {
      if (!asset.deliveryAssetId || asset.resultUrl || hydratedDeliveryAssets.current.has(asset.deliveryAssetId)) continue;
      hydratedDeliveryAssets.current.add(asset.deliveryAssetId);
      void readDeliveredAsset(asset.deliveryAssetId).then((resultUrl) => {
        setProject((current) => {
          const latest = current.assets[asset.id];
          if (!latest || latest.deliveryAssetId !== asset.deliveryAssetId || latest.resultUrl) return current;
          return { ...current, assets: { ...current.assets, [asset.id]: { ...latest, resultUrl } } };
        });
      }).catch(() => toast.error("تعذر تحميل معاينة الأصل الخاص للمشروع"));
    }
  }, [project.assets, projectReady]);
  useEffect(() => { if (imageDraft) saveImageComposerDraft(imageDraft); }, [imageDraft]);
  useEffect(() => { if (videoDraft) saveVideoComposerDraft(videoDraft); }, [videoDraft]);
  useEffect(() => { if (advancedDraft) saveAdvancedComposerDraft(advancedDraft); }, [advancedDraft]);
  useEffect(() => {
    const recoverable = Object.values(project.operations)
      .filter(({ outputAssetId, state }) => !outputAssetId && !["PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(state))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!recoverable || recoveredOperations.current.has(recoverable.id)) return;
    recoveredOperations.current.add(recoverable.id);
    if (isAdvancedRecipeId(recoverable.recipeId)) {
      void recoverAdvancedOperation(recoverable.id).then((recovered) => {
        setAdvancedQuote(recovered.quote);
        setAdvancedConfirmation({ quote: recovered.quote, operation: recovered.operation, wallet: recovered.wallet, localOnly: true });
        if (recovered.operation.state === "SETTLED") {
          const execution: ExecutedAdvancedOperation = { ...recovered, timeline: [] };
          setAdvancedExecution(execution);
          setProject((current) => applyAdvancedOperationResult(current, {
            operationId: recovered.operation.id,
            state: recovered.operation.state,
            outputKind: recovered.quote.outputKind,
            resultUrl: recovered.operation.resultUrl,
            deliveryAssetId: recovered.operation.delivery?.assetId ?? null,
            checksumSha256: recovered.operation.assetChecksumSha256,
            customerChargedCredits: recovered.operation.financials.customerChargedCredits,
            providerChargedCredits: recovered.operation.financials.providerChargedCredits,
            updatedAt: recovered.operation.updatedAt,
          }));
        }
        toast.success(`تمت استعادة عملية ${recovered.quote.recipeId} بعد التحديث`);
      }).catch(() => toast.error("تعذر استعادة العملية المتقدمة المحلية؛ قد يكون Engine أُعيد تشغيله"));
      return;
    }
    if (recoverable.recipeId.startsWith("video.")) {
      void recoverVideoOperation(recoverable.id).then((recovered) => {
        setVideoQuote(recovered.quote);
        setVideoConfirmation({ quote: recovered.quote, operation: recovered.operation, wallet: recovered.wallet, localOnly: true });
        if (recovered.operation.state === "SETTLED") {
          const execution = { ...recovered, timeline: [] } as ExecutedVideoOperation;
          setVideoExecution(execution);
          setProject((current) => applyVideoOperationResult(current, {
            operationId: recovered.operation.id,
            state: recovered.operation.state,
            resultUrl: recovered.operation.resultUrl,
            deliveryAssetId: recovered.operation.delivery?.assetId ?? null,
            checksumSha256: recovered.operation.assetChecksumSha256,
            customerChargedCredits: recovered.operation.financials.customerChargedCredits,
            providerChargedCredits: recovered.operation.financials.providerChargedCredits,
            updatedAt: recovered.operation.updatedAt,
          }));
        }
        toast.success(`تمت استعادة عملية الفيديو ${recovered.operation.id.slice(0, 8)} بعد التحديث`);
      }).catch(() => toast.error("تعذر استعادة عملية الفيديو المحلية؛ قد يكون Engine أُعيد تشغيله"));
      return;
    }
    void recoverImageOperation(recoverable.id).then(async (recovered) => {
      setImageQuote(recovered.quote);
      setImageConfirmation({ quote: recovered.quote, operation: recovered.operation, wallet: recovered.wallet, localOnly: true });
      if (["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(recovered.operation.state)) {
        const resultUrl = recovered.operation.state === "SETTLED" && recovered.operation.delivery?.assetId
          ? await readDeliveredAsset(recovered.operation.delivery.assetId)
          : recovered.operation.resultUrl ?? null;
        const execution = {
          ...recovered,
          operation: {
            ...recovered.operation,
            state: recovered.operation.state as ExecutedImageOperation["operation"]["state"],
            resultUrl,
            assetChecksumSha256: recovered.operation.delivery?.checksumSha256 ?? recovered.operation.assetChecksumSha256 ?? null,
          },
          timeline: recovered.operation.events.map(({ state, at }) => ({ state, at })),
        } as ExecutedImageOperation;
        setImageExecution(execution);
        setProject((current) => applyImageOperationResult(current, {
          operationId: execution.operation.id,
          state: execution.operation.state,
          resultUrl: execution.operation.resultUrl ?? null,
          deliveryAssetId: execution.operation.delivery?.assetId ?? null,
          contentType: execution.operation.delivery?.contentType ?? null,
          byteLength: execution.operation.delivery?.byteLength ?? null,
          checksumSha256: execution.operation.assetChecksumSha256 ?? null,
          customerChargedCredits: execution.operation.financials.customerChargedCredits,
          providerChargedCredits: execution.operation.financials.providerChargedCredits,
          updatedAt: execution.operation.updatedAt,
        }));
      }
      toast.success(`تمت استعادة العملية ${recovered.operation.id.slice(0, 8)} بعد التحديث`);
    }).catch(() => {
      toast.error("تعذر استعادة العملية من المحرك؛ أعد المحاولة بعد لحظات");
    });
  }, [project.operations]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "a" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input,textarea,[contenteditable=true]")) return;
      event.preventDefault();
      const center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      setQuickAdd({ screen: center, flow: flow.screenToFlowPosition(center) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flow]);

  const openQuickAdd = useCallback((clientX: number, clientY: number) => {
    const screen = { x: clientX, y: clientY };
    setQuickAdd({ screen, flow: flow.screenToFlowPosition(screen) });
  }, [flow]);

  const openQuickAddFromButton = () => {
    const center = { x: Math.round(window.innerWidth * 0.58), y: Math.round(window.innerHeight * 0.45) };
    openQuickAdd(center.x, center.y);
  };

  const fitProject = () => {
    void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 250 });
  };

  const startImageRecipe = (recipeId: ImageRecipeId, anchor?: { x: number; y: number }) => {
    if (hasPendingFinancialOperation) {
      toast.error("أكمل العملية المحجوزة قبل بدء وصفة أخرى");
      return;
    }
    const manifest = getImageRecipeManifest(recipeId);
    const offer = publishedOffers.find((candidate) => publishedOfferSupportsRecipe(candidate, recipeId));
    if (!offer) {
      toast.error(publishedOffersState === "LOADING" ? "جارٍ تحميل كتالوج النماذج المنشورة" : "لا يوجد نموذج صور منشور ومفعّل بعد. فعّله من الإدارة أولاً.");
      return;
    }
    const inputAsset = selectedAsset?.kind === "IMAGE" ? selectedAsset : null;
    if (manifest.input.required && !inputAsset) {
      toast.error("حدد صورة أولاً لبدء هذه الوصفة");
      return;
    }
    const selectedItem = inputAsset
      ? Object.values(project.canvasItems).find(({ entityType, entityId }) => entityType === "ASSET" && entityId === inputAsset.id)
      : null;
    setImageQuote(null);
    setImageConfirmation(null);
    setImageExecution(null);
    setVideoQuote(null);
    setVideoConfirmation(null);
    setVideoExecution(null);
    clearAdvancedComposerDraft(projectId);
    setAdvancedDraft(null);
    setAdvancedQuote(null);
    setAdvancedConfirmation(null);
    setAdvancedExecution(null);
    clearVideoComposerDraft(projectId);
    setVideoDraft(null);
    const draft = createImageComposerDraft({
      projectId,
      recipeId,
      inputAssetId: inputAsset?.id ?? null,
      anchor: anchor ?? (selectedItem
        ? { x: selectedItem.position.x + selectedItem.size.width + 80, y: selectedItem.position.y }
        : flow.screenToFlowPosition({ x: window.innerWidth * 0.58, y: window.innerHeight * 0.45 })),
    });
    const settings = reconcilePublishedOfferSettings(offer, recipeId, draft.settings);
    if (!settings) {
      toast.error("إعدادات العرض المنشور غير مكتملة؛ أعد نشر النموذج من الإدارة.");
      return;
    }
    setImageDraft({ ...draft, offerId: offer.offerId, modelId: offer.providerModelId, settings: settings as ImageComposerDraft["settings"] });
    setQuickAdd(null);
    if (!isDesktop) setMobileInspectorOpen(true);
  };

  const startVideoRecipe = (recipeId: VideoRecipeId, anchor?: { x: number; y: number }) => {
    if (hasPendingFinancialOperation) {
      toast.error("أكمل العملية المحجوزة قبل بدء وصفة أخرى");
      return;
    }
    const manifest = getVideoRecipeManifest(recipeId);
    const offer = publishedOffers.find((candidate) => publishedOfferSupportsRecipe(candidate, recipeId));
    if (!offer) {
      toast.error(publishedOffersState === "LOADING" ? "جارٍ تحميل كتالوج النماذج المنشورة" : "لا يوجد نموذج فيديو منشور ومفعّل بعد. فعّله من الإدارة أولاً.");
      return;
    }
    const initialAsset = selectedAsset?.kind === "IMAGE" ? selectedAsset : null;
    if (manifest.bindings.min > 0 && !initialAsset && recipeId === "video.image-to-video") {
      toast.error("حدد صورة أولاً لبدء Image to Video");
      return;
    }
    const selectedItem = initialAsset
      ? Object.values(project.canvasItems).find(({ entityType, entityId }) => entityType === "ASSET" && entityId === initialAsset.id)
      : null;
    clearImageComposerDraft(projectId);
    setImageDraft(null);
    setImageQuote(null);
    setImageConfirmation(null);
    setImageExecution(null);
    setVideoQuote(null);
    setVideoConfirmation(null);
    setVideoExecution(null);
    clearAdvancedComposerDraft(projectId);
    setAdvancedDraft(null);
    setAdvancedQuote(null);
    setAdvancedConfirmation(null);
    setAdvancedExecution(null);
    const draft = createVideoComposerDraft({
      projectId,
      recipeId,
      initialAssetId: initialAsset?.id ?? null,
      anchor: anchor ?? (selectedItem
        ? { x: selectedItem.position.x + selectedItem.size.width + 80, y: selectedItem.position.y }
        : flow.screenToFlowPosition({ x: window.innerWidth * 0.58, y: window.innerHeight * 0.45 })),
    });
    const settings = reconcilePublishedOfferSettings(offer, recipeId, draft.settings);
    if (!settings) {
      toast.error("إعدادات عرض الفيديو المنشور غير مكتملة؛ أعد نشر النموذج من الإدارة.");
      return;
    }
    setVideoDraft({ ...draft, offerId: offer.offerId, modelId: offer.providerModelId, settings });
    setQuickAdd(null);
    if (!isDesktop) setMobileInspectorOpen(true);
  };

  const startAdvancedRecipe = (recipeId: AdvancedRecipeId, anchor?: { x: number; y: number }) => {
    if (hasPendingFinancialOperation) {
      toast.error("أكمل العملية المحجوزة قبل بدء وصفة أخرى");
      return;
    }
    const initialAsset = selectedAsset?.status === "READY" ? selectedAsset : null;
    const media = recipeId === "audio.tts" ? "audio" : "video";
    const offer = publishedOffers.find((candidate) => publishedOfferSupportsRecipe(candidate, recipeId));
    if (!offer) {
      toast.error(publishedOffersState === "LOADING" ? "جارٍ تحميل كتالوج النماذج المنشورة" : `لا يوجد نموذج ${media === "audio" ? "صوت" : "فيديو"} منشور ومفعّل بعد. فعّله من الإدارة أولاً.`);
      return;
    }
    const selectedItem = initialAsset
      ? Object.values(project.canvasItems).find(({ entityType, entityId }) => entityType === "ASSET" && entityId === initialAsset.id)
      : null;
    clearImageComposerDraft(projectId);
    clearVideoComposerDraft(projectId);
    setImageDraft(null);
    setVideoDraft(null);
    setImageQuote(null);
    setImageConfirmation(null);
    setImageExecution(null);
    setVideoQuote(null);
    setVideoConfirmation(null);
    setVideoExecution(null);
    setAdvancedQuote(null);
    setAdvancedConfirmation(null);
    setAdvancedExecution(null);
    const draft = createAdvancedComposerDraft({
      projectId,
      recipeId,
      initialAsset: initialAsset ? { id: initialAsset.id, kind: initialAsset.kind } : null,
      anchor: anchor ?? (selectedItem
        ? { x: selectedItem.position.x + selectedItem.size.width + 80, y: selectedItem.position.y }
        : flow.screenToFlowPosition({ x: window.innerWidth * 0.58, y: window.innerHeight * 0.45 })),
    });
    const settings = reconcilePublishedOfferSettings(offer, recipeId, draft.settings);
    if (!settings) {
      toast.error("إعدادات العرض المنشور غير مكتملة؛ أعد نشر النموذج من الإدارة.");
      return;
    }
    setAdvancedDraft({ ...draft, offerId: offer.offerId, modelId: offer.providerModelId, settings });
    setQuickAdd(null);
    if (!isDesktop) setMobileInspectorOpen(true);
  };

  const closeImageDraft = () => {
    if (imageConfirmation && !imageExecution) {
      toast.error("أكمل العملية المحجوزة قبل إغلاق الوصفة");
      return;
    }
    clearImageComposerDraft(projectId);
    setImageQuote(null);
    setImageConfirmation(null);
    setImageExecution(null);
    setImageDraft(null);
  };

  const closeVideoDraft = () => {
    if (videoConfirmation && !videoExecution) {
      toast.error("أكمل عملية الفيديو المحجوزة قبل إغلاق الوصفة");
      return;
    }
    clearVideoComposerDraft(projectId);
    setVideoQuote(null);
    setVideoConfirmation(null);
    setVideoExecution(null);
    setVideoDraft(null);
  };

  const closeAdvancedDraft = () => {
    if (advancedConfirmation && !advancedExecution) {
      toast.error("أكمل العملية المحجوزة قبل إغلاق الوصفة");
      return;
    }
    clearAdvancedComposerDraft(projectId);
    setAdvancedQuote(null);
    setAdvancedConfirmation(null);
    setAdvancedExecution(null);
    setAdvancedDraft(null);
  };

  const changeImageDraft = (next: ImageComposerDraft) => {
    if (imageConfirmation && !imageExecution) return;
    setImageQuote(null);
    setImageConfirmation(null);
    setImageExecution(null);
    setImageDraft(next);
  };

  const changeVideoDraft = (next: VideoComposerDraft) => {
    if (videoConfirmation && !videoExecution) return;
    setVideoQuote(null);
    setVideoConfirmation(null);
    setVideoExecution(null);
    setVideoDraft(next);
  };

  const changeAdvancedDraft = (next: AdvancedComposerDraft) => {
    if (advancedConfirmation && !advancedExecution) return;
    setAdvancedQuote(null);
    setAdvancedConfirmation(null);
    setAdvancedExecution(null);
    setAdvancedDraft(next);
  };

  const requireOnlineExecution = () => {
    if (online) return true;
    toast.error("أنت دون اتصال. يمكنك تعديل المسودة فقط؛ التسعير والحجز والتوليد متوقفة حتى عودة الاتصال.");
    return false;
  };

  const quoteAdvancedDraft = async () => {
    if (!advancedDraft || !requireOnlineExecution()) return;
    setQuoteLoading(true);
    try {
      const quote = await requestAdvancedQuote(advancedDraft, project);
      setAdvancedQuote(quote);
      setAdvancedConfirmation(null);
      toast.success(`السعر النهائي ${quote.customerCredits} كريديت — لا يوجد خصم قبل التأكيد`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حساب السعر");
    } finally { setQuoteLoading(false); }
  };

  const confirmCurrentAdvancedQuote = async () => {
    if (!advancedQuote || advancedConfirmation || !requireOnlineExecution()) return;
    setConfirmLoading(true);
    try {
      let key = confirmKeys.current.get(advancedQuote.id);
      if (!key) {
        key = `space-advanced:${crypto.randomUUID()}`;
        confirmKeys.current.set(advancedQuote.id, key);
      }
      const confirmation = await confirmAdvancedQuote(advancedQuote, key);
      setAdvancedConfirmation(confirmation);
      if (advancedDraft) {
        setProject((current) => placeReservedAdvancedOperation(current, {
          operation: { ...confirmation.operation, state: "RESERVED" },
          recipeId: advancedDraft.recipeId,
          bindings: advancedDraft.bindings,
          anchor: advancedDraft.anchor,
        }));
      }
      toast.success(`تم حجز ${confirmation.operation.financials.customerQuotedCredits} كريديت وبدأ المحرك التنفيذ تلقائياً`);
      setExecutionLoading(true);
      const execution = await runAdvancedOperation(confirmation.operation.id);
      setAdvancedExecution(execution);
      setProject((current) => applyAdvancedOperationResult(current, {
        operationId: execution.operation.id,
        state: execution.operation.state,
        outputKind: execution.quote.outputKind,
        resultUrl: execution.operation.resultUrl,
        deliveryAssetId: execution.operation.delivery?.assetId ?? null,
        checksumSha256: execution.operation.assetChecksumSha256,
        customerChargedCredits: execution.operation.financials.customerChargedCredits,
        providerChargedCredits: execution.operation.financials.providerChargedCredits,
        updatedAt: execution.operation.updatedAt,
      }));
      if (execution.operation.state === "SETTLED") {
        setSelectedAssetId(`output:${execution.operation.id}`);
        toast.success(`اكتملت النتيجة: تم خصم ${execution.operation.financials.customerChargedCredits} كريديت`);
      } else toast.error(`توقفت العملية بالحالة ${execution.operation.state}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تأكيد السعر");
    } finally { setConfirmLoading(false); setExecutionLoading(false); }
  };

  const runCurrentAdvancedOperation = async () => {
    if (!advancedConfirmation || advancedExecution || !requireOnlineExecution()) return;
    setExecutionLoading(true);
    try {
      const execution = await runAdvancedOperation(advancedConfirmation.operation.id);
      setAdvancedExecution(execution);
      setProject((current) => applyAdvancedOperationResult(current, {
        operationId: execution.operation.id,
        state: execution.operation.state,
        outputKind: execution.quote.outputKind,
        resultUrl: execution.operation.resultUrl,
        deliveryAssetId: execution.operation.delivery?.assetId ?? null,
        checksumSha256: execution.operation.assetChecksumSha256,
        customerChargedCredits: execution.operation.financials.customerChargedCredits,
        providerChargedCredits: execution.operation.financials.providerChargedCredits,
        updatedAt: execution.operation.updatedAt,
      }));
      if (execution.operation.state === "SETTLED") {
        setSelectedAssetId(`output:${execution.operation.id}`);
        toast.success(`اكتملت النتيجة: تم خصم ${execution.operation.financials.customerChargedCredits} كريديت`);
      } else toast.error(`توقفت العملية بالحالة ${execution.operation.state}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تشغيل العملية المحلية");
    } finally { setExecutionLoading(false); }
  };

  const quoteVideoDraft = async () => {
    if (!videoDraft || !requireOnlineExecution()) return;
    setQuoteLoading(true);
    try {
      const quote = await requestVideoQuote(videoDraft, project);
      setVideoQuote(quote);
      setVideoConfirmation(null);
      toast.success(`سعر الفيديو النهائي ${quote.customerCredits} كريديت — لا يوجد خصم قبل التأكيد`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حساب سعر الفيديو");
    } finally {
      setQuoteLoading(false);
    }
  };

  const confirmCurrentVideoQuote = async () => {
    if (!videoQuote || videoConfirmation || !requireOnlineExecution()) return;
    setConfirmLoading(true);
    try {
      let key = confirmKeys.current.get(videoQuote.id);
      if (!key) {
        key = `space-video:${crypto.randomUUID()}`;
        confirmKeys.current.set(videoQuote.id, key);
      }
      const confirmation = await confirmVideoQuote(videoQuote, key);
      setVideoConfirmation(confirmation);
      if (videoDraft) {
        setProject((current) => placeReservedVideoOperation(current, {
          operation: { ...confirmation.operation, state: "RESERVED" },
          recipeId: videoDraft.recipeId,
          bindings: videoDraft.bindings.map(({ assetId, slot: role, ordinal }) => ({ assetId, role, ordinal })),
          anchor: videoDraft.anchor,
        }));
      }
      toast.success(`تم حجز ${confirmation.operation.financials.customerQuotedCredits} كريديت وبدأ المحرك التنفيذ تلقائياً`);
      setExecutionLoading(true);
      const execution = await runVideoOperation(confirmation.operation.id);
      setVideoExecution(execution);
      setProject((current) => applyVideoOperationResult(current, {
        operationId: execution.operation.id,
        state: execution.operation.state,
        resultUrl: execution.operation.resultUrl,
        deliveryAssetId: execution.operation.delivery?.assetId ?? null,
        checksumSha256: execution.operation.assetChecksumSha256,
        customerChargedCredits: execution.operation.financials.customerChargedCredits,
        providerChargedCredits: execution.operation.financials.providerChargedCredits,
        updatedAt: execution.operation.updatedAt,
      }));
      if (execution.operation.state === "SETTLED") {
        setSelectedAssetId(`output:${execution.operation.id}`);
        toast.success(`اكتمل الفيديو: تم خصم ${execution.operation.financials.customerChargedCredits} كريديت`);
      } else toast.error(`توقفت عملية الفيديو بالحالة ${execution.operation.state}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تأكيد سعر الفيديو");
    } finally {
      setConfirmLoading(false);
      setExecutionLoading(false);
    }
  };

  const runCurrentVideoOperation = async () => {
    if (!videoConfirmation || videoExecution || !requireOnlineExecution()) return;
    setExecutionLoading(true);
    try {
      const execution = await runVideoOperation(videoConfirmation.operation.id);
      setVideoExecution(execution);
      setProject((current) => applyVideoOperationResult(current, {
        operationId: execution.operation.id,
        state: execution.operation.state,
        resultUrl: execution.operation.resultUrl,
        deliveryAssetId: execution.operation.delivery?.assetId ?? null,
        checksumSha256: execution.operation.assetChecksumSha256,
        customerChargedCredits: execution.operation.financials.customerChargedCredits,
        providerChargedCredits: execution.operation.financials.providerChargedCredits,
        updatedAt: execution.operation.updatedAt,
      }));
      if (execution.operation.state === "SETTLED") {
        setSelectedAssetId(`output:${execution.operation.id}`);
        toast.success(`اكتمل الفيديو: تم خصم ${execution.operation.financials.customerChargedCredits} كريديت`);
      } else {
        toast.error(`توقفت عملية الفيديو بالحالة ${execution.operation.state}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تشغيل عملية الفيديو المحلية");
    } finally {
      setExecutionLoading(false);
    }
  };

  const trackImageOperation = (progress: RecoveredImageOperation) => {
    setImageConfirmation({
      quote: progress.quote,
      operation: progress.operation,
      wallet: progress.wallet,
      localOnly: progress.localOnly,
      durable: progress.durable,
    });
    setProject((current) => {
      if (!current.operations[progress.operation.id]) return current;
      return applyImageOperationResult(current, {
        operationId: progress.operation.id,
        state: progress.operation.state,
        resultUrl: null,
        deliveryAssetId: progress.operation.delivery?.assetId ?? null,
        contentType: progress.operation.delivery?.contentType ?? null,
        byteLength: progress.operation.delivery?.byteLength ?? null,
        checksumSha256: null,
        customerChargedCredits: progress.operation.financials.customerChargedCredits,
        providerChargedCredits: progress.operation.financials.providerChargedCredits,
        updatedAt: progress.operation.updatedAt,
      });
    });
  };

  const quoteImageDraft = async () => {
    if (!imageDraft || !requireOnlineExecution()) return;
    setQuoteLoading(true);
    try {
      const asset = imageDraft.inputAssetId ? project.assets[imageDraft.inputAssetId] ?? null : null;
      const quote = await requestImageQuote(imageDraft, asset);
      setImageQuote(quote);
      setImageConfirmation(null);
      toast.success(`السعر النهائي ${quote.customerCredits} كريديت — لا يوجد خصم قبل التأكيد`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حساب السعر");
    } finally {
      setQuoteLoading(false);
    }
  };

  const confirmCurrentQuote = async () => {
    if (!imageQuote || imageConfirmation || !requireOnlineExecution()) return;
    setConfirmLoading(true);
    try {
      let key = confirmKeys.current.get(imageQuote.id);
      if (!key) {
        key = `space-image:${crypto.randomUUID()}`;
        confirmKeys.current.set(imageQuote.id, key);
      }
      const confirmation = await confirmImageQuote(imageQuote, key);
      setImageConfirmation(confirmation);
      if (imageDraft) {
        const manifest = getImageRecipeManifest(imageDraft.recipeId);
        setProject((current) => placeReservedImageOperation(current, {
          operation: { ...confirmation.operation, state: "RESERVED" },
          recipeId: imageDraft.recipeId,
          inputAssetId: imageDraft.inputAssetId,
          inputRole: manifest.input.role,
          anchor: imageDraft.anchor,
        }));
      }
      toast.success(`تم حجز ${confirmation.operation.financials.customerQuotedCredits} كريديت وبدأ المحرك التنفيذ تلقائياً`);
      setExecutionLoading(true);
      const execution = await runImageOperation(confirmation.operation.id, trackImageOperation);
      setImageExecution(execution);
      setImageConfirmation({ quote: execution.quote, operation: execution.operation, wallet: execution.wallet, localOnly: execution.localOnly, durable: execution.durable });
      setProject((current) => applyImageOperationResult(current, {
        operationId: execution.operation.id,
        state: execution.operation.state,
        resultUrl: execution.operation.resultUrl,
        deliveryAssetId: execution.operation.delivery?.assetId ?? null,
        contentType: execution.operation.delivery?.contentType ?? null,
        byteLength: execution.operation.delivery?.byteLength ?? null,
        checksumSha256: execution.operation.assetChecksumSha256,
        customerChargedCredits: execution.operation.financials.customerChargedCredits,
        providerChargedCredits: execution.operation.financials.providerChargedCredits,
        updatedAt: execution.operation.updatedAt,
      }));
      if (execution.operation.state === "SETTLED") {
        setSelectedAssetId(`output:${execution.operation.id}`);
        toast.success("تم إنشاء Output وحفظه وربطه بالـLineage");
      } else toast.error(`توقفت العملية بالحالة ${execution.operation.state}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تأكيد السعر");
    } finally {
      setConfirmLoading(false);
      setExecutionLoading(false);
    }
  };

  const runCurrentImageOperation = async () => {
    if (!imageConfirmation || imageExecution || !requireOnlineExecution()) return;
    setExecutionLoading(true);
    try {
      const execution = await runImageOperation(imageConfirmation.operation.id, trackImageOperation);
      setImageExecution(execution);
      setImageConfirmation({ quote: execution.quote, operation: execution.operation, wallet: execution.wallet, localOnly: execution.localOnly, durable: execution.durable });
      setProject((current) => applyImageOperationResult(current, {
        operationId: execution.operation.id,
        state: execution.operation.state,
        resultUrl: execution.operation.resultUrl,
        deliveryAssetId: execution.operation.delivery?.assetId ?? null,
        contentType: execution.operation.delivery?.contentType ?? null,
        byteLength: execution.operation.delivery?.byteLength ?? null,
        checksumSha256: execution.operation.assetChecksumSha256,
        customerChargedCredits: execution.operation.financials.customerChargedCredits,
        providerChargedCredits: execution.operation.financials.providerChargedCredits,
        updatedAt: execution.operation.updatedAt,
      }));
      if (execution.operation.state === "SETTLED") {
        setSelectedAssetId(`output:${execution.operation.id}`);
        toast.success("تم إنشاء Output وحفظه وربطه بالـLineage");
      } else {
        toast.error(`توقفت العملية بالحالة ${execution.operation.state}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تشغيل العملية المحلية");
    } finally {
      setExecutionLoading(false);
    }
  };

  const uploadFiles = (files: FileList | null) => {
    if (!files?.length) return;
    if (!online) {
      toast.error("رفع الملفات غير متاح دون اتصال. بقيت مسودة الإعدادات محفوظة محلياً.");
      return;
    }
    const anchor = quickAdd?.flow ?? flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    let next = project;
    let accepted = 0;
    Array.from(files).forEach((file, index) => {
      try {
        next = addLocalAsset(next, {
          name: file.name,
          mimeType: file.type,
          bytes: file.size,
          position: { x: anchor.x + index * 28, y: anchor.y + index * 28 },
        });
        accepted += 1;
      } catch {
        toast.error(`${file.name}: نوع الملف غير مدعوم`);
      }
    });
    setProject(next);
    setQuickAdd(null);
    if (accepted) toast.success(`تمت إضافة ${accepted} بطاقة محلية إلى المشروع`);
    if (fileInput.current) fileInput.current.value = "";
  };

  const onNodeClick: NodeMouseHandler<SpaceFlowNode> = (_event, node) => {
    setSelectedAssetId(node.data.kind === "asset" ? node.data.asset.id : null);
    setQuickAdd(null);
    if (!isDesktop && node.data.kind === "asset") setMobileInspectorOpen(true);
  };
  const onNodeDoubleClick: NodeMouseHandler<SpaceFlowNode> = (_event, node) => {
    if (node.data.kind === "asset") setViewerAsset(node.data.asset);
  };

  const downloadViewerAsset = async () => {
    if (!viewerAsset?.deliveryAssetId || downloadingAssetId) return;
    setDownloadingAssetId(viewerAsset.id);
    try {
      const downloaded = await downloadDeliveredAsset(viewerAsset.deliveryAssetId, `FusionLab · ${viewerAsset.name}`);
      toast.success(`تم تنزيل ${downloaded.filename}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تنزيل الملف الخاص");
    } finally {
      setDownloadingAssetId(null);
    }
  };
  const onMoveEnd: OnMoveEnd = (_event, viewport) => {
    try { setProject((current) => setProjectViewport(current, viewport)); } catch { /* React Flow is already clamped. */ }
  };

  const inspectorContent = advancedDraft
    ? <AdvancedRecipeInspector offers={publishedOffers.filter((offer) => publishedOfferSupportsRecipe(offer, advancedDraft.recipeId))} project={project} selectedAsset={selectedAsset} draft={advancedDraft} onChange={changeAdvancedDraft} onClose={closeAdvancedDraft} quote={advancedQuote} confirmation={advancedConfirmation} execution={advancedExecution} quoteLoading={quoteLoading} confirmLoading={confirmLoading} executionLoading={executionLoading} onRequestQuote={quoteAdvancedDraft} onConfirmQuote={confirmCurrentAdvancedQuote} onRunOperation={runCurrentAdvancedOperation} />
    : videoDraft
      ? <VideoRecipeInspector offers={publishedOffers.filter((offer) => publishedOfferSupportsRecipe(offer, videoDraft.recipeId))} project={project} selectedAsset={selectedAsset} draft={videoDraft} onChange={changeVideoDraft} onClose={closeVideoDraft} quote={videoQuote} confirmation={videoConfirmation} quoteLoading={quoteLoading} confirmLoading={confirmLoading} execution={videoExecution} executionLoading={executionLoading} onRequestQuote={quoteVideoDraft} onConfirmQuote={confirmCurrentVideoQuote} onRunOperation={runCurrentVideoOperation} />
      : <ImageRecipeInspector offers={publishedOffers.filter((offer) => !imageDraft || publishedOfferSupportsRecipe(offer, imageDraft.recipeId))} selectedAsset={selectedAsset} project={project} draft={imageDraft} onStart={startImageRecipe} onChange={changeImageDraft} onCloseDraft={closeImageDraft} onViewAsset={() => inspectorAsset && setViewerAsset(inspectorAsset)} onAddAsset={openQuickAddFromButton} quote={imageQuote} confirmation={imageConfirmation} quoteLoading={quoteLoading} confirmLoading={confirmLoading} onRequestQuote={quoteImageDraft} onConfirmQuote={confirmCurrentQuote} execution={imageExecution} executionLoading={executionLoading} onRunOperation={runCurrentImageOperation} onViewOutput={() => { const output = imageExecution ? project.assets[`output:${imageExecution.operation.id}`] : null; if (output) setViewerAsset(output); else toast.error("لم يكتمل تجهيز ملف النتيجة بعد"); }} onStartVideo={startVideoRecipe} onStartAdvanced={startAdvancedRecipe} />;

  return (
    <main className="creative-space-root relative h-[100dvh] w-screen overflow-hidden bg-[#08090b] text-foreground" dir="ltr">
      <input ref={fileInput} type="file" className="hidden" multiple accept="image/*,video/*,audio/*" onChange={(event) => uploadFiles(event.target.files)} />
      <header className="creative-space-header absolute inset-x-0 top-0 z-30 flex items-center justify-between border-b border-white/10 bg-black/65 px-3 backdrop-blur-xl sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="icon" variant="ghost" className="shrink-0" onClick={() => navigate("/projects")} aria-label="العودة إلى المشاريع"><FolderOpen className="h-4 w-4" /></Button>
          <div className="min-w-0"><p className="truncate text-sm font-bold" dir="rtl">{project.title}</p><p className="text-[10px] text-muted-foreground" data-testid="project-save-state">{PROJECT_SAVE_LABELS.en[saveState]} · {Object.keys(project.assets).length} assets</p></div>
          <div className="hidden items-center gap-1 sm:flex"><Button size="icon" variant="ghost" disabled aria-label="تراجع"><Undo2 className="h-4 w-4" /></Button><Button size="icon" variant="ghost" disabled aria-label="إعادة"><Redo2 className="h-4 w-4" /></Button></div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-xl border border-white/10 bg-white/5 p-0.5" role="group" aria-label="Workspace">
            <button className="min-h-9 rounded-lg px-2.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground" onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}/standard`)} aria-label="Open Standard">Standard</button>
            <span className="min-h-9 rounded-lg bg-violet-300 px-2.5 py-2 text-[11px] font-semibold text-violet-950" aria-current="page">Space</span>
          </div>
          <div className="hidden rounded-xl border border-white/10 bg-white/5 p-0.5 lg:flex" role="group" aria-label="Space view">
            <button className={`min-h-8 rounded-lg px-2 text-[10px] font-semibold ${viewMode === "STANDARD" ? "bg-white text-black" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setProject((current) => setSpaceViewMode(current, "STANDARD"))} aria-pressed={viewMode === "STANDARD"}>Canvas</button>
            <button className={`min-h-8 rounded-lg px-2 text-[10px] font-semibold ${viewMode === "PROFESSIONAL" ? "bg-white/15 text-white" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setProject((current) => setSpaceViewMode(current, "PROFESSIONAL"))} aria-pressed={viewMode === "PROFESSIONAL"}>Graph</button>
          </div>
          {viewMode === "PROFESSIONAL" && <Button size="sm" variant="ghost" className="hidden gap-2 lg:inline-flex" onClick={() => setGraphToolsOpen(true)}><BracesIcon /><span>Graph tools</span></Button>}
          {viewMode === "PROFESSIONAL" && <Button size="sm" variant="ghost" className="hidden gap-2 lg:inline-flex" onClick={() => setDebugViewOpen(true)}><Bug className="h-4 w-4" /><span>Debug view</span></Button>}
          <Button size="sm" variant="ghost" className="hidden gap-2 lg:inline-flex" onClick={() => setActivityOpen(true)}><Activity className="h-4 w-4" /><span>Activity</span></Button>
          <div className="hidden h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-xs sm:flex"><CircleDollarSign className="h-3.5 w-3.5" /><span>{publishedOffersState === "READY" ? `${publishedOffers.length} Published offers` : publishedOffersState === "LOADING" ? "Loading catalog…" : "Catalog unavailable"}</span></div>
          <Button size="sm" className="hidden gap-2 rounded-xl lg:inline-flex" onClick={openQuickAddFromButton}><Plus className="h-4 w-4" />إضافة عنصر</Button>
        </div>
      </header>

      <div className="creative-space-canvas absolute inset-x-0 bottom-0">
        <ReactFlow<SpaceFlowNode>
          nodes={nodes}
          edges={adapted.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeDragStop={(_event, node) => setProject((current) => moveCanvasItem(current, node.data.canvasItemId, node.position))}
          onPaneClick={(event) => {
            if (event.detail === 2) openQuickAdd(event.clientX, event.clientY);
            else { setSelectedAssetId(null); setQuickAdd(null); }
          }}
          onPaneContextMenu={(event) => { event.preventDefault(); openQuickAdd(event.clientX, event.clientY); }}
          onMoveEnd={onMoveEnd}
          defaultViewport={project.viewport}
          minZoom={0.25}
          maxZoom={1.75}
          translateExtent={[[-2400, -1800], [5200, 3600]]}
          nodeExtent={[[-2000, -1400], [4800, 3200]]}
          fitView={nodes.length === 0}
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: false }}
          colorMode="dark"
          className="creative-space-flow"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgba(255,255,255,.13)" />
          <Controls position="bottom-right" showInteractive={false} />
          {nodes.length > 20 && <MiniMap position="bottom-right" pannable zoomable className="!bottom-14 !bg-black/70" />}
        </ReactFlow>
      </div>

      {viewMode === "PROFESSIONAL" && <div className="pointer-events-none absolute right-4 top-[76px] z-20 hidden rounded-xl border border-violet-300/20 bg-[#12101a]/90 px-3 py-2 shadow-xl backdrop-blur lg:block" dir="rtl" data-testid="professional-graph-status"><p className="text-[11px] font-bold text-violet-100">Space Graph</p><p className="mt-0.5 text-[10px] text-violet-100/60">Semantic ports · persistent edges · Engine-governed · {professionalBudget.withinBudget ? "within budget" : "budget hold"}</p></div>}
      {viewMode === "PROFESSIONAL" && Object.keys(professionalGraph.timelineClips).length > 0 && <ProfessionalTimeline graph={professionalGraph} />}

      {isDesktop && <aside className={`absolute bottom-4 left-4 top-[72px] z-20 overflow-hidden rounded-2xl border border-white/10 bg-black/80 shadow-2xl backdrop-blur-2xl transition-[width] ${inspectorCollapsed ? "w-14" : "w-[388px]"}`} dir="rtl">
        <button className="absolute left-3 top-3 z-10 rounded-lg p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground" onClick={() => setInspectorCollapsed((value) => !value)} aria-label={inspectorCollapsed ? "فتح Inspector" : "طي Inspector"}>{inspectorCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}</button>
        {inspectorCollapsed
          ? <div className="flex h-full flex-col items-center gap-4 pt-16 text-muted-foreground"><MousePointer2 className="h-4 w-4" /><Sparkles className="h-4 w-4" /><Focus className="h-4 w-4" /></div>
          : inspectorContent}
      </aside>}

      {!isDesktop && <>
        <nav className="mobile-space-dock fixed inset-x-3 bottom-0 z-40 grid grid-cols-4 gap-1 rounded-2xl border border-white/10 bg-black/85 px-2 pt-2 shadow-2xl backdrop-blur-2xl" aria-label="أدوات مساحة الإبداع للهاتف" data-testid="mobile-space-dock" dir="rtl">
          <button className="mobile-space-action" onClick={openQuickAddFromButton}><Plus className="h-5 w-5" /><span>إضافة عنصر</span></button>
          <button className="mobile-space-action" onClick={() => setMobileInspectorOpen(true)}><MousePointer2 className="h-5 w-5" /><span>Inspector</span></button>
          <button className="mobile-space-action" onClick={fitProject}><Maximize2 className="h-5 w-5" /><span>ملاءمة</span></button>
          <button className="mobile-space-action" onClick={() => setActivityOpen(true)}><Activity className="h-5 w-5" /><span>النشاط</span></button>
        </nav>
        <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}>
          <SheetContent side="bottom" className="mobile-inspector-sheet h-[86dvh] gap-0 overflow-hidden rounded-t-3xl border-white/10 bg-[#0b0c0f] p-0" dir="rtl">
            <SheetHeader className="sr-only"><SheetTitle>Inspector مساحة الإبداع</SheetTitle><SheetDescription>اختيار الوصفة وربط الملفات والتسعير والتنفيذ المحلي.</SheetDescription></SheetHeader>
            {inspectorContent}
          </SheetContent>
        </Sheet>
      </>}

      {!nodes.length && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center pt-14"><div className="pointer-events-auto max-w-sm px-5 text-center" dir="rtl"><div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5"><ImagePlus className="h-7 w-7 text-white/70" /></div><h2 className="text-xl font-bold">ابدأ من أي ملف</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">أضف صورة أو فيديو أو صوت. ستبقى بيانات المشروع مستقلة عن xyflow ومحفوظة محلياً بعد التحديث.</p><Button className="mt-5 gap-2" onClick={openQuickAddFromButton}><Plus className="h-4 w-4" />إضافة أول بطاقة</Button><p className="mt-3 text-[11px] text-muted-foreground">Double-click · Right-click · A</p></div></div>}

      {quickAdd && <QuickAddMenu state={quickAdd} onClose={() => setQuickAdd(null)} onUpload={() => fileInput.current?.click()} onCreateImage={() => startImageRecipe("image.create", quickAdd.flow)} onCreateVideo={() => startVideoRecipe("video.text-to-video", quickAdd.flow)} onCreateVoice={() => startAdvancedRecipe("audio.tts", quickAdd.flow)} onSoon={(label) => toast.info(`${label} سيُبنى في المراحل التالية من 11`)} />}

      <Sheet open={activityOpen} onOpenChange={setActivityOpen}><SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" dir="rtl"><SheetHeader><SheetTitle>سجل العمليات والنشاط</SheetTitle><SheetDescription>مصدر محلي موحد لحالة التوليد والحجز والكلفة — لا يعرض أسراراً أو يدّعي اتصال مزود حقيقي.</SheetDescription></SheetHeader><OperationTimeline operations={Object.values(project.operations)} /><div className="mt-6 border-t border-border/60 pt-5"><h3 className="text-sm font-bold">نشاط المشروع</h3><div className="mt-3 space-y-3">{project.activity.map((item) => <div key={item.id} className="rounded-xl border border-border/60 bg-secondary/30 p-3"><p className="text-sm font-medium">{userFacingProjectActivitySummary(item.summary)}</p><p className="mt-1 text-[10px] text-muted-foreground" dir="ltr">{new Date(item.occurredAt).toLocaleString()}</p></div>)}</div></div></SheetContent></Sheet>

      <Dialog open={graphToolsOpen} onOpenChange={setGraphToolsOpen}><DialogContent className="max-w-xl" dir="rtl"><DialogHeader><DialogTitle>Space Graph tools</DialogTitle><DialogDescription>تنظيم محلي للـGraph فقط. لا تنشئ هذه الأدوات Quote أو عملية أو خصماً.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2" data-testid="professional-graph-tools"><GraphTool title="Group" detail="تجميع بطاقات المشروع الحالية داخل مجموعة محفوظة" count={Object.keys(professionalGraph.groups).length} action="Create group" disabled={!Object.keys(project.canvasItems).length} onClick={() => setProject((current) => createProfessionalGroup(current, { title: `Group ${Object.keys(getProfessionalGraph(current).groups).length + 1}`, canvasItemIds: Object.keys(current.canvasItems) }))} /><GraphTool title="Subflow" detail="حفظ عمليات المشروع ومخرجاتها كمسار قابل للتتبع" count={Object.keys(professionalGraph.subflows).length} action="Create subflow" disabled={!Object.keys(project.operations).length} onClick={() => setProject((current) => createProfessionalSubflow(current, { title: `Subflow ${Object.keys(getProfessionalGraph(current).subflows).length + 1}`, operationIds: Object.keys(current.operations), outputAssetIds: Object.values(current.assets).filter((asset) => asset.origin === "GENERATED").map((asset) => asset.id) }))} /><GraphTool title="Template" detail="حفظ المجموعة وبنيتها كـTemplate مرجعي غير تنفيذي" count={Object.keys(professionalGraph.templates).length} action="Save template" disabled={!Object.keys(professionalGraph.groups).length} onClick={() => setProject((current) => { const group = Object.values(getProfessionalGraph(current).groups).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]; return saveProfessionalTemplate(current, { title: `Template ${Object.keys(getProfessionalGraph(current).templates).length + 1}`, groupId: group.id }); })} /><GraphTool title="Batch branch" detail="تحضير مجموعة مصادر كمسودة فقط؛ التنفيذ غير مسموح" count={Object.keys(professionalGraph.batchBranches).length} action="Prepare batch" disabled={!Object.values(project.assets).some((asset) => asset.origin !== "GENERATED" && asset.status === "READY")} onClick={() => setProject((current) => prepareProfessionalBatchBranch(current, { title: `Batch ${Object.keys(getProfessionalGraph(current).batchBranches).length + 1}`, recipeId: Object.values(current.operations)[0]?.recipeId ?? "image.create", sourceAssetIds: Object.values(current.assets).filter((asset) => asset.origin !== "GENERATED" && asset.status === "READY").map((asset) => asset.id) }))} /><GraphTool title="Advanced shot" detail="إضافة لقطة منظمة إلى Timeline كـDraft فقط" count={Object.keys(professionalGraph.advancedShots).length} action="Add advanced shot" disabled={!Object.values(project.assets).some((asset) => asset.status === "READY" && ["IMAGE", "VIDEO"].includes(asset.kind))} onClick={() => setProject((current) => { const source = Object.values(current.assets).find((asset) => asset.status === "READY" && ["IMAGE", "VIDEO"].includes(asset.kind)); return createProfessionalAdvancedShot(current, { title: `Shot ${Object.keys(getProfessionalGraph(current).advancedShots).length + 1}`, sourceAssetId: source!.id, durationMs: 5_000 }); })} /></div><p className="rounded-lg border border-violet-300/15 bg-violet-300/5 px-3 py-2 text-xs text-violet-100/75">Batch and shot execution remain DRAFT and Engine-governed.</p></DialogContent></Dialog>

      <Dialog open={debugViewOpen} onOpenChange={setDebugViewOpen}><DialogContent className="max-w-lg" dir="rtl"><DialogHeader><DialogTitle>Space Graph debug view</DialogTitle><DialogDescription>عرض محلي للهيكل والحدود فقط؛ لا يعرض provider routes أو quote IDs أو أسرار.</DialogDescription></DialogHeader><dl className="grid grid-cols-2 gap-2 text-sm" data-testid="professional-debug-view"><DebugMetric label="Nodes" value={professionalBudget.nodeCount} /><DebugMetric label="Edges" value={professionalBudget.edgeCount} /><DebugMetric label="Timeline clips" value={professionalBudget.timelineClipCount} /><DebugMetric label="Projection" value={`${professionalBudget.projectionMilliseconds.toFixed(1)} ms`} /><DebugMetric label="Budget" value={professionalBudget.withinBudget ? "PASS" : "HOLD"} /><DebugMetric label="Execution" value="Engine-governed" /></dl>{professionalBudget.reasons.length > 0 && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{professionalBudget.reasons.join(" · ")}</p>}</DialogContent></Dialog>

      <Dialog open={!!viewerAsset} onOpenChange={(open) => !open && setViewerAsset(null)}><DialogContent className="max-w-3xl" dir="rtl"><DialogHeader><div className="flex items-start justify-between gap-4 pl-8"><div><DialogTitle>{viewerAsset?.name}</DialogTitle><DialogDescription className="mt-1">معاينة آمنة للملف الخاص. التنزيل ينشئ صلاحية قصيرة العمر ولا يكشف رابط المزود.</DialogDescription></div>{viewerAsset?.deliveryAssetId && <Button type="button" className="shrink-0 gap-2" disabled={downloadingAssetId === viewerAsset.id} onClick={downloadViewerAsset} data-testid="download-delivered-asset">{downloadingAssetId === viewerAsset.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{downloadingAssetId === viewerAsset.id ? "جارٍ التنزيل..." : "تنزيل الملف"}</Button>}</div></DialogHeader><div className="grid min-h-[360px] place-items-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-transparent">{viewerAsset?.kind === "IMAGE" && viewerAsset.resultUrl ? <img src={viewerAsset.resultUrl.startsWith("blob:") ? viewerAsset.resultUrl : `/api/engine${viewerAsset.resultUrl}`} alt={viewerAsset.name} className="max-h-[70vh] w-full object-contain" /> : viewerAsset?.kind === "VIDEO" && viewerAsset.resultUrl ? <video controls preload="metadata" src={viewerAsset.resultUrl.startsWith("blob:") ? viewerAsset.resultUrl : `/api/engine${viewerAsset.resultUrl}`} className="max-h-[70vh] w-full" aria-label={viewerAsset.name} /> : viewerAsset?.kind === "AUDIO" && viewerAsset.resultUrl ? <audio controls preload="none" src={viewerAsset.resultUrl.startsWith("blob:") ? viewerAsset.resultUrl : `/api/engine${viewerAsset.resultUrl}`} className="w-[min(90%,560px)]" aria-label={viewerAsset.name} /> : <ViewerIcon kind={viewerAsset?.kind} />}</div></DialogContent></Dialog>
    </main>
  );
}

function QuickAddMenu({ state, onClose, onUpload, onCreateImage, onCreateVideo, onCreateVoice, onSoon }: { state: NonNullable<QuickAddState>; onClose: () => void; onUpload: () => void; onCreateImage: () => void; onCreateVideo: () => void; onCreateVoice: () => void; onSoon: (label: string) => void }) {
  const items = [
    { label: "Upload Image / Video / Audio", icon: Upload, run: onUpload },
    { label: "Create Image", icon: FileImage, run: onCreateImage },
    { label: "Create Video", icon: FileVideo2, run: onCreateVideo },
    { label: "Create Voice / TTS", icon: FileAudio2, run: onCreateVoice },
    { label: "Choose from Library", icon: Library, run: () => onSoon("Library") },
  ];
  return <div className="fixed z-50 w-72 overflow-hidden rounded-2xl border border-white/15 bg-[#111215]/95 p-2 shadow-2xl backdrop-blur-xl" style={{ left: Math.max(8, Math.min(state.screen.x, window.innerWidth - 296)), top: Math.max(8, Math.min(state.screen.y, window.innerHeight - 330)) }} dir="rtl"><div className="flex items-center justify-between px-2 py-2"><div><p className="text-xs font-bold">Quick Add</p><p className="text-[10px] text-muted-foreground">الموضع يحفظ داخل المشروع</p></div><button className="grid h-11 w-11 place-items-center rounded-xl hover:bg-white/10" onClick={onClose} aria-label="إغلاق Quick Add"><X className="h-4 w-4" /></button></div>{items.map(({ label, icon: Icon, run }) => <button key={label} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right text-sm hover:bg-white/10" onClick={run}><span className="grid h-8 w-8 place-items-center rounded-lg bg-white/5"><Icon className="h-4 w-4" /></span><span className="flex-1">{label}</span><ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" /></button>)}</div>;
}

function BracesIcon() { return <span aria-hidden="true" className="font-mono text-base leading-none">{`{}`}</span>; }

function GraphTool({ title, detail, count, action, disabled, onClick }: { title: string; detail: string; count: number; action: string; disabled: boolean; onClick: () => void }) {
  return <section className="rounded-xl border border-white/10 bg-white/[.03] p-3"><div className="flex items-start justify-between gap-2"><div><h3 className="text-sm font-bold">{title}</h3><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{detail}</p></div><span className="rounded-full bg-violet-300/15 px-2 py-1 text-xs font-bold text-violet-100" aria-label={`${title} count`}>{count}</span></div><Button className="mt-3 w-full" size="sm" variant="secondary" disabled={disabled} onClick={onClick}>{action}</Button></section>;
}

function ProfessionalTimeline({ graph }: { graph: ReturnType<typeof getProfessionalGraph> }) {
  const clips = Object.values(graph.timelineClips).sort((left, right) => left.startMs - right.startMs);
  return <aside className="absolute bottom-5 left-1/2 z-20 hidden w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-violet-300/20 bg-[#12101a]/95 p-3 shadow-2xl backdrop-blur lg:block" data-testid="professional-timeline" dir="rtl"><div className="flex items-center justify-between"><div><h2 className="text-xs font-bold text-violet-100">Shot Timeline</h2><p className="mt-0.5 text-[10px] text-violet-100/60">خطة قراءة فقط · لا Playback أو Dispatch</p></div><span className="rounded-full bg-violet-300/15 px-2 py-1 text-[10px] font-bold text-violet-100">{clips.length} clips</span></div><ol className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="لقطات Timeline">{clips.map((clip) => { const shot = graph.advancedShots[clip.shotId]; return <li key={clip.id} className="min-w-36 rounded-lg border border-white/10 bg-white/[.03] px-2 py-2"><p className="truncate text-[10px] font-bold">{shot?.title ?? "Draft shot"}</p><p className="mt-1 text-[9px] text-muted-foreground" dir="ltr">{(clip.startMs / 1000).toFixed(1)}s → {((clip.startMs + clip.durationMs) / 1000).toFixed(1)}s · DRAFT</p></li>; })}</ol></aside>;
}

function DebugMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg border border-white/10 bg-white/[.03] p-3"><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-bold">{value}</dd></div>;
}

function OperationTimeline({ operations }: { operations: SpaceOperation[] }) {
  const sorted = [...operations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const stateLabel: Record<SpaceOperationState, string> = {
    RESERVED: "محجوز", QUEUED: "في الطابور", DISPATCHING: "قيد الإرسال", SUBMISSION_UNKNOWN: "جارٍ التحقق", SUBMITTED: "أُرسل للمزود", RUNNING: "قيد التوليد", PROVIDER_SUCCEEDED: "نجح المزود", PROVIDER_FAILED: "فشل المزود", ASSET_STORED: "حُفظ الأصل", DELIVERED: "تم التسليم", DELIVERY_FAILED: "تعذر التسليم", SETTLED: "تمت التسوية", RECONCILIATION_REQUIRED: "تحتاج مصالحة",
  };
  if (!sorted.length) return <section className="mt-6" data-testid="operation-timeline"><h3 className="text-sm font-bold">سجل العمليات</h3><p className="mt-2 rounded-xl border border-dashed border-border/70 p-3 text-xs text-muted-foreground">لا توجد عمليات بعد. يظهر هنا الحجز وحالة التنفيذ والخصم النهائي للعميل.</p></section>;
  return <section className="mt-6" data-testid="operation-timeline">
    <div className="flex items-center justify-between"><h3 className="text-sm font-bold">سجل العمليات</h3><span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-bold">{sorted.length}</span></div>
    <ol className="mt-3 space-y-3">{sorted.map((operation) => {
      const requiresReconciliation = operation.state === "RECONCILIATION_REQUIRED" || operation.state === "SUBMISSION_UNKNOWN";
      const providerFailure = operation.state === "PROVIDER_FAILED" || operation.state === "DELIVERY_FAILED";
      const outcome = requiresReconciliation
        ? "الحجز محفوظ؛ لا تعِد الإرسال. يلزم التحقق قبل أي تسوية أو إطلاق."
        : operation.state === "SETTLED"
          ? "تم التسليم والتسوية؛ هذه هي القيم الفعلية المثبتة للعملية."
          : providerFailure && operation.customerChargedCredits === 0
            ? "ثبت عدم خصم العميل؛ ستراجع المنصة دليل المزود داخلياً."
          : providerFailure
              ? "نتيجة الفشل المالية ما زالت غير مؤكدة وتحتاج مراجعة."
              : "هذه العملية في التنفيذ؛ لا تتحول التقديرات إلى خصم نهائي قبل التسوية.";
      return <li key={operation.id} className="rounded-xl border border-border/60 bg-secondary/30 p-3">
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{operation.recipeId}</p><p className="mt-1 text-[10px] text-muted-foreground" dir="ltr">{operation.id.slice(0, 12)} · {operation.modelId}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${operation.state === "SETTLED" ? "bg-emerald-500/15 text-emerald-300" : operation.state.includes("FAILED") || operation.state === "RECONCILIATION_REQUIRED" ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300"}`}>{stateLabel[operation.state]}</span></div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-black/15 p-2"><dt className="text-[10px] text-muted-foreground">سعر العميل في Quote</dt><dd className="mt-1 font-bold" dir="ltr">{operation.customerCredits} credits</dd></div>
          <div className="rounded-lg bg-black/15 p-2"><dt className="text-[10px] text-muted-foreground">خصم العميل النهائي</dt><dd className="mt-1 font-bold" dir="ltr">{operation.customerChargedCredits === null ? "Unproven" : `${operation.customerChargedCredits} credits`}</dd></div>
          <div className="rounded-lg bg-black/15 p-2"><dt className="text-[10px] text-muted-foreground">حالة الحماية</dt><dd className="mt-1 font-bold">{requiresReconciliation ? "Under review" : operation.state === "SETTLED" ? "Settled" : "Protected"}</dd></div>
        </dl>
        <p className="mt-2 text-[10px] text-muted-foreground">{outcome}</p>
      </li>;
    })}</ol>
  </section>;
}

function ViewerIcon({ kind }: { kind?: SpaceAsset["kind"] }) {
  const Icon = kind === "VIDEO" ? FileVideo2 : kind === "AUDIO" ? FileAudio2 : FileImage;
  return <Icon className="h-20 w-20 text-white/35" />;
}
