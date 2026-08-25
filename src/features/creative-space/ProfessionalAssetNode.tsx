import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FileAudio2, FileImage, FileVideo2 } from "lucide-react";
import type { ProfessionalAssetFlowNode } from "./xyflow-adapter";

const icons = { IMAGE: FileImage, VIDEO: FileVideo2, AUDIO: FileAudio2 } as const;

function ProfessionalAssetNodeComponent({ data, selected }: NodeProps<ProfessionalAssetFlowNode>) {
  const Icon = icons[data.asset.kind];
  const input = data.ports.find((port) => port.direction === "INPUT");
  const output = data.ports.find((port) => port.direction === "OUTPUT");
  return <article className={`h-[176px] w-[248px] overflow-hidden rounded-xl border bg-[#101217] shadow-2xl ${selected ? "border-cyan-300 ring-2 ring-cyan-300/20" : "border-cyan-300/30"}`} data-testid={`professional-asset-${data.asset.id}`} dir="ltr">
    {input && <Handle id={input.id} type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-[#101217] !bg-emerald-400" />}
    {output && <Handle id={output.id} type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-[#101217] !bg-cyan-300" />}
    <div className="space-card-drag-handle flex h-24 cursor-grab items-center justify-center bg-gradient-to-br from-cyan-400/20 to-sky-500/5 active:cursor-grabbing"><Icon className="h-9 w-9 text-cyan-100" /></div>
    <div className="px-3 py-2" dir="rtl"><p className="truncate text-xs font-bold">{data.asset.name}</p><p className="mt-1 text-[10px] text-cyan-100/60">ASSET · {data.asset.kind}</p><div className="mt-2 flex justify-between text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"><span>{input ? "INPUT" : ""}</span><span>{output ? "OUTPUT" : ""}</span></div></div>
  </article>;
}

export const ProfessionalAssetNode = memo(ProfessionalAssetNodeComponent);
