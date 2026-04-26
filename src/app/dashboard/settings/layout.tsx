
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Settings,
  Store,
  LayoutGrid,
  Plug,
  Truck,
  MessageSquare,
  Mail,
  BellRing,
  Radar,
  FileSearch,
  Warehouse,
  ClipboardList,
  Palette,
  BookUser,
  LayoutDashboard,
  Award,
  Database,
  GitBranch,
  Clock,
  CalendarMinus,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from '@/hooks/use-mobile';
import React from 'react';

const settingsNav = [
  { href: '/dashboard/settings', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/settings/general', label: 'General', icon: Settings },
  { href: '/dashboard/settings/badges', label: 'Badges', icon: Award },
  { href: '/dashboard/settings/branding', label: 'Branding', icon: Palette },
  { href: '/dashboard/settings/business', label: 'Business', icon: Store },
  { href: '/dashboard/settings/categories', label: 'Categories', icon: LayoutGrid },
  { href: '/dashboard/settings/branches', label: 'Branches', icon: GitBranch },
  { href: '/dashboard/settings/locations', label: 'Locations', icon: Warehouse },
  { href: '/dashboard/settings/showrooms', label: 'Showrooms', icon: Store },
  { href: '/dashboard/settings/notifications', label: 'Notifications', icon: BellRing },
  { href: '/dashboard/settings/accounting', label: 'Accounting', icon: BookUser },
  { href: '/dashboard/settings/integrations', label: 'WooCommerce', icon: Plug },
  { href: '/dashboard/settings/courier', label: 'Courier', icon: Truck },
  { href: '/dashboard/settings/delivery-score', label: 'Delivery Score', icon: Radar },
  { href: '/dashboard/settings/gateways/sms', label: 'SMS Gateway', icon: MessageSquare },
  { href: '/dashboard/settings/gateways/smtp', label: 'SMTP', icon: Mail },
  { href: '/dashboard/settings/backups', label: 'Backups', icon: Database },
  { href: '/dashboard/settings/shifts', label: 'Shifts', icon: Clock },
  { href: '/dashboard/settings/leave-types', label: 'Leave Types', icon: CalendarMinus },
];

const menuVisibility: Record<string, boolean> = {
  'Dashboard': true,
  'General': false,
  'Badges': true,
  'Branding': false,
  'Business': true,
  'Categories': true,
  'Branches': true,
  'Locations': true,
  'Showrooms': true,
  'Notifications': true,
  'Accounting': true,
  'WooCommerce': true,
  'Courier': true,
  'Delivery Score': true,
  'SMS Gateway': true,
  'SMTP': true,
  'Backups': true,
  'Shifts': true,
  'Leave Types': true,
};

function DesktopNav() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:block lg:w-1/5">
      <nav className="flex flex-col space-y-1">
        {settingsNav
          .filter(nav => menuVisibility[nav.label] !== false)
          .map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                buttonVariants({ variant: 'ghost' }),
                pathname.startsWith(href) && href !== '/dashboard/settings' && 'bg-muted hover:bg-muted',
                pathname === href && 'bg-muted hover:bg-muted',
                'justify-start'
              )}
            >
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </Link>
          ))}
      </nav>
    </aside>
  )
}

function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isClient, setIsClient] = React.useState(false);

  React.useEffect(() => {
    setIsClient(true);
  }, []);

  const handleValueChange = (value: string) => {
    router.push(value);
  };

  const currentNavItem = settingsNav.find(nav => nav.href === pathname);
  const visibleNavItems = settingsNav.filter(nav => menuVisibility[nav.label] !== false);

  if (!isClient) {
    return null; // Or a skeleton loader
  }

  return (
    <div className="lg:hidden mb-6">
      <Select value={pathname} onValueChange={handleValueChange}>
        <SelectTrigger>
          <SelectValue asChild>
            <div className="flex items-center gap-2">
              {currentNavItem?.icon && <currentNavItem.icon className="h-4 w-4" />}
              <span>{currentNavItem?.label || 'Select Setting'}</span>
            </div>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {visibleNavItems.map(({ href, label, icon: Icon }) => (
            <SelectItem key={href} value={href}>
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4" />
                {label}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}


export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  return (
    <div className="flex min-h-[calc(100vh_-_3.5rem)] flex-col">
      <div className="flex flex-col p-4 lg:flex-row lg:space-x-12 lg:p-6">
        <DesktopNav />
        <div className="w-full">
          <MobileNav />
          <div className="flex-1 lg:max-w-4xl">{children}</div>
        </div>
      </div>
    </div>
  );
}
