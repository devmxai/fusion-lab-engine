import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Braces, CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import type { ProfessionalOperationFlowNode } from "./xyflow-adapter";

const failures = new Set(["PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"]);

function ProfessionalOperationNodeComponent({ data, selected }: NodeProps<ProfessionalOperationFlowNode>) {
  const operation = data.operation;
  const inputs = data.ports.filter((port) => port.direction === "INPUT");
  const output = data.ports.find((port) => port.direction === "OUTPUT");
  const Icon = failures.has(operation.state) ? TriangleAlert : operation.state === "SETTLED" ? CheckCircle2 : CircleDashed;
  const customerFinancialLabel = operation.customerChargedCredits === null
    ? `QUOTE · ${operation.customerCredits} credits`
    : `SETTLED · ${operation.customerChargedCredits} credits`;
  return <article className={`relative h-[176px] w-[248px] overflow-visible rounded-xl border bg-[#14111b] shadow-2xl ${selected ? "border-violet-300 ring-2 ring-violet-300/20" : "border-violet-400/40"}`} data-testid={`professional-operation-${operation.id}`} dir="ltr">
    {inputs.map((port, index) => <Handle key={port.id} id={port.id} type="target" position={Position.Left} style={{ top: `${Math.min(78, 28 + index * 22)}%` }} className="!h-3 !w-3 !border-2 !border-[#14111b] !bg-violet-300" />)}
    {output && <Handle id={output.id} type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-[#14111b] !bg-emerald-400" />}
    <div className="space-card-drag-handle flex h-16 cursor-grab items-center gap-2 rounded-t-xl border-b border-white/10 bg-gradient-to-r from-violet-500/25 to-fuchsia-500/5 px-3 active:cursor-grabbing"><Icon className={`h-5 w-5 ${failures.has(operation.state) ? "text-red-300" : operation.state === "SETTLED" ? "text-emerald-300" : "text-violet-200"}`} /><div className="min-w-0"><p className="truncate text-xs font-bold">{operation.recipeId}</p><p className="text-[9px] text-violet-100/65">OPERATION · {operation.state}</p></div></div>
    <div className="space-card-drag-handle cursor-grab px-3 py-2 active:cursor-grabbing"><div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Braces className="h-3.5 w-3.5" /><span>{customerFinancialLabel} · Engine-governed</span></div><div className="mt-2 space-y-1">{inputs.length ? inputs.map((port) => <div key={port.id} className="flex items-center justify-between text-[9px] font-semibold text-violet-100/80"><span>IN · {port.semantic}</span><span className="text-muted-foreground">linked</span></div>) : <p className="text-[9px] text-muted-foreground">IN · no asset binding</p>}<div className="flex items-center justify-between text-[9px] font-semibold text-emerald-100/85"><span>OUT · OUTPUT</span><span className="text-muted-foreground">{output?.connectedEntityId ? "linked" : "pending"}</span></div></div></div>
  </article>;
}

export const ProfessionalOperationNode = memo(ProfessionalOperationNodeComponent);
