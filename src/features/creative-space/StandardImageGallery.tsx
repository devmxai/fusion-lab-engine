import { useEffect, useRef, useState } from "react";
import { Download, Eye, ImageIcon, Loader2, MoreHorizontal, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SpaceAsset, SpaceAssetMediaMetadata } from "./domain";
import type { UiFuxLocale } from "./product-decisions";

type Props = Readonly<{
  locale: UiFuxLocale;
  assets: readonly SpaceAsset[];
  onView: (asset: SpaceAsset) => void;
  onDownload: (asset: SpaceAsset) => void;
  canUseAsReference: boolean;
  onUseAsReference: (asset: SpaceAsset) => void;
  onTrash?: (asset: SpaceAsset) => void;
  /** Resolves a short-lived private preview only when the card enters view. */
  onResolvePreview?: (asset: SpaceAsset) => Promise<string | null>;
  /** Persists facts decoded from the delivered file; never provider metadata. */
  onMediaMetadata?: (
    asset: SpaceAsset,
    metadata: SpaceAssetMediaMetadata,
  ) => void;
  pendingOperation?: Readonly<{ state: string; reservedCredits: number | null }> | null;
}>;

function AssetPreview({
  asset,
  onResolvePreview,
  onMediaMetadata,
}: Readonly<{
  asset: SpaceAsset;
  onResolvePreview?: (asset: SpaceAsset) => Promise<string | null>;
  onMediaMetadata?: (asset: SpaceAsset, metadata: SpaceAssetMediaMetadata) => void;
}>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<string | null>(asset.resultUrl ?? null);
  const ownedPreviewRef = useRef<string | null>(null);
  const emittedMetadataRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(asset.resultUrl ?? null);
  const [isVisible, setIsVisible] = useState(false);
  const aspectRatio =
    asset.mediaMetadata?.width && asset.mediaMetadata?.height
      ? `${asset.mediaMetadata.width} / ${asset.mediaMetadata.height}`
      : undefined;

  const reportMetadata = (metadata: SpaceAssetMediaMetadata) => {
    const normalized = Object.fromEntries(
      Object.entries(metadata).filter(
        ([, value]) =>
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isSafeInteger(value) && value >= 0),
      ),
    ) as SpaceAssetMediaMetadata;
    if (!Object.keys(normalized).length) return;
    const unchanged = Object.entries(normalized).every(
      ([key, value]) =>
        asset.mediaMetadata?.[key as keyof SpaceAssetMediaMetadata] === value,
    );
    const fingerprint = JSON.stringify(normalized);
    if (unchanged || emittedMetadataRef.current === fingerprint) return;
    emittedMetadataRef.current = fingerprint;
    onMediaMetadata?.(asset, normalized);
  };

  useEffect(() => {
    emittedMetadataRef.current = null;
  }, [asset.id]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;
    if (!("IntersectionObserver" in window)) {
      setIsVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setIsVisible(true);
        observer.disconnect();
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (asset.resultUrl) {
      if (ownedPreviewRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(ownedPreviewRef.current);
      }
      ownedPreviewRef.current = null;
      previewRef.current = asset.resultUrl;
      setPreviewUrl(asset.resultUrl);
      return undefined;
    }
    if (!isVisible || !onResolvePreview || previewRef.current) return undefined;
    let active = true;
    void onResolvePreview(asset)
      .then((url) => {
        if (!active || !url) return;
        previewRef.current = url;
        ownedPreviewRef.current = url;
        setPreviewUrl(url);
      })
      .catch(() => {
        // A card remains usable through View/Download if its short-lived
        // preview cannot be reacquired. Do not surface one failure as a
        // project-wide gallery error.
      });
    return () => {
      active = false;
    };
  }, [asset, isVisible, onResolvePreview]);

  useEffect(
    () => () => {
      const url = ownedPreviewRef.current;
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    [],
  );

  return (
    <div
      ref={rootRef}
      style={aspectRatio ? { aspectRatio } : undefined}
      className="relative grid min-h-40 place-items-center overflow-hidden bg-gradient-to-br from-violet-400/15 via-[#11141b] to-cyan-300/10"
    >
      {asset.kind === "VIDEO" && previewUrl ? (
        <video
          src={previewUrl}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            reportMetadata({
              width: video.videoWidth,
              height: video.videoHeight,
              ...(Number.isFinite(video.duration) && video.duration >= 0
                ? { durationMs: Math.round(video.duration * 1000) }
                : {}),
            });
          }}
          className="max-h-[420px] w-full object-cover"
        />
      ) : previewUrl ? (
        <img
          src={previewUrl}
          alt={asset.name}
          loading="lazy"
          onLoad={(event) =>
            reportMetadata({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          className="h-auto max-h-[560px] w-full object-cover"
        />
      ) : (
        <ImageIcon className="h-8 w-8 text-white/35" />
      )}
    </div>
  );
}

/** Gallery derives exclusively from canonical generated assets; it does not own result state. */
export function StandardImageGallery({
  locale,
  assets,
  onView,
  onDownload,
  canUseAsReference,
  onUseAsReference,
  onTrash,
  onResolvePreview,
  onMediaMetadata,
  pendingOperation = null,
}: Props) {
  const copy =
    locale === "en"
      ? {
          title: "Project assets",
          empty: "Generated media and uploads will stay in this project.",
          view: "View",
          download: "Download",
          reference: "Use as reference",
          trash: "Move to trash",
        }
      : {
          title: "أصول المشروع",
          empty: "ستبقى الوسائط المُنشأة والمرفوعة داخل هذا المشروع.",
          view: "معاينة",
          download: "تنزيل",
          reference: "استخدام كمرجع",
          trash: "نقل إلى المحذوفات",
        };
  if (!assets.length && !pendingOperation)
    return (
      <div className="grid min-h-[56dvh] place-items-center p-6 text-center">
        <div className="max-w-xs">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.025] text-violet-200/70">
            <ImageIcon className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-sm font-semibold">{copy.title}</h2>
          <p className="mt-1.5 text-xs leading-5 text-white/45">{copy.empty}</p>
        </div>
      </div>
    );
  return (
    <section aria-label={copy.title} className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{copy.title}</h2>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.025] px-2 py-1 text-[10px] text-white/45">
          {assets.length}
        </span>
      </div>
      <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">
        {pendingOperation && (
          <article className="relative mb-4 break-inside-avoid overflow-hidden rounded-2xl border border-violet-300/40 bg-[#13111d] p-5 shadow-[0_0_42px_rgba(139,92,246,.18)]">
            <div className="pointer-events-none absolute inset-0 animate-pulse bg-[radial-gradient(circle_at_50%_0%,rgba(167,139,250,.20),transparent_58%)]" />
            <div className="relative grid min-h-52 place-items-center text-center">
              <div>
                <div className="relative mx-auto grid h-12 w-12 place-items-center">
                  <span className="absolute inset-0 animate-spin rounded-full border-2 border-violet-300/20 border-t-violet-200" />
                  <span className="absolute inset-1 animate-[spin_1.7s_linear_infinite_reverse] rounded-full border border-cyan-200/15 border-b-cyan-200/80" />
                  <Loader2 className="h-5 w-5 animate-spin text-violet-100" />
                </div>
                <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-200/75">
                  {locale === "en" ? "Generation operation" : "عملية توليد"}
                </p>
                <h3 className="mt-2 text-sm font-bold">
                  {locale === "en" ? "Generating" : "جارٍ التوليد"}
                </h3>
                <p className="mt-1 text-xs text-white/50">{pendingOperation.state}</p>
                {pendingOperation.reservedCredits !== null && (
                  <p className="mt-3 text-[11px] text-white/45">
                    {locale === "en" ? `${pendingOperation.reservedCredits} credits reserved` : `تم حجز ${pendingOperation.reservedCredits} كريدت`}
                  </p>
                )}
              </div>
            </div>
          </article>
        )}
        {assets.map((asset) => (
          <article
            key={asset.id}
            className="group relative mb-4 break-inside-avoid overflow-hidden rounded-2xl border border-white/[0.1] bg-[#11141b] text-left shadow-[0_14px_32px_rgba(0,0,0,.2)] transition duration-200 hover:-translate-y-0.5 hover:border-violet-300/35"
          >
            <div className="relative">
              <AssetPreview
                asset={asset}
                onResolvePreview={onResolvePreview}
                onMediaMetadata={onMediaMetadata}
              />
              <button type="button" aria-label={`${copy.view}: ${asset.name}`} onClick={() => onView(asset)} className="absolute inset-0" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${locale === "en" ? "Asset actions" : "إجراءات الأصل"}: ${asset.name}`}
                    className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-white/[0.1] bg-black/55 text-white/80 opacity-0 backdrop-blur transition hover:bg-black/75 focus:opacity-100 group-hover:opacity-100"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44 border-white/10 bg-[#151821] p-1 text-white shadow-2xl">
                  <DropdownMenuItem onSelect={() => onView(asset)} className="cursor-pointer gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold focus:bg-white/[0.08] focus:text-white">
                    <Eye className="h-3.5 w-3.5" />
                    {copy.view}
                  </DropdownMenuItem>
                  {asset.deliveryAssetId && (
                    <DropdownMenuItem onSelect={() => onDownload(asset)} className="cursor-pointer gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold focus:bg-white/[0.08] focus:text-white">
                      <Download className="h-3.5 w-3.5" />
                      {copy.download}
                    </DropdownMenuItem>
                  )}
                  {canUseAsReference && (
                    <DropdownMenuItem onSelect={() => onUseAsReference(asset)} className="cursor-pointer gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-violet-100 focus:bg-violet-300/10 focus:text-violet-50">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {copy.reference}
                    </DropdownMenuItem>
                  )}
                  {onTrash && (
                    <>
                      <DropdownMenuSeparator className="bg-white/[0.08]" />
                      <DropdownMenuItem onSelect={() => onTrash(asset)} className="cursor-pointer gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-red-100 focus:bg-red-300/10 focus:text-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
                        {copy.trash}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {/* The gallery is a visual asset board, not a file manager.  File
                names remain available to assistive technology and the action
                menu, but are intentionally not printed below every card. */}
          </article>
        ))}
      </div>
    </section>
  );
}
