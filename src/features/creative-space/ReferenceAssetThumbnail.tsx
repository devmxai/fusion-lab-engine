import { ImageIcon, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SpaceAsset } from "./domain";

/**
 * A compact, private preview used only after the customer explicitly chooses
 * an asset as an input. It resolves through the same Engine-owned preview
 * boundary as the gallery and never persists a browser URL.
 */
export function ReferenceAssetThumbnail({
  asset,
  onResolvePreview,
}: Readonly<{
  asset: SpaceAsset | null;
  onResolvePreview: (asset: SpaceAsset) => Promise<string | null>;
}>) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(asset?.resultUrl ?? null);
  const ownedUrl = useRef<string | null>(null);

  useEffect(() => {
    const previous = ownedUrl.current;
    if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
    ownedUrl.current = null;
    setPreviewUrl(asset?.resultUrl ?? null);
    if (!asset || asset.resultUrl) return undefined;
    let active = true;
    void onResolvePreview(asset).then((url) => {
      if (!active || !url) return;
      ownedUrl.current = url;
      setPreviewUrl(url);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [asset, onResolvePreview]);

  useEffect(() => () => {
    const url = ownedUrl.current;
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/[0.12] bg-black/30">
      {previewUrl ? (
        <img src={previewUrl} alt="" className="h-full w-full object-cover" />
      ) : asset ? (
        <Loader2 className="h-4 w-4 animate-spin text-violet-200" />
      ) : (
        <ImageIcon className="h-4 w-4 text-white/40" />
      )}
    </div>
  );
}
