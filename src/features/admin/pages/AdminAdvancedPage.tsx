import { ArrowRight, ClipboardCheck, FileSearch, GitPullRequestArrow, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { getAdminApprovalInbox, getAdminAudit, getCatalogSnapshots } from "@/lib/admin-v2-client";
import { AdminErrorState, AdminLoadingState, AdminPageHeader, AdminSection, MetricCard } from "../components/AdminUi";
import { adminQueryKeys, useAdminReadQuery } from "../data/admin-queries";

export default function AdminAdvancedPage() {
  const approvals = useAdminReadQuery(adminQueryKeys.approvals, getAdminApprovalInbox);
  const audit = useAdminReadQuery(adminQueryKeys.audit, getAdminAudit);
  const snapshots = useAdminReadQuery(adminQueryKeys.snapshots, getCatalogSnapshots);
  const loading = approvals.isLoading || audit.isLoading || snapshots.isLoading;
  const failure = approvals.isError || audit.isError || snapshots.isError;
  return <div className="space-y-6"><AdminPageHeader eyebrow="ROLE-GATED" title="Advanced & Audit" description="Governance, evidence and technical control-plane details stay separate from daily administration." />{loading ? <AdminLoadingState rows={4} /> : failure ? <AdminErrorState message="Advanced audit data could not be loaded." onRetry={() => { void approvals.refetch(); void audit.refetch(); void snapshots.refetch(); }} /> : <><div className="grid gap-3 sm:grid-cols-3"><MetricCard icon={ClipboardCheck} label="Approvals" value={String(approvals.data?.length ?? 0)} note="Changes awaiting the next decision" /><MetricCard icon={FileSearch} label="Catalog snapshots" value={String(snapshots.data?.length ?? 0)} note="Versioned evidence records" /><MetricCard icon={ShieldCheck} label="Audit chain" value={audit.data?.chainValid ? "Verified" : "Check required"} note={`${audit.data?.records.length ?? 0} records`} tone={audit.data?.chainValid ? "success" : "attention"} /></div><AdminSection title="Technical workspaces" description="These are temporary engineering readers, kept outside daily Admin work."><div className="grid gap-3 p-5 md:grid-cols-2"><AdvancedLink icon={GitPullRequestArrow} title="Approval workflows" description="Change sets, independent review and release decisions." href="/admin/advanced/legacy-control-plane#governance" /><AdvancedLink icon={ShieldCheck} title="Legacy control-plane reader" description="Temporary reader for routes, snapshots, release gates and immutable evidence." href="/admin/advanced/legacy-control-plane" /></div></AdminSection></>}</div>;
}

function AdvancedLink({ icon: Icon, title, description, href }: { icon: typeof ShieldCheck; title: string; description: string; href: string }) { return <Link to={href} className="group rounded-lg border border-white/[0.08] bg-[#0b0d10] p-5 transition hover:bg-white/[0.04]"><div className="flex items-start justify-between gap-4"><Icon className="h-5 w-5 text-violet-300" /><ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-white" /></div><h2 className="mt-5 text-sm font-semibold text-white">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{description}</p></Link>; }
