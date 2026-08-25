import { Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { getAdminCapabilities } from "@/lib/admin-v2-client";
import { cn } from "@/lib/utils";
import { adminNavigation, adminPageTitle, advancedNavigation } from "./admin-navigation";
import { adminQueryKeys, useAdminReadQuery } from "./data/admin-queries";

function AdminNav({ collapsed, closeMobile }: { collapsed?: boolean; closeMobile?: () => void }) {
  return <nav className="space-y-5" aria-label="Admin navigation">
    {adminNavigation.map((group) => <div key={group.label}>
      {!collapsed ? <p className="mb-1 px-3 text-[10px] font-semibold tracking-[0.14em] text-slate-500">{group.label}</p> : null}
      <div className="space-y-1">{group.items.map(({ href, label, icon: Icon, end }) => <NavLink key={href} to={href} end={end} onClick={closeMobile} title={collapsed ? label : undefined} className={({ isActive }) => cn("flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors", isActive ? "bg-violet-500/15 text-violet-100" : "text-slate-400 hover:bg-white/[0.05] hover:text-white", collapsed && "justify-center px-2")}><Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />{!collapsed ? <span>{label}</span> : null}</NavLink>)}</div>
    </div>)}
  </nav>;
}

function AdvancedLink({ collapsed, closeMobile }: { collapsed?: boolean; closeMobile?: () => void }) {
  const { href, label, icon: Icon } = advancedNavigation;
  return <NavLink to={href} onClick={closeMobile} title={collapsed ? label : undefined} className={({ isActive }) => cn("flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors", isActive ? "bg-violet-500/15 text-violet-100" : "text-slate-400 hover:bg-white/[0.05] hover:text-white", collapsed && "justify-center px-2")}><Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />{!collapsed ? <span>{label}</span> : null}</NavLink>;
}

function SidebarContent({ collapsed, onToggle, closeMobile }: { collapsed?: boolean; onToggle?: () => void; closeMobile?: () => void }) {
  return <div className="flex h-full flex-col bg-[#0e1116] p-3">
    <div className={cn("flex h-12 items-center gap-3 px-2", collapsed && "justify-center px-0")}>
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500 text-white"><ShieldCheck className="h-4 w-4" aria-hidden="true" /></div>
      {!collapsed ? <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">FusionLab</p><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">Admin</p></div> : null}
    </div>
    <div className="mt-7 flex-1 overflow-y-auto"><AdminNav collapsed={collapsed} closeMobile={closeMobile} /></div>
    <div className="mt-4 border-t border-white/[0.08] pt-3"><AdvancedLink collapsed={collapsed} closeMobile={closeMobile} />{onToggle ? <button type="button" onClick={onToggle} title={collapsed ? "Expand navigation" : "Collapse navigation"} className={cn("mt-2 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-slate-500 transition hover:bg-white/[0.05] hover:text-white", collapsed && "justify-center px-2")}>{collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <><PanelLeftClose className="h-[18px] w-[18px]" /><span>Collapse</span></>}</button> : null}</div>
  </div>;
}

export default function AdminShell() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const capabilities = useAdminReadQuery(adminQueryKeys.capabilities, getAdminCapabilities);
  const title = adminPageTitle(location.pathname);
  const primaryRole = capabilities.data?.session.roles.includes("SUPER_ADMIN") ? "Super Admin" : capabilities.data?.session.roles[0]?.replace(/_/g, " ") ?? "Checking";

  const accessDenied = !import.meta.env.DEV && (capabilities.isError || (capabilities.data && !capabilities.data.permissions.read));
  if (accessDenied) {
    const message = capabilities.error instanceof Error ? capabilities.error.message : "Admin read permission is required.";
    return <main className="grid min-h-screen place-items-center bg-[#0b0d10] p-6 text-center" lang="en"><div className="max-w-md rounded-xl border border-white/[0.08] bg-[#12161b] p-7"><ShieldCheck className="mx-auto h-7 w-7 text-violet-300" /><h1 className="mt-4 text-lg font-semibold text-white">Admin access denied</h1><p className="mt-2 text-sm leading-6 text-slate-400">{message}</p><Button type="button" variant="outline" className="mt-5" onClick={() => void signOut()}>Sign out</Button></div></main>;
  }

  return <div className="min-h-screen bg-[#0b0d10] text-slate-100" lang="en" dir="ltr">
    <aside className={cn("fixed inset-y-0 left-0 z-30 hidden border-r border-white/[0.08] transition-[width] duration-150 lg:block", collapsed ? "w-[72px]" : "w-60")}><SidebarContent collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} /></aside>
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent side="left" className="w-[280px] border-white/[0.08] bg-[#0e1116] p-0"><SidebarContent closeMobile={() => setMobileOpen(false)} /></SheetContent></Sheet>
    <div className={cn("min-h-screen transition-[padding] duration-150", collapsed ? "lg:pl-[72px]" : "lg:pl-60")}>
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/[0.08] bg-[#0b0d10]/90 px-4 backdrop-blur lg:px-7">
        <div className="flex items-center gap-3"><Button type="button" size="icon" variant="ghost" className="text-slate-300 hover:bg-white/[0.06] hover:text-white lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></Button><div><p className="text-sm font-semibold text-white">{title}</p><p className="text-[11px] text-slate-500">FusionLab Admin</p></div></div>
        <div className="flex min-w-0 items-center gap-3"><div className="hidden min-w-0 text-right sm:block"><p className="truncate text-xs font-medium text-white">{user?.email ?? "Administrator"}</p><p className="text-[10px] text-slate-500">{primaryRole}</p></div><span className="inline-flex items-center rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[11px] font-medium text-violet-200">{import.meta.env.DEV ? "Development" : capabilities.data ? `${primaryRole} · Production · AAL${capabilities.data.session.assuranceLevel}` : "Production · Checking"}</span></div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8"><Outlet /></main>
    </div>
  </div>;
}
