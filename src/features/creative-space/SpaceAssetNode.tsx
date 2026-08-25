import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FileAudio2, FileImage, FileVideo2, MoreHorizontal } from "lucide-react";
import type { SpaceAssetFlowNode } from "./xyflow-adapter";

const kindStyle = {
  IMAGE: { icon: FileImage, label: "Image", accent: "from-violet-500/25 to-fuchsia-500/5" },
  VIDEO: { icon: FileVideo2, label: "Video", accent: "from-sky-500/25 to-cyan-500/5" },
  AUDIO: { icon: FileAudio2, label: "Audio", accent: "from-amber-500/25 to-orange-500/5" },
} as const;

function readableBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function previewSource(resultUrl: string): string {
  return resultUrl.startsWith("blob:") ? resultUrl : `/api/engine${resultUrl}`;
}

function SpaceAssetNodeComponent({ data, selected }: NodeProps<SpaceAssetFlowNode>) {
  const asset = data.asset;
  const style = kindStyle[asset.kind];
  const Icon = style.icon;
  return (
    <article
      data-testid={`space-asset-${asset.id}`}
      className={`h-[176px] w-[248px] overflow-hidden rounded-2xl border bg-card shadow-2xl transition-[border-color,box-shadow] ${selected ? "border-primary ring-2 ring-primary/20" : "border-border/80 hover:border-border"}`}
      dir="rtl"
    >
      <Handle id="input" type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-card !bg-emerald-400" />
      <Handle id="output" type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-card !bg-violet-400" />
      <div className={`space-card-drag-handle relative flex h-[112px] cursor-grab items-center justify-center bg-gradient-to-br ${style.accent} active:cursor-grabbing`}>
        <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_center,hsl(var(--foreground)/.12)_1px,transparent_1px)] [background-size:12px_12px]" />
        {asset.kind === "IMAGE" && asset.resultUrl ? <img src={previewSource(asset.resultUrl)} alt={asset.name} className="absolute inset-0 h-full w-full object-cover" /> : <Icon className="relative h-9 w-9 text-foreground/80" />}
        {asset.kind === "AUDIO" && <div className="absolute bottom-5 flex items-end gap-1" aria-hidden="true">{[12, 22, 16, 28, 18, 24, 10].map((height, index) => <span key={index} className="w-1 rounded-full bg-foreground/40" style={{ height }} />)}</div>}
        <span className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-semibold text-white/80 backdrop-blur">{asset.origin === "GENERATED" ? "Output" : style.label}</span>
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold" title={asset.name}>{asset.name}</p><p className="mt-1 text-[10px] text-muted-foreground" dir="ltr">{asset.origin === "GENERATED" ? "Generated" : readableBytes(asset.bytes)} · {asset.status}</p></div>
        <button className="nodrag nopan rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`خيارات ${asset.name}`}><MoreHorizontal className="h-4 w-4" /></button>
      </div>
    </article>
  );
}

export const SpaceAssetNode = memo(SpaceAssetNodeComponent);
