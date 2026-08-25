import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Download,
  ImageIcon,
  ImagePlus,
  Loader2,
  Maximize2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { PublishedModelPicker } from "@/features/creative-space/PublishedModelPicker";
import { CustomerSelect } from "@/features/creative-space/CustomerSelect";
import { StandardQuoteGate } from "@/features/creative-space/StandardQuoteGate";
import { StandardImageGallery } from "@/features/creative-space/StandardImageGallery";
import { StandardVideoComposer } from "@/features/creative-space/StandardVideoComposer";
import { ReferenceAssetThumbnail } from "@/features/creative-space/ReferenceAssetThumbnail";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  StandardMediaTabs,
  StandardShell,
  StandardStatePanel,
  type StandardMediaTab,
} from "@/features/creative-space/standard-shell";
import {
  loadPublishedOffers,
  publishedOfferFamilyControlValues,
  publishedOfferFamilyControls,
  publishedOfferFamilyMembers,
  publishedOfferSupportsRecipe,
  reconcilePublishedOfferSettings,
  resolvePublishedOfferFamilyVariant,
  type PublishedOffer,
  type PublishedSettingValue,
} from "@/features/creative-space/published-offers-client";
import { planPublishedImageOfferSelection, planPublishedImageRecipeSelection, publishedImageVersionRouteOffer } from "@/features/creative-space/published-image-selection";
import {
  downloadDeliveredAsset,
  imageRequestErrorMessage,
  readDeliveredAsset,
  requestImageQuote,
  confirmImageQuote,
  runImageOperation,
  type ConfirmedImageQuote,
  type ExecutedImageOperation,
} from "@/features/creative-space/image-quote-client";
import { standardCopy } from "@/features/creative-space/standard-i18n";
import type { ImageComposerDraft } from "@/features/creative-space/composer-draft";
import type { UiFuxLocale } from "@/features/creative-space/product-decisions";
import {
  loadPersistedCreativeSpaceProject,
  savePersistedCreativeSpaceProject,
  type PersistedCreativeSpaceProject,
} from "@/features/creative-space/project-client";
import { ensureEngineSession } from "@/features/creative-space/engine-session";
import { readInputImage, uploadInputImage } from "@/features/creative-space/input-asset-client";
import { getCustomerAccount } from "@/lib/subscription-client";
import {
  hydrateStandardImageDraft,
  persistStandardGalleryTrash,
  persistStandardGenerationSession,
  persistStandardImageDraft,
  persistStandardAssetMediaMetadata,
  persistStandardImageResult,
  persistStandardReservedImage,
  persistStandardMediaResult,
  persistStandardReservedMedia,
} from "@/features/creative-space/standard-workspace-persistence";
import {
  getStandardProjection,
  projectToStandardWorkspace,
} from "@/features/creative-space/standard-projection";
import {
  latestStandardImageReviewOperation,
  recoverableStandardImageOperation,
} from "@/features/creative-space/standard-operation-recovery";
import type {
  CreativeSpaceProject,
  SpaceAsset,
  SpaceAssetMediaMetadata,
} from "@/features/creative-space/domain";
import { addVerifiedUploadedAsset } from "@/features/creative-space/domain";
import type { ConfirmedVideoQuote, ExecutedVideoOperation } from "@/features/creative-space/video-quote-client";
import type { VideoComposerDraft } from "@/features/creative-space/video-composer-draft";

function initialDraft(
  projectId: string,
  offer: PublishedOffer,
): ImageComposerDraft | null {
  const settings = reconcilePublishedOfferSettings(offer, "image.create");
  if (!settings) return null;
  return {
    schemaVersion: 1,
    projectId,
    recipeId: "image.create",
    inputAssetId: null,
    prompt: "",
    offerId: offer.offerId,
    modelId: offer.providerModelId,
    settings,
    anchor: { x: 0, y: 0 },
    updatedAt: new Date().toISOString(),
  };
}

// These are customer-facing intents, not provider route names.  An intent is
// selectable only when at least one released commercial offer can execute it.
const customerImageRecipeIds = [
  "image.create",
  "image.edit",
  "image.remix",
] as const;

