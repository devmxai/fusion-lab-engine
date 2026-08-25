import type { LucideIcon } from "lucide-react";
import { AlertCircle, CheckCircle2, Clock3, CircleDashed, Inbox, RefreshCw, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-white/[0.08] pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-violet-300">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-white">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function AdminSection({ title, description, children, className }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-white/[0.08] bg-[#12161b]", className)}>
      {title ? (
        <header className="border-b border-white/[0.08] px-5 py-4">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {description ? <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function MetricCard({ icon: Icon, label, value, note, tone = "default" }: { icon: LucideIcon; label: string; value: string; note: string; tone?: "default" | "attention" | "success" }) {
  const tones = {
    default: "border-white/[0.08]",
    attention: "border-amber-400/30",
    success: "border-emerald-400/25",
  };
  return (
    <article className={cn("rounded-xl border bg-[#12161b] p-4", tones[tone])}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <Icon className="h-4 w-4 text-violet-300" aria-hidden="true" />
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-white">{value}</p>
      <p className="mt-1 min-h-5 text-xs text-slate-500">{note}</p>
    </article>
  );
}

const statusTokens: Record<string, { label: string; className: string; icon: LucideIcon }> = {
  ACTIVE: { label: "Active", className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200", icon: CheckCircle2 },
  PUBLISHED: { label: "Published", className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200", icon: CheckCircle2 },
  CONFIGURED: { label: "Configured", className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200", icon: CheckCircle2 },
  SUCCEEDED: { label: "Succeeded", className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200", icon: CheckCircle2 },
  CONNECTED: { label: "Connected", className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200", icon: CheckCircle2 },
  APPROVED: { label: "Approved", className: "border-sky-400/25 bg-sky-400/10 text-sky-200", icon: CheckCircle2 },
  IN_REVIEW: { label: "In review", className: "border-sky-400/25 bg-sky-400/10 text-sky-200", icon: Clock3 },
  VALIDATED: { label: "Validated", className: "border-sky-400/25 bg-sky-400/10 text-sky-200", icon: CheckCircle2 },
  SIMULATED: { label: "Simulated", className: "border-sky-400/25 bg-sky-400/10 text-sky-200", icon: CircleDashed },
  PROCESSING: { label: "Processing", className: "border-violet-400/25 bg-violet-400/10 text-violet-200", icon: CircleDashed },
  PENDING: { label: "Pending", className: "border-amber-400/25 bg-amber-400/10 text-amber-100", icon: Clock3 },
  REFERENCE: { label: "Reference", className: "border-slate-400/20 bg-slate-400/10 text-slate-300", icon: CircleDashed },
  CATALOG_NOT_IMPORTED: { label: "Catalog needed", className: "border-amber-400/25 bg-amber-400/10 text-amber-100", icon: Clock3 },
  CATALOG_IMPORTED: { label: "Catalog imported", className: "border-sky-400/25 bg-sky-400/10 text-sky-200", icon: CheckCircle2 },
  FAILED: { label: "Failed", className: "border-rose-400/25 bg-rose-400/10 text-rose-200", icon: AlertCircle },
  BANNED: { label: "Banned", className: "border-rose-400/25 bg-rose-400/10 text-rose-200", icon: ShieldAlert },
  CANCELLED: { label: "Cancelled", className: "border-slate-400/20 bg-slate-400/10 text-slate-300", icon: CircleDashed },
  EXPIRED: { label: "Expired", className: "border-slate-400/20 bg-slate-400/10 text-slate-300", icon: Clock3 },
  ISSUED: { label: "Issued", className: "border-sky-400/25 bg-sky-400/10 text-sky-200", icon: CheckCircle2 },
  REDEEMED: { label: "Redeemed", className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200", icon: CheckCircle2 },
  REVOKED: { label: "Revoked", className: "border-rose-400/25 bg-rose-400/10 text-rose-200", icon: ShieldAlert },
  RECONCILIATION_REQUIRED: { label: "Needs review", className: "border-amber-400/25 bg-amber-400/10 text-amber-100", icon: ShieldAlert },
  BLOCKED_LOCAL: { label: "Not available", className: "border-slate-400/20 bg-slate-400/10 text-slate-300", icon: ShieldAlert },
};

export function StatusBadge({ status, fallback }: { status: string; fallback?: string }) {
  const token = statusTokens[status] ?? { label: fallback ?? toTitle(status), className: "border-slate-400/20 bg-slate-400/10 text-slate-300", icon: CircleDashed };
  const Icon = token.icon;
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium", token.className)}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{token.label}</span>;
}

export function AdminLoadingState({ rows = 5 }: { rows?: number }) {
  return <div className="space-y-3 p-5">{Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-12 w-full bg-white/[0.06]" />)}</div>;
}

export function AdminEmptyState({ title, description, icon: Icon = Inbox }: { title: string; description: string; icon?: LucideIcon }) {
  return <div className="grid min-h-52 place-items-center p-6 text-center"><div className="max-w-sm"><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03]"><Icon className="h-5 w-5 text-slate-400" aria-hidden="true" /></div><h3 className="mt-4 text-sm font-semibold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-400">{description}</p></div></div>;
}

export function AdminErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="flex min-h-52 flex-col items-center justify-center p-6 text-center"><AlertCircle className="h-6 w-6 text-rose-300" aria-hidden="true" /><h3 className="mt-3 text-sm font-semibold text-white">Could not load this section</h3><p className="mt-2 max-w-md text-sm text-slate-400">{message}</p><Button type="button" variant="outline" size="sm" className="mt-4 border-white/[0.12] bg-transparent text-white hover:bg-white/[0.06]" onClick={onRetry}><RefreshCw className="h-4 w-4" />Retry</Button></div>;
}

export function TableFrame({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm">{children}</table></div>;
}

export const formatAdminDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";

export const toTitle = (value: string) => value.toLowerCase().split("_").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
