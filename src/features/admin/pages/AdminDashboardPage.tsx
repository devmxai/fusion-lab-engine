import { Activity, CircleAlert, CreditCard, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { getAdminOverview, getDurableOperationExceptions, getDurableOperations, getDurableOwners, getDurableAdminOverview } from "@/lib/admin-v2-client";
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminPageHeader, AdminSection, MetricCard, StatusBadge, TableFrame, formatAdminDate } from "../components/AdminUi";
import { adminQueryKeys, useAdminReadQuery } from "../data/admin-queries";

export default function AdminDashboardPage() {
  const overview = useAdminReadQuery(adminQueryKeys.overview, getAdminOverview);
  const durable = useAdminReadQuery(adminQueryKeys.durableOverview, getDurableAdminOverview);
  const operations = useAdminReadQuery(adminQueryKeys.operations, () => getDurableOperations(8));
  const exceptions = useAdminReadQuery(adminQueryKeys.exceptions, () => getDurableOperationExceptions(8));
  const owners = useAdminReadQuery(adminQueryKeys.owners, () => getDurableOwners(1));
  const isLoading = overview.isLoading || durable.isLoading || operations.isLoading || exceptions.isLoading || owners.isLoading;

  return <div className="space-y-6">
    <AdminPageHeader eyebrow="PLATFORM OVERVIEW" title="Dashboard" description="A concise view of platform health, financial attention and recent activity." />
    {isLoading ? <AdminLoadingState rows={4} /> : null}
    {overview.isError ? <AdminErrorState message="The platform overview is temporarily unavailable." onRetry={() => void overview.refetch()} /> : null}
    {overview.data ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Activity} label="Operations" value={String(Object.values(durable.data?.audit?.operationCounts ?? {}).reduce((sum, count) => sum + count, 0))} note="Recorded by the durable engine" />
        <MetricCard icon={CircleAlert} label="Needs attention" value={String(exceptions.data?.length ?? 0)} note={exceptions.data?.length ? "Open exceptions require review" : "No open exceptions"} tone={exceptions.data?.length ? "attention" : "success"} />
        <MetricCard icon={WalletCards} label="Provider balance" value={overview.data.treasury.treasury.confirmedRemainingAtomic} note={overview.data.treasury.treasury.state === "UNCONFIGURED" ? "No active provider account" : "Verified provider treasury"} />
        <MetricCard icon={CreditCard} label="Customer wallets" value={String(owners.data?.length ?? 0)} note="Finance identities in the current view" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <AdminSection title="Recent operations" description="The latest durable generation records.">
          {operations.isError ? <AdminErrorState message="Recent operations could not be loaded." onRetry={() => void operations.refetch()} /> : operations.data?.length ? <TableFrame><thead className="border-b border-white/[0.08] bg-white/[0.025] text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-medium">Operation</th><th className="py-3 font-medium">State</th><th className="py-3 font-medium">Customer charge</th><th className="px-5 py-3 font-medium">Updated</th></tr></thead><tbody>{operations.data.map((operation) => <tr key={operation.operationId} className="border-b border-white/[0.06] last:border-0"><td className="max-w-52 px-5 py-3"><Link className="block truncate font-medium text-violet-200 hover:text-violet-100" to={`/admin/operations/${encodeURIComponent(operation.operationId)}`}>{operation.operationId}</Link><span className="mt-0.5 block truncate text-xs text-slate-500">{operation.providerId ?? "Provider pending"}</span></td><td className="py-3"><StatusBadge status={operation.state} /></td><td className="py-3 text-sm text-slate-300">{operation.customerCredits} credits</td><td className="px-5 py-3 text-xs text-slate-500">{formatAdminDate(operation.updatedAt)}</td></tr>)}</tbody></TableFrame> : <AdminEmptyState title="No operations yet" description="Generation activity will appear here once the durable runtime records it." />}
        </AdminSection>
        <AdminSection title="Action center" description="Only items requiring an administrator decision.">
          {exceptions.isError ? <AdminErrorState message="Exceptions could not be loaded." onRetry={() => void exceptions.refetch()} /> : exceptions.data?.length ? <div className="divide-y divide-white/[0.06]">{exceptions.data.map((exception) => <Link key={`${exception.category}:${exception.operationId}`} to={`/admin/operations/${encodeURIComponent(exception.operationId)}`} className="block px-5 py-4 transition hover:bg-white/[0.025]"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-white">{exception.category.replace(/_/g, " ")}</span><StatusBadge status="RECONCILIATION_REQUIRED" /></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">{exception.reason}</p><p className="mt-2 text-[11px] text-slate-500">{formatAdminDate(exception.updatedAt)}</p></Link>)}</div> : <AdminEmptyState title="Nothing needs attention" description="No durable Production exceptions are pending." />}
        </AdminSection>
      </div>
    </> : null}
  </div>;
}