export default function StandardImageWorkspacePage() {
  const { projectId = "local-demo" } = useParams();
  const navigate = useNavigate();
  const [locale, setLocale] = useState<UiFuxLocale>("en");
  const [activeMedia, setActiveMedia] = useState<StandardMediaTab>("image");
  // A gallery action is explicit customer intent. Keep the target separate
  // from the Image draft so it can bind directly to the currently-open Video
  // composer without showing a second, ambiguous asset picker.
  const [videoReferenceAssetId, setVideoReferenceAssetId] = useState<string | null>(null);
  const [offers, setOffers] = useState<readonly PublishedOffer[]>([]);
  const [draft, setDraft] = useState<ImageComposerDraft | null>(null);
  const [pendingOffer, setPendingOffer] = useState<PublishedOffer | null>(null);
  const [catalogState, setCatalogState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [reserved, setReserved] = useState<ConfirmedImageQuote | null>(null);
  const [operationIdToMonitor, setOperationIdToMonitor] = useState<
    string | null
  >(null);
  const [execution, setExecution] = useState<ExecutedImageOperation | null>(
    null,
  );
  const [executionState, setExecutionState] = useState<string | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [viewerAsset, setViewerAsset] = useState<SpaceAsset | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [assetFeedback, setAssetFeedback] = useState<string | null>(null);
  const [uploadPreviewRevision, setUploadPreviewRevision] = useState(0);
  const [project, setProject] = useState<CreativeSpaceProject | null>(null);
  const [projectVersion, setProjectVersion] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<
    "LOADING" | "SAVED" | "SAVING" | "CONFLICT" | "ERROR"
  >("LOADING");
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);
  const hydrated = useRef(false);
  const catalogRequest = useRef(0);
  const persistedSessions = useRef(new Set<string>());
  const persistedResults = useRef(new Set<string>());
  const uploadPreviewUrls = useRef<Record<string, string>>({});
  const projectSnapshotRef = useRef<{
    project: CreativeSpaceProject | null;
    version: number | null;
  }>({ project: null, version: null });
  // Every document write for this project must cross this one queue.  Uploads,
  // autosave, decoded media facts and operation settlement can otherwise read
  // the same optimistic version and reject each other with a 409 conflict.
  const projectWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const text = standardCopy(locale);
  const enqueueProjectSave = useCallback(
    (
      write: (current: {
        project: CreativeSpaceProject;
        version: number;
      }) => Promise<PersistedCreativeSpaceProject>,
    ) => {
      const task = projectWriteQueue.current
        .catch(() => undefined)
        .then(async () => {
          const current = projectSnapshotRef.current;
          if (!current.project || current.version === null) {
            throw new Error("Project is not ready to save.");
          }
          setSaveState("SAVING");
          const saved = await write({
            project: current.project,
            version: current.version,
          });
          projectSnapshotRef.current = {
            project: saved.document,
            version: saved.version,
          };
          setProject(saved.document);
          setProjectVersion(saved.version);
          setSaveState("SAVED");
          return saved;
        });
      projectWriteQueue.current = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    [],
  );
  const refreshAvailableCredits = useCallback(async () => {
    try {
      await ensureEngineSession();
      const account = await getCustomerAccount();
      setAvailableCredits(account.wallet?.availableCredits ?? 0);
    } catch {
      setAvailableCredits(null);
    }
  }, []);
  const selected =
    offers.find((offer) => offer.offerId === draft?.offerId) ?? null;
  const hasPublishedVideo = offers.some(
    (offer) =>
      offer.capability.mediaType === "video" &&
      offer.capability.controlSchema.recipes.some(
        (recipe) => ["video.text-to-video", "video.image-to-video"].includes(recipe.recipeId),
      ),
  );
  const imageRecipes = useMemo(
    () =>
      (selected?.capability.controlSchema.recipes ?? []).filter(
        (
          recipe,
        ): recipe is typeof recipe & {
          recipeId: ImageComposerDraft["recipeId"];
        } =>
          [
            "image.create",
            "image.edit",
            "image.remix",
            "image.inpaint",
            "image.upscale",
          ].includes(recipe.recipeId),
      ),
    [selected],
  );
  const publishedImageRecipeIds = useMemo(
    () =>
      new Set<ImageComposerDraft["recipeId"]>(
        offers
          .filter((offer) => offer.capability.mediaType === "image")
          .flatMap((offer) => offer.capability.controlSchema.recipes)
          .map((recipe) => recipe.recipeId)
          .filter((recipeId): recipeId is ImageComposerDraft["recipeId"] =>
            customerImageRecipeIds.includes(
              recipeId as (typeof customerImageRecipeIds)[number],
            ),
          ),
      ),
    [offers],
  );
  const activeRecipe =
    imageRecipes.find((recipe) => recipe.recipeId === draft?.recipeId) ?? null;
  const galleryAssets = useMemo(
    () => (project ? projectToStandardWorkspace(project).galleryAssets.map((asset) => (
      asset.origin === "UPLOAD" && uploadPreviewUrls.current[asset.id]
        ? { ...asset, resultUrl: uploadPreviewUrls.current[asset.id] }
        : asset
    )) : []),
    [project, uploadPreviewRevision],
  );
  const selectedImageReferenceAsset = useMemo(
    () => galleryAssets.find((asset) => asset.id === draft?.inputAssetId) ?? null,
    [draft?.inputAssetId, galleryAssets],
  );
  useEffect(() => {
    projectSnapshotRef.current = { project, version: projectVersion };
  }, [project, projectVersion]);
  const persistedReviewOperation = useMemo(
    () => (project ? latestStandardImageReviewOperation(project) : null),
    [project],
  );
  const reviewOperation = useMemo(() => {
    const latest = execution?.operation;
    return latest && ["PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(latest.state)
      ? latest
      : persistedReviewOperation;
  }, [execution?.operation, persistedReviewOperation]);
  const trashedAssets = useMemo(() => {
    if (!project) return [];
    const entries = getStandardProjection(project).trashEntries;
    return entries.flatMap((entry) =>
      project.assets[entry.assetId]
        ? [
            {
              asset: project.assets[entry.assetId],
              deletedAt: entry.deletedAt,
              purgeAfter: entry.purgeAfter,
            },
          ]
        : [],
    );
  }, [project]);
  // The current durable Image client accepts one certified source asset. A
  // multi-binding control is deliberately not shown until its client contract
  // and asset-ingest workflow are implemented end-to-end.
  const canUseReference = activeMedia === "video"
    ? hasPublishedVideo
    : Boolean(
        selected?.capability.inputModes.includes("image") &&
        activeRecipe?.bindings.max === 1,
      );
  const familyOffers = useMemo(
    () =>
      selected && draft
        ? publishedOfferFamilyMembers(
            offers.filter((offer) => offer.capability.mediaType === "image"),
            selected,
            draft.recipeId,
          )
        : [],
    [draft, offers, selected],
  );
  const controls = useMemo(
    () =>
      selected && draft
        ? publishedOfferFamilyControls(
            familyOffers,
            draft.recipeId,
            draft.settings,
          )
        : [],
    [draft, familyOffers, selected],
  );
  useEffect(() => {
    let active = true;
    void loadPersistedCreativeSpaceProject(projectId)
      .then((loaded) => {
        if (!active) return;
        if (!loaded) throw new Error("Project not found.");
        projectSnapshotRef.current = {
          project: loaded.document,
          version: loaded.version,
        };
        setProject(loaded.document);
        setProjectVersion(loaded.version);
        setSaveState("SAVED");
      })
      .catch(() => {
        if (active) setSaveState("ERROR");
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  useEffect(() => {
    void refreshAvailableCredits();
  }, [refreshAvailableCredits]);
  const refreshCatalog = async () => {
    const requestId = ++catalogRequest.current;
    setCatalogRefreshing(true);
    try {
      const loaded = await loadPublishedOffers();
      if (requestId !== catalogRequest.current) return;
      setOffers(loaded);
      setCatalogState("ready");
      // A retired offer can never remain executable in this workspace. Clear
      // it and let the normal hydration path choose a currently published
      // image offer instead of retaining stale browser state.
      if (
        draft?.offerId &&
        !loaded.some((offer) => offer.offerId === draft.offerId)
      ) {
        hydrated.current = false;
        setDraft(null);
      }
    } catch {
      if (requestId === catalogRequest.current) setCatalogState("error");
    } finally {
      if (requestId === catalogRequest.current) setCatalogRefreshing(false);
    }
  };
  useEffect(() => {
    void refreshCatalog();
    return () => {
      catalogRequest.current += 1;
    };
  }, []);
  useEffect(() => {
    if (hydrated.current || !project || !offers.length) return;
    const restored = hydrateStandardImageDraft(project);
    const selectedOffer = restored?.offerId
      ? offers.find((offer) => offer.offerId === restored.offerId)
      : null;
    const fallback = offers.find(
      (offer) =>
        offer.capability.mediaType === "image" &&
        offer.capability.controlSchema.recipes.some(
          (recipe) => recipe.recipeId === "image.create",
        ),
    );
    if (!selectedOffer && !fallback) return;
    const source = selectedOffer ?? fallback!;
    const next = restored
      ? {
          ...restored,
          modelId: source.providerModelId,
          settings:
            reconcilePublishedOfferSettings(
              source,
              "image.create",
              restored.settings,
            ) ?? {},
        }
      : initialDraft(projectId, source);
    if (next) {
      setDraft(next);
      hydrated.current = true;
    }
  }, [offers, project, projectId]);
  useEffect(() => {
    if (!project || operationIdToMonitor || execution || executionError) return;
    const unfinished = recoverableStandardImageOperation(project);
    if (unfinished) {
      setOperationIdToMonitor(unfinished.id);
      setExecutionState(unfinished.state);
    }
  }, [execution, operationIdToMonitor, project]);
  useEffect(() => {
    if (!operationIdToMonitor) return;
    let active = true;
    setExecution(null);
    setExecutionError(null);
    void runImageOperation(operationIdToMonitor, (progress) => {
      if (active) setExecutionState(progress.operation.state);
    })
      .then((completed) => {
        if (active) {
          setExecution(completed);
          setExecutionState(completed.operation.state);
          setOperationIdToMonitor(null);
          void refreshAvailableCredits();
        }
      })
      .catch((reason) => {
        if (active) {
          setExecutionError(
            reason instanceof Error
              ? reason.message
              : "Operation status could not be recovered.",
          );
          setOperationIdToMonitor(null);
        }
      });
    return () => {
      active = false;
    };
  }, [operationIdToMonitor]);
  useEffect(
    () => () => {
      if (execution?.operation.resultUrl?.startsWith("blob:"))
        URL.revokeObjectURL(execution.operation.resultUrl);
    },
    [execution?.operation.resultUrl],
  );
  useEffect(
    () => () => {
      if (viewerUrl?.startsWith("blob:")) URL.revokeObjectURL(viewerUrl);
    },
    [viewerUrl],
  );
  useEffect(
    () => () => {
      Object.values(uploadPreviewUrls.current).forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  useEffect(() => {
    if (!draft || !project || projectVersion === null || !hydrated.current)
      return;
    const timer = window.setTimeout(() => {
      void enqueueProjectSave(({ project: currentProject, version }) =>
        persistStandardImageDraft({
          project: currentProject,
          version,
          draft,
        }),
      )
        .catch((error) => {
          setSaveState(
            error &&
              typeof error === "object" &&
              "status" in error &&
              error.status === 409
              ? "CONFLICT"
              : "ERROR",
          );
        });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    if (
      !execution ||
      !project ||
      projectVersion === null ||
      persistedResults.current.has(execution.operation.id)
    )
      return;
    const operationId = execution.operation.id;
    persistedResults.current.add(operationId);
    void enqueueProjectSave(async ({ project: currentProject, version }) => {
      const resultSaved = await persistStandardImageResult({
        project: currentProject,
        version,
        execution,
      });
      const outputAssetId =
        resultSaved.document.operations[operationId]?.outputAssetId ?? null;
      return persistStandardGenerationSession({
        project: resultSaved.document,
        version: resultSaved.version,
        operationId,
        outputAssetId,
      });
    })
      .then((sessionSaved) => {
        persistedSessions.current.add(operationId);
      })
      .catch(() => {
        persistedResults.current.delete(operationId);
        setSaveState("ERROR");
      });
  }, [execution, project, projectVersion]);
  const selectPublishedSetting = (id: string, value: PublishedSettingValue) => {
    if (!draft || !selected) return;
    const resolved = resolvePublishedOfferFamilyVariant({
      offers,
      selectedOffer: selected,
      recipeId: draft.recipeId,
      desiredSettings: { ...draft.settings, [id]: value },
      changedControlId: id,
    });
    if (!resolved) return;
    const settings = reconcilePublishedOfferSettings(
      resolved.offer,
      draft.recipeId,
      resolved.settings,
    );
    if (!settings) return;
    // Any certified setting (quality, resolution, duration, audio or aspect
    // ratio) is price-bearing. Move to its exact published offer atomically;
    // the next quote can never inherit a price from another SKU.
    setPendingOffer(null);
    setReserved(null);
    setExecution(null);
    setExecutionError(null);
    setOperationIdToMonitor(null);
    setDraft({
      ...draft,
      offerId: resolved.offer.offerId,
      modelId: resolved.offer.providerModelId,
      settings,
      updatedAt: new Date().toISOString(),
    });
  };
  const selectRecipe = (recipeId: ImageComposerDraft["recipeId"]) => {
    if (!draft) return;
    // An intent can switch only to a released sibling contract for this exact
    // provider and customer-facing model version.  For example, GPT Image 2
    // text-to-image may move to GPT Image 2 image-to-image; it may never
    // quietly switch to another provider or a different model generation.
    const sameVersionRoute = publishedImageVersionRouteOffer({
      offers,
      selectedOffer: selected,
      recipeId,
    });
    // Mode is selected before the model. Prefer the exact currently selected
    // model version, but if it cannot perform that task move to the first
    // released compatible model so the following picker is never empty.
    const routeOffer = sameVersionRoute ?? offers.find(
      (offer) => offer.capability.mediaType === "image" && publishedOfferSupportsRecipe(offer, recipeId),
    ) ?? null;
    const plan = planPublishedImageRecipeSelection({
      draft,
      offer: routeOffer,
      recipeId,
    });
    if (!plan.valid || !plan.nextDraft) return;
    setPendingOffer(null);
    setReserved(null);
    setExecution(null);
    setExecutionError(null);
    setOperationIdToMonitor(null);
    setDraft(plan.nextDraft);
  };
  const selectOffer = (offer: PublishedOffer) => {
    if (!draft) return;
    const plan = planPublishedImageOfferSelection({
      draft,
      fromOffer: selected,
      toOffer: offer,
    });
    if (!plan.valid || !plan.nextDraft) return;
    if (plan.requiresConfirmation) {
      setPendingOffer(offer);
      return;
    }
    setDraft(plan.nextDraft);
  };
  const applyPending = () => {
    if (!draft || !pendingOffer) return;
    const plan = planPublishedImageOfferSelection({
      draft,
      fromOffer: selected,
      toOffer: pendingOffer,
    });
    if (plan.nextDraft) setDraft(plan.nextDraft);
    setPendingOffer(null);
  };
  const reserveOperation = async (confirmed: ConfirmedImageQuote) => {
    if (!project || projectVersion === null || !draft) {
      setExecutionError(
        locale === "en"
          ? "Project must be saved before confirmation."
          : "يجب حفظ المشروع قبل التأكيد.",
      );
      return;
    }
    try {
      await enqueueProjectSave(({ project: currentProject, version }) =>
        persistStandardReservedImage({
          project: currentProject,
          version,
          confirmed,
          draft,
        }),
      );
      setReserved(confirmed);
      setOperationIdToMonitor(confirmed.operation.id);
      void refreshAvailableCredits();
    } catch (error) {
      setSaveState(
        error &&
          typeof error === "object" &&
          "status" in error &&
          error.status === 409
          ? "CONFLICT"
          : "ERROR",
      );
    }
  };
  const openAsset = async (asset: SpaceAsset) => {
    setAssetFeedback(null);
    setViewerAsset(asset);
    setViewerUrl(null);
    // Reacquire private delivery access for every gallery view. Persisted
    // preview URLs are never used ahead of the Engine-owned asset identity.
    try {
      setViewerUrl(
        asset.origin === "UPLOAD"
          ? await readInputImage(asset.id)
          : asset.deliveryAssetId
          ? await readDeliveredAsset(asset.deliveryAssetId)
          : (asset.resultUrl ?? null),
      );
    } catch (error) {
      setViewerAsset(null);
      setViewerUrl(null);
      setAssetFeedback(imageRequestErrorMessage(error, locale));
    }
  };
  const resolveGalleryPreview = useCallback(async (asset: SpaceAsset) => {
    // Gallery cards never persist browser Blob URLs. Reacquire only the
    // visible card from the Engine-owned private asset identity.
    if (asset.resultUrl) return asset.resultUrl;
    if (asset.origin === "UPLOAD") return readInputImage(asset.id);
    return asset.deliveryAssetId ? readDeliveredAsset(asset.deliveryAssetId) : null;
  }, []);
  const persistGalleryMediaMetadata = useCallback(
    (asset: SpaceAsset, metadata: SpaceAssetMediaMetadata) => {
      const snapshot = projectSnapshotRef.current;
      const currentAsset = snapshot.project?.assets[asset.id];
      if (!snapshot.project || snapshot.version === null || !currentAsset) return;

      const changes = Object.entries(metadata).filter(
        ([key, value]) =>
          currentAsset.mediaMetadata?.[
            key as keyof SpaceAssetMediaMetadata
          ] !== value,
      );
      if (!changes.length) return;

      // Update the in-memory snapshot immediately. Multiple cards can decode
      // in the same frame; the queued write below therefore saves their merged
      // facts with one canonical project version rather than competing writes.
      const nextProject: CreativeSpaceProject = {
        ...snapshot.project,
        assets: {
          ...snapshot.project.assets,
          [asset.id]: {
            ...currentAsset,
            mediaMetadata: {
              ...currentAsset.mediaMetadata,
              ...metadata,
            },
          },
        },
      };
      projectSnapshotRef.current = {
        project: nextProject,
        version: snapshot.version,
      };
      setProject(nextProject);

      void enqueueProjectSave(({ project: currentProject, version }) =>
        persistStandardAssetMediaMetadata({
          project: currentProject,
          version,
          assetId: asset.id,
          metadata,
        }),
      )
        .catch(() => {
          // The card is still fully usable. If another tab changed the
          // project, decoded presentation facts are retried next time this
          // private asset is viewed; a visual enhancement must not block a
          // quote, reservation, or financial settlement.
        });
    },
    [],
  );
  const downloadAsset = async (asset: SpaceAsset) => {
    if (!asset.deliveryAssetId) return;
    setAssetFeedback(null);
    try {
      await downloadDeliveredAsset(asset.deliveryAssetId, asset.name);
    } catch (error) {
      setAssetFeedback(imageRequestErrorMessage(error, locale));
    }
  };
  const useAsReference = (asset: SpaceAsset) => {
    if (!draft) return;
    // A result reused from the gallery is an explicit customer intent to edit
    // an image. Route to a released image-to-image contract before binding it;
    // never leave a hidden source attached to a text-only recipe.
    const target =
      (selected && publishedOfferSupportsRecipe(selected, "image.edit")
        ? selected
        : offers.find(
            (offer) =>
              offer.capability.mediaType === "image" &&
              offer.modelFamilyId === selected?.modelFamilyId &&
              publishedOfferSupportsRecipe(offer, "image.edit"),
          ) ??
          offers.find(
            (offer) =>
              offer.capability.mediaType === "image" &&
              publishedOfferSupportsRecipe(offer, "image.edit"),
          )) ?? null;
    const settings = target
      ? reconcilePublishedOfferSettings(target, "image.edit")
      : null;
    setPendingOffer(null);
    setReserved(null);
    setExecution(null);
    setExecutionError(null);
    setOperationIdToMonitor(null);
    setActiveMedia("image");
    setDraft({
      ...draft,
      recipeId: target && settings ? "image.edit" : draft.recipeId,
      offerId: target?.offerId ?? draft.offerId,
      modelId: target?.providerModelId ?? draft.modelId,
      settings: settings ?? draft.settings,
      inputAssetId: asset.id,
      updatedAt: new Date().toISOString(),
    });
  };
  const reserveStandardVideo = async (input: {
    draft: VideoComposerDraft;
    confirmation: ConfirmedVideoQuote;
  }) => {
    if (!project || projectVersion === null) {
      throw new Error(
        locale === "en"
          ? "The project must finish saving before video generation."
          : "يجب حفظ المشروع قبل توليد الفيديو.",
      );
    }
    try {
      await enqueueProjectSave(({ project: currentProject, version }) =>
        persistStandardReservedMedia({
          project: currentProject,
          version,
          confirmed: input.confirmation,
          recipeId: input.draft.recipeId,
          inputAssetId: input.draft.bindings[0]?.assetId ?? null,
          inputRole: "FIRST_FRAME",
          anchor: { x: 0, y: 0 },
        }),
      );
    } catch (error) {
      setSaveState("ERROR");
      throw error;
    }
  };
  const completeStandardVideo = async (input: {
    draft: VideoComposerDraft;
    execution: ExecutedVideoOperation;
  }) => {
    if (!project || projectVersion === null) {
      throw new Error(
        locale === "en"
          ? "The project could not be updated with this video."
          : "تعذر حفظ نتيجة الفيديو داخل المشروع.",
      );
    }
    try {
      await enqueueProjectSave(async ({ project: currentProject, version }) => {
        const resultSaved = await persistStandardMediaResult({
          project: currentProject,
          version,
          execution: input.execution,
          mediaType: "VIDEO",
        });
        const outputAssetId =
          resultSaved.document.operations[input.execution.operation.id]
            ?.outputAssetId ?? null;
        return persistStandardGenerationSession({
          project: resultSaved.document,
          version: resultSaved.version,
          operationId: input.execution.operation.id,
          outputAssetId,
        });
      });
    } catch (error) {
      setSaveState("ERROR");
      throw error;
    }
  };
  const uploadStandardVideoReference = async (file: File): Promise<{ assetId: string; name: string }> => {
    if (!project || projectVersion === null) {
      throw new Error(
        locale === "en"
          ? "The project must finish saving before uploading a reference."
          : "يجب حفظ المشروع قبل رفع الصورة المرجعية.",
      );
    }
    try {
      const uploaded = await uploadInputImage(project.projectId, file);
      uploadPreviewUrls.current[uploaded.assetId] = URL.createObjectURL(file);
      setUploadPreviewRevision((current) => current + 1);
      await enqueueProjectSave(({ project: currentProject, version }) =>
        savePersistedCreativeSpaceProject(
          addVerifiedUploadedAsset(currentProject, {
            id: uploaded.assetId,
            name: uploaded.name,
            mimeType: uploaded.contentType,
            bytes: uploaded.byteLength,
            checksumSha256: uploaded.checksumSha256,
          }),
          version,
        ),
      );
      return { assetId: uploaded.assetId, name: uploaded.name };
    } catch (error) {
      setSaveState("ERROR");
      throw error;
    }
  };
  const uploadStandardImageReference = async (file: File) => {
    const uploaded = await uploadStandardVideoReference(file);
    setReserved(null);
    setExecution(null);
    setExecutionError(null);
    setDraft((current) => current ? {
      ...current,
      inputAssetId: uploaded.assetId,
      updatedAt: new Date().toISOString(),
    } : current);
  };
  const changeAssetTrash = async (
    assetId: string,
    action: "TRASH" | "RESTORE",
  ) => {
    if (!project || projectVersion === null) return;
    try {
      await enqueueProjectSave(({ project: currentProject, version }) =>
        persistStandardGalleryTrash({
          project: currentProject,
          version,
          assetId,
          action,
        }),
      );
      if (action === "TRASH" && viewerAsset?.id === assetId) {
        setViewerAsset(null);
        setViewerUrl(null);
      }
    } catch (error) {
      setSaveState(
        error &&
          typeof error === "object" &&
          "status" in error &&
          error.status === 409
          ? "CONFLICT"
          : "ERROR",
      );
    }
  };
  const renderControl = (entry: (typeof controls)[number]) => {
    const { control, value } = entry;
    const label = control.ui?.labelKey.replace("control.", "") ?? control.id;
    const compact = control.ui?.group === "BASIC";
    const compactIcon = control.id === "aspectRatio"
      ? <Maximize2 className="h-3.5 w-3.5" />
      : <ImageIcon className="h-3.5 w-3.5" />;
    const values = publishedOfferFamilyControlValues({
      offers,
      selectedOffer: selected,
      recipeId: draft?.recipeId ?? "image.create",
      settings: draft?.settings ?? {},
      control,
    });
    if (control.kind === "boolean")
      return (
        <label
          key={control.id}
          className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-[13px]"
        >
          <span className="capitalize">{label}</span>
          <input
            aria-label={label}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) =>
              selectPublishedSetting(control.id, event.target.checked)
            }
          />
        </label>
      );
    if (control.kind === "number")
      return (
        <label key={control.id} className="block text-sm">
          <span className="mb-1 block text-[11px] font-semibold capitalize">{label}</span>
          <input
            aria-label={label}
            type="number"
            min={control.min}
            max={control.max}
            step={control.step}
            value={Number(value)}
            onChange={(event) =>
              selectPublishedSetting(control.id, Number(event.target.value))
            }
            className="w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-[13px]"
          />
        </label>
      );
    return (
      <CustomerSelect
        key={control.id}
        ariaLabel={label}
        compact={compact}
        icon={compact ? compactIcon : undefined}
        label={label}
        value={String(value)}
        options={(values ?? []).map((option) => ({ value: String(option), label: String(option) }))}
        onValueChange={(nextValue) => {
          const next = values.find((option) => String(option) === nextValue);
          if (next !== undefined) selectPublishedSetting(control.id, next);
        }}
      />
    );
  };
  const recipeLabel = (recipeId: string) => {
    const names =
      locale === "en"
        ? {
            "image.create": "Text to image",
            "image.edit": "Image to image",
            "image.remix": "Remix",
            "image.inpaint": "Inpaint",
            "image.upscale": "Upscale",
          }
        : {
            "image.create": "نص إلى صورة",
            "image.edit": "صورة إلى صورة",
            "image.remix": "إعادة مزج",
            "image.inpaint": "تعديل جزء",
            "image.upscale": "رفع الدقة",
          };
    return names[recipeId as keyof typeof names] ?? recipeId;
  };
  const reviewCharge = reviewOperation
    ? "customerChargedCredits" in reviewOperation
      ? reviewOperation.customerChargedCredits ?? 0
      : reviewOperation.financials.customerChargedCredits ?? 0
    : 0;
  const reviewCopy = reviewOperation
    ? reviewOperation.state === "RECONCILIATION_REQUIRED"
      ? locale === "en"
        ? {
            title: "Financial reconciliation required",
            detail: "Do not retry or assume a refund. Review the operation history before taking any action.",
          }
        : {
            title: "تتطلب العملية مراجعة مالية",
            detail: "لا تعِد المحاولة ولا تفترض استرداد الرصيد. راجع سجل العملية قبل اتخاذ أي إجراء.",
          }
      : reviewOperation.state === "DELIVERY_FAILED"
        ? locale === "en"
          ? {
              title: "Result delivery needs review",
              detail: "The provider result was not safely delivered. Review the operation history before taking any action.",
            }
          : {
              title: "نتيجة التوليد تحتاج مراجعة",
              detail: "لم يتم تسليم نتيجة المزود بأمان. راجع سجل العملية قبل اتخاذ أي إجراء.",
            }
        : locale === "en"
          ? {
              title: "Provider generation failed",
              detail: `Recorded final customer charge: ${reviewCharge} credits. Review the operation history before taking any action.`,
            }
          : {
              title: "فشل التوليد لدى المزود",
              detail: `الخصم النهائي المسجل للعميل: ${reviewCharge} كريدت. راجع سجل العملية قبل اتخاذ أي إجراء.`,
            }
    : null;
  const imageComposer = (
    <div className="standard-generation-panel min-h-0 max-h-[calc(100dvh-116px)] overflow-y-auto overscroll-y-contain rounded-2xl border border-white/[0.1] p-3 shadow-[0_18px_42px_rgba(0,0,0,.28)] lg:h-full lg:max-h-none">
      <div className="space-y-3">
        <StandardMediaTabs
          locale={locale}
          active={activeMedia}
          onChange={setActiveMedia}
          enabled={hasPublishedVideo ? ["image", "video"] : ["image"]}
        />
        {reviewOperation && reviewCopy && (
          <section
            role="alert"
            className="rounded-xl border border-amber-300/30 bg-amber-300/[0.07] p-3 text-xs text-amber-50"
          >
            <h3 className="text-sm font-bold">{reviewCopy.title}</h3>
            <p className="mt-1.5 leading-5 text-amber-50/80">{reviewCopy.detail}</p>
            <button
              type="button"
              onClick={() => navigate(`/admin/operations/${encodeURIComponent(reviewOperation.id)}`)}
              className="mt-3 rounded-lg border border-amber-200/25 px-3 py-2 text-xs font-semibold transition hover:bg-amber-100/10"
            >
              {locale === "en" ? "Review operation" : "مراجعة العملية"}
            </button>
          </section>
        )}
        {catalogState === "ready" && offers.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-white/[0.14] bg-black/20 px-4 py-8 text-center">
            <ImageIcon className="mx-auto h-6 w-6 text-violet-200/60" />
            <h3 className="mt-3 text-sm font-semibold">
              {locale === "en"
                ? "No image models are published"
                : "لا توجد نماذج صور منشورة"}
            </h3>
            <p className="mt-2 text-xs leading-5 text-white/50">
              {locale === "en"
                ? "This workspace is ready. Publish an active, priced image offer from the catalog before it appears here."
                : "مساحة العمل جاهزة. انشر عرض صور مفعّلاً ومُسعّراً من الكتالوج ليظهر هنا."}
            </p>
            <button
              type="button"
              onClick={() => void refreshCatalog()}
              disabled={catalogRefreshing}
              className="mx-auto mt-4 inline-flex items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${catalogRefreshing ? "animate-spin" : ""}`}
              />
              {catalogRefreshing
                ? locale === "en"
                  ? "Checking catalog…"
                  : "جارٍ تحديث الكتالوج…"
                : locale === "en"
                  ? "Refresh catalog"
                  : "تحديث الكتالوج"}
            </button>
          </section>
        ) : catalogState === "ready" &&
          draft &&
          selected &&
          saveState !== "ERROR" ? (
          <>
            <section aria-label={locale === "en" ? "Generation mode" : "وضع التوليد"}>
              <CustomerSelect
                ariaLabel={locale === "en" ? "Mode" : "المهمة"}
                label={locale === "en" ? "Mode" : "المهمة"}
                value={draft.recipeId}
                options={customerImageRecipeIds.map((recipeId) => ({
                  value: recipeId,
                  label: recipeLabel(recipeId),
                  disabled: !publishedImageRecipeIds.has(recipeId),
                }))}
                onValueChange={(recipeId) => selectRecipe(recipeId as ImageComposerDraft["recipeId"])}
              />
            </section>
            <PublishedModelPicker
              locale={locale}
              offers={offers}
              recipeId={draft.recipeId}
              selectedOfferId={selected.offerId}
              onSelect={selectOffer}
            />
            {pendingOffer && (
              <section className="standard-quiet-surface p-3 text-xs">
                <p>
                  {locale === "en"
                    ? "This model changes compatible settings. Review before applying."
                    : "هذا النموذج يغيّر إعدادات متوافقة. راجع قبل التطبيق."}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingOffer(null)}
                    className="standard-secondary-action px-3 py-2"
                  >
                    {locale === "en" ? "Cancel" : "إلغاء"}
                  </button>
                  <button
                    type="button"
                    onClick={applyPending}
                    className="standard-primary-action px-3 py-2"
                  >
                    {locale === "en" ? "Apply changes" : "تطبيق التغييرات"}
                  </button>
                </div>
              </section>
            )}
            {activeRecipe && activeRecipe.bindings.max > 0 && (
              <section className="text-xs">
                {selectedImageReferenceAsset ? (
                  <div className="standard-quiet-surface flex items-center gap-2.5 p-2">
                    <ReferenceAssetThumbnail asset={selectedImageReferenceAsset} onResolvePreview={resolveGalleryPreview} />
                    <div className="min-w-0">
                      <p className="font-semibold text-white">
                        {locale === "en" ? "Reference selected" : "تم اختيار صورة مرجعية"}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-4 text-white/55">
                        {locale === "en"
                          ? "Choose another asset from its Use as reference action."
                          : "لاختيار أصل آخر، استخدم زر «استخدام كمرجع» من الكارت."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          inputAssetId: null,
                          updatedAt: new Date().toISOString(),
                        })
                      }
                      className="ml-auto shrink-0 text-[11px] font-semibold text-white/65 underline transition hover:text-white"
                    >
                      {locale === "en" ? "Remove" : "إزالة"}
                    </button>
                  </div>
                ) : (
                  <label
                    className="standard-reference-dropzone cursor-pointer px-4 py-3"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const file = event.dataTransfer.files?.[0] ?? null;
                      if (file) void uploadStandardImageReference(file);
                    }}
                  >
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0] ?? null;
                        if (file) void uploadStandardImageReference(file);
                        event.currentTarget.value = "";
                      }}
                    />
                    <span className="relative z-10 flex flex-col items-center">
                      <span className="standard-reference-icon"><ImagePlus className="h-4 w-4" /></span>
                      <span className="mt-2 text-[13px] font-bold text-white">
                        {locale === "en" ? "Add reference" : "إضافة مرجع"}
                      </span>
                      <span className="mt-0.5 text-[11px] text-white/50">
                        {locale === "en" ? "Click or drop an image" : "انقر أو اسحب صورة هنا"}
                      </span>
                    </span>
                  </label>
                )}
              </section>
            )}
            {draft.inputAssetId && !activeRecipe?.bindings.max && (
              <div className="flex items-center justify-between rounded-lg border border-white/[0.12] bg-white/[0.025] px-2.5 py-2 text-xs">
                <span>
                  {locale === "en" ? "Reference selected" : "تم اختيار مرجع"}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      inputAssetId: null,
                      updatedAt: new Date().toISOString(),
                    })
                  }
                  className="underline"
                >
                  {locale === "en" ? "Remove" : "إزالة"}
                </button>
              </div>
            )}
            <section className="standard-panel-section">
              <div className="grid grid-cols-2 gap-2">
                {controls
                  .filter(({ control }) => control.ui?.group === "BASIC")
                  .map(renderControl)}
              </div>
            </section>
            <label className="standard-panel-section block text-sm">
              <span className="standard-prompt-surface block">
              <span className="standard-field-label px-2.5 pt-2.5">
                {text.prompt}
              </span>
              <textarea
                aria-label={text.prompt}
                value={draft.prompt}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    prompt: event.target.value,
                    updatedAt: new Date().toISOString(),
                  })
                }
                placeholder={text.promptHint}
                className="w-full resize-none px-2.5 pb-2.5 text-[13px] leading-5"
              />
              </span>
            </label>
            <details className="standard-panel-section">
              <summary className="cursor-pointer text-[11px] font-bold text-white/75 transition hover:text-white">
                {text.advanced}
              </summary>
              <div className="mt-2.5 grid gap-2">
                {controls
                  .filter(({ control }) => control.ui?.group === "ADVANCED")
                  .map(renderControl)}
              </div>
            </details>
            <StandardQuoteGate
              key={`${draft.offerId}:${draft.recipeId}:${draft.updatedAt}`}
              locale={locale}
              canQuote={
                draft.prompt.trim().length > 0 &&
                !pendingOffer &&
                saveState === "SAVED" &&
                (activeRecipe?.bindings.min !== 1 ||
                  Boolean(draft.inputAssetId))
              }
              requestQuote={() =>
                requestImageQuote(
                  draft,
                  draft.inputAssetId
                    ? (project?.assets[draft.inputAssetId] ?? null)
                    : null,
                )
              }
              confirmQuote={confirmImageQuote}
              onReserved={(confirmed) => void reserveOperation(confirmed)}
              formatError={(error) => imageRequestErrorMessage(error, locale)}
            />
          </>
        ) : (
          <StandardStatePanel
            locale={locale}
            state={
              catalogState === "error" || saveState === "ERROR"
                ? "error"
                : "loading"
            }
            onRetry={() => {
              if (catalogState === "error") void refreshCatalog();
              else window.location.reload();
            }}
          />
        )}
      </div>
    </div>
  );
  const videoComposer = (
    <div className="standard-generation-panel min-h-0 max-h-[calc(100dvh-116px)] overflow-y-auto overscroll-y-contain rounded-2xl border border-white/[0.1] p-3 shadow-[0_18px_42px_rgba(0,0,0,.28)] lg:h-full lg:max-h-none">
      <div className="space-y-3">
        <StandardMediaTabs
          locale={locale}
          active={activeMedia}
          onChange={setActiveMedia}
          enabled={hasPublishedVideo ? ["image", "video"] : ["image"]}
        />
        {project ? (
          <StandardVideoComposer
            locale={locale}
            offers={offers}
            project={project}
            onReserved={reserveStandardVideo}
            onCompleted={completeStandardVideo}
            onUploadReference={uploadStandardVideoReference}
            onWalletChanged={() => void refreshAvailableCredits()}
            referenceAssetId={videoReferenceAssetId}
            onResolveAssetPreview={resolveGalleryPreview}
          />
        ) : (
          <StandardStatePanel locale={locale} state="loading" />
        )}
      </div>
    </div>
  );
  const pendingOperation =
    !executionError &&
    (reserved || operationIdToMonitor) &&
    !["SETTLED", "PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"].includes(
      execution?.operation.state ?? executionState ?? reserved?.operation.state ?? "",
    )
      ? {
          state: executionState ?? reserved?.operation.state ?? "RUNNING",
          reservedCredits: reserved?.quote.customerCredits ?? null,
        }
      : null;
  const gallery = (
    <div className="w-full space-y-5">
      {assetFeedback && (
        <p
          role="alert"
          className="rounded-xl border border-amber-300/25 bg-amber-300/5 px-3 py-2 text-sm text-amber-100"
        >
          {assetFeedback}
        </p>
      )}
      <StandardImageGallery
        locale={locale}
        assets={galleryAssets}
        onView={(asset) => void openAsset(asset)}
        onDownload={(asset) => void downloadAsset(asset)}
        canUseAsReference={canUseReference}
        onUseAsReference={(asset) => {
          if (activeMedia === "video") {
            setVideoReferenceAssetId(asset.id);
            return;
          }
          useAsReference(asset);
        }}
        onTrash={(asset) => void changeAssetTrash(asset.id, "TRASH")}
        onResolvePreview={resolveGalleryPreview}
        onMediaMetadata={persistGalleryMediaMetadata}
        pendingOperation={pendingOperation}
      />
      {trashedAssets.length > 0 && (
        <details className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            {locale === "en"
              ? `Recently removed (${trashedAssets.length})`
              : `المحذوفات مؤخراً (${trashedAssets.length})`}
          </summary>
          <p className="mt-2 text-xs text-white/50">
            {locale === "en"
              ? "These results are hidden only. Restore returns them to this project; permanent purge is not available here."
              : "هذه النتائج مخفية فقط. الاستعادة تعيدها للمشروع؛ الحذف الدائم غير متاح من هنا."}
          </p>
          <div className="mt-3 space-y-2">
            {trashedAssets.map(({ asset, purgeAfter }) => (
              <div
                key={asset.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{asset.name}</p>
                  <p className="text-xs text-white/45">
                    {locale === "en"
                      ? `Retention until ${new Date(purgeAfter).toLocaleDateString("en-US")}`
                      : `محفوظ حتى ${new Date(purgeAfter).toLocaleDateString("ar-IQ")}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void changeAssetTrash(asset.id, "RESTORE")}
                  className="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold"
                >
                  {locale === "en" ? "Restore" : "استعادة"}
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
  const workspace = gallery;
  return (
    <StandardShell
      locale={locale}
      projectName={text.project}
      onLocaleChange={() =>
        setLocale((current) => (current === "en" ? "ar" : "en"))
      }
      onSpaceClick={() =>
        navigate(`/projects/${encodeURIComponent(projectId)}/studio`)
      }
      availableCredits={availableCredits}
      onProfileClick={() => navigate("/profile")}
      composer={activeMedia === "video" ? videoComposer : imageComposer}
    >
      <section className="standard-result-stage min-h-[calc(100dvh-100px)] p-2 sm:p-4 lg:min-h-0">
        {activeMedia === "video" ? gallery : workspace}
      </section>
      <Dialog
        open={viewerAsset !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewerAsset(null);
            setViewerUrl(null);
          }
        }}
      >
        <DialogContent
          showClose={false}
          overlayClassName="bg-black/72 backdrop-blur-xl"
          className="!fixed !inset-0 !z-50 !grid !h-dvh !w-screen !max-w-none !translate-x-0 !translate-y-0 !border-0 !bg-transparent !p-0 !shadow-none !duration-200 sm:!rounded-none"
        >
          <DialogTitle className="sr-only">
            {viewerAsset?.name ?? ""}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {locale === "en" ? "Project asset preview" : "معاينة أصل المشروع"}
          </DialogDescription>
          <div className="relative grid h-full min-h-0 w-full place-items-center overflow-hidden p-4 sm:p-10">
            {viewerUrl && viewerAsset?.kind === "VIDEO" ? (
              <video
                src={viewerUrl}
                controls
                playsInline
                className="max-h-[calc(100dvh-10rem)] max-w-[calc(100vw-2rem)] object-contain shadow-[0_24px_90px_rgba(0,0,0,.45)]"
              />
            ) : viewerUrl ? (
              <img
                src={viewerUrl}
                alt={viewerAsset?.name ?? ""}
                className="max-h-[calc(100dvh-10rem)] max-w-[calc(100vw-2rem)] object-contain shadow-[0_24px_90px_rgba(0,0,0,.45)]"
              />
            ) : (
              <Loader2 className="my-24 h-8 w-8 animate-spin text-violet-300" />
            )}
            <div className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-10 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-full border border-white/[0.14] bg-black/55 px-2 py-2 shadow-[0_14px_42px_rgba(0,0,0,.45)] backdrop-blur-xl">
              {viewerAsset?.deliveryAssetId && (
                <button
                  type="button"
                  onClick={() => void downloadAsset(viewerAsset)}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-black"
                >
                  <Download className="h-4 w-4" />
                  {locale === "en" ? "Download" : "تنزيل"}
                </button>
              )}
              {viewerAsset && canUseReference && (
                <button
                  type="button"
                  onClick={() => {
                    if (activeMedia === "video") setVideoReferenceAssetId(viewerAsset.id);
                    else useAsReference(viewerAsset);
                    setViewerAsset(null);
                    setViewerUrl(null);
                  }}
                  className="rounded-full border border-violet-300/35 px-4 py-2.5 text-sm font-semibold text-violet-100 transition hover:bg-violet-300/10"
                >
                  {locale === "en" ? "Use as reference" : "استخدام كمرجع"}
                </button>
              )}
              <DialogClose
                className="grid h-10 w-10 place-items-center rounded-full border border-white/[0.14] text-white/75 transition hover:bg-white/[0.1] hover:text-white"
                aria-label={locale === "en" ? "Close preview" : "إغلاق المعاينة"}
              >
                <X className="h-4 w-4" />
              </DialogClose>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </StandardShell>
  );
}
