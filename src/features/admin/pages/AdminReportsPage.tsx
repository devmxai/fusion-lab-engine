import { BarChart3, CircleAlert, Landmark, WalletCards } from "lucide-react";
import { getAdminOverview, getCommerceAdminOverview, getDurableAdminOverview } from "@/lib/admin-v2-client";
import { AdminErrorState, AdminLoadingState, AdminPageHeader, AdminSection, MetricCard } from "../components/AdminUi";
import { adminQueryKeys, useAdminReadQuery } from "../data/admin-queries";

export default function AdminReportsPage() {
  const overview = useAdminReadQuery(adminQueryKeys.overview, getAdminOverview);
  const durable = useAdminReadQuery(adminQueryKeys.durableOverview, getDurableAdminOverview);
  const commerce = useAdminReadQuery(adminQueryKeys.commerce, getCommerceAdminOverview);
  const loading = overview.isLoading || durable.isLoading || commerce.isLoading;
  const failure = overview.isError || durable.isError || commerce.isError;
  const subscriptionCount = Object.values(commerce.data?.activity?.subscriptionsByState ?? {}).reduce((sum, count) => sum + count, 0);
  const operationCount = Object.values(durable.data?.audit?.operationCounts ?? {}).reduce((sum, count) => sum + count, 0);

  return <div className="space-y-6">
    <AdminPageHeader eyebrow="MONITORING" title="Reports" description="Verified operational and financial signals. Revenue, profit and margin remain unavailable until all required cost evidence is proven." />
    {loading ? <AdminLoadingState rows={4} /> : failure ? <AdminErrorState message="Reports could not be loaded." onRetry={() => { void overview.refetch(); void durable.refetch(); void commerce.refetch(); }} /> : <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard icon={Landmark} label="Provider balance" value={overview.data?.treasury.treasury.confirmedRemainingAtomic ?? "Unavailable"} note="Confirmed provider treasury" /><MetricCard icon={WalletCards} label="Reconciliation" value={overview.data ? `${overview.data.reconciliation.reconciliationRateBps / 100}%` : "Unavailable"} note={overview.data?.reconciliation.targetMet ? "Target met" : "Requires review"} /><MetricCard icon={BarChart3} label="Operations" value={String(operationCount)} note="Recorded durable operations" /><MetricCard icon={CircleAlert} label="Subscriptions" value={String(subscriptionCount)} note="Current commerce read model" /></div><AdminSection title="Financial reporting boundary" description="The Admin will never infer business profit from a provider published rate."><div className="grid gap-4 p-5 md:grid-cols-3"><ReportBoundary label="Customer revenue" detail="Requires settled commerce and invoice evidence." /><ReportBoundary label="Actual provider cost" detail="Requires task-bound cost evidence and reconciliation." /><ReportBoundary label="Confirmed margin" detail="Requires actual cost, funding, FX and fee inputs." /></div></AdminSection></>}
  </div>;
}

function ReportBoundary({ label, detail }: { label: string; detail: string }) { return <article className="rounded-lg border border-white/[0.08] bg-[#0b0d10] p-4"><p className="text-sm font-medium text-white">{label}</p><p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p><p className="mt-4 text-xs font-medium text-amber-200">Margin unavailable</p></article>; }
