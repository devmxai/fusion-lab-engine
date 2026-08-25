import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CheckCircle2, Clock3, Loader2, TriangleAlert } from "lucide-react";
import type { SpaceOperationFlowNode } from "./xyflow-adapter";

const terminalFailure = new Set(["PROVIDER_FAILED", "DELIVERY_FAILED", "RECONCILIATION_REQUIRED"]);

function stateLabel(state: string) {
  if (state === "RESERVED") return "جاري التجهيز";
  if (state === "QUEUED" || state === "DISPATCHING") return "في قائمة الانتظار";
  if (state === "SUBMISSION_UNKNOWN") return "جاري التحقق من الإرسال";
  if (state === "SUBMITTED" || state === "RUNNING") return "جاري التوليد";
  if (state === "PROVIDER_SUCCEEDED" || state === "ASSET_STORED" || state === "DELIVERED") return "جاري حفظ النتيجة";
  if (state === "SETTLED") return "النتيجة جاهزة";
  if (terminalFailure.has(state)) return "تحتاج مراجعة";
  return state;
}

function SpaceOperationNodeComponent({ data, selected }: NodeProps<SpaceOperationFlowNode>) {
  const operation = data.operation;
  const failed = terminalFailure.has(operation.state);
  const ready = operation.state === "SETTLED";
  const customerFinancialLabel = operation.state === "SETTLED"
    ? `تم الخصم · ${operation.customerChargedCredits ?? operation.customerCredits} كريديت`
    : operation.state === "PROVIDER_FAILED" || operation.state === "DELIVERY_FAILED"
      ? `تم الاسترداد · ${operation.customerChargedCredits ?? 0} كريديت`
      : operation.state === "RECONCILIATION_REQUIRED"
        ? `مراجعة مالية · ${operation.customerCredits} محجوز`
        : `محجوز · ${operation.customerCredits} كريديت`;
  const Icon = ready ? CheckCircle2 : failed ? TriangleAlert : operation.state === "RESERVED" ? Clock3 : Loader2;
  return (
    <article className={`h-[176px] w-[248px] overflow-hidden rounded-2xl border bg-[#111318] shadow-2xl ${selected ? "border-primary ring-2 ring-primary/20" : failed ? "border-destructive/40" : "border-violet-400/25"}`} dir="rtl" data-testid={`space-operation-${operation.id}`}>
      <Handle id="input" type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-[#111318] !bg-violet-400" />
      <Handle id="output" type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-[#111318] !bg-emerald-400" />
      <div className="space-card-drag-handle relative flex h-[112px] cursor-grab flex-col items-center justify-center gap-2 overflow-hidden bg-gradient-to-br from-violet-500/20 via-fuchsia-500/5 to-transparent active:cursor-grabbing">
        {!ready && !failed && <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/[.04] to-transparent" />}
        <Icon className={`relative h-8 w-8 ${ready ? "text-emerald-400" : failed ? "text-destructive" : "text-violet-300"} ${!ready && !failed && operation.state !== "RESERVED" ? "animate-spin" : ""}`} />
        <p className="relative text-xs font-bold">{stateLabel(operation.state)}</p>
        <span className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[9px] font-semibold text-white/70">عملية</span>
      </div>
      <div className="px-3 py-2.5"><p className="truncate text-xs font-bold">{operation.recipeId}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{operation.modelId} · {customerFinancialLabel}</p></div>
    </article>
  );
}

export const SpaceOperationNode = memo(SpaceOperationNodeComponent);
