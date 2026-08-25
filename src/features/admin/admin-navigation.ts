import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BadgeDollarSign,
  Boxes,
  Cable,
  ChartNoAxesCombined,
  CreditCard,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

export type AdminNavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  end?: boolean;
};

export type AdminNavigationGroup = {
  label: string;
  items: AdminNavigationItem[];
};

export const adminNavigation: AdminNavigationGroup[] = [
  {
    label: "MAIN",
    items: [{ label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard, end: true }],
  },
  {
    label: "BUSINESS",
    items: [
      { label: "Users", href: "/admin/users", icon: Users },
      { label: "Subscriptions", href: "/admin/subscriptions", icon: CreditCard },
    ],
  },
  {
    label: "AI GATEWAY",
    items: [
      { label: "Providers", href: "/admin/providers", icon: Cable },
      { label: "Models", href: "/admin/models", icon: Boxes },
      { label: "Pricing", href: "/admin/pricing", icon: BadgeDollarSign },
    ],
  },
  {
    label: "MONITORING",
    items: [
      { label: "Operations", href: "/admin/operations", icon: Activity },
      { label: "Reports", href: "/admin/reports", icon: ChartNoAxesCombined },
    ],
  },
  {
    label: "SYSTEM",
    items: [{ label: "Settings", href: "/admin/settings", icon: Settings }],
  },
];

export const advancedNavigation: AdminNavigationItem = {
  label: "Advanced & Audit",
  href: "/admin/advanced",
  icon: ShieldCheck,
};

export const adminPageTitle = (pathname: string): string => {
  for (const group of adminNavigation) {
    const found = group.items.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
    if (found) return found.label;
  }
  return pathname.startsWith("/admin/advanced") ? "Advanced & Audit" : "Admin";
};
