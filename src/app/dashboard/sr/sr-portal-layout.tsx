"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  ShoppingCart,
  Users,
  Package,
  LayoutDashboard,
  TrendingUp,
} from "lucide-react";
import type { StaffMember } from "@/types";

const navItems = [
  { href: "/dashboard/sr", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/sr/orders/new", label: "New Order", icon: ShoppingCart },
  { href: "/dashboard/sr/customers", label: "Customers", icon: Users },
  { href: "/dashboard/sr/orders", label: "My Orders", icon: Package },
  { href: "/dashboard/sr/performance", label: "Performance", icon: TrendingUp },
];

export default function SrPortalLayout({
  staff,
  children,
}: {
  staff: StaffMember;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-background border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/dashboard/sr" className="flex items-center gap-2 font-bold text-lg">
            <span className="text-primary">SR Portal</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {staff.name}
            </span>
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="sticky top-14 z-40 bg-background border-b">
        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
