import Link from 'next/link';
import {
  BookMarked,
  LineChart,
  Package,
  Package2,
  Settings,
  ShoppingCart,
  SquareLibrary,
  Users2
} from 'lucide-react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { User } from './user';
import { VercelLogo } from '@/components/icons';
import Providers from './providers';
import { NavItem } from './nav-item';
import { MobileNavItem } from './mobile-nav-item';
import { AdminNavItem } from './admin-nav-item';
import { SearchInput } from './search';

export default function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <main className="flex min-h-screen w-full flex-col bg-muted/40">
        <DesktopNav />
        <div className="flex flex-col sm:gap-4 sm:py-4 sm:pl-14">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-[#e5e7eb] bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
            <MobileNav />
            <DashboardBreadcrumb />
            </header>
          <main className="grid flex-1 items-start gap-2 p-4 sm:px-6 sm:py-0 md:gap-4 bg-muted/40">
            {children}
          </main>
        </div>
      </main>
    </Providers>
  );
}

export function DesktopNav() {
  return (
    <aside className="fixed inset-y-0 left-0 z-100 hidden w-14 flex-col border-r bg-background sm:flex">
      <nav className="flex flex-col items-center gap-4 px-2 sm:py-5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/home"
              className="bg-white group flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-full bg-primary text-lg font-semibold text-primary-foreground md:h-8 md:w-8 md:text-base"
            >
              <img src='/logo.svg' alt="RVAP" />
              <span className="sr-only">Home</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Home</TooltipContent>
        </Tooltip>

        <NavItem href="/" label="Catalog">
          <SquareLibrary className="h-5 w-5" />
        </NavItem>

        <NavItem href="/my-checkouts" label="My Checkouts">
          <BookMarked className="h-5 w-5" />
        </NavItem>

        <AdminNavItem variant="desktop" />

        <User />
      </nav>
      <nav className="mt-auto flex flex-col items-center gap-4 px-2 sm:py-5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="#"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground md:h-8 md:w-8"
            >
              <Settings className="h-5 w-5" />
              <span className="sr-only">Settings</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </nav>
    </aside>
  );
}

export function MobileNav() {
  return (
    <nav className="flex items-center gap-2 sm:hidden">
      <Link
        href="/home"
        className="bg-white group flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-full bg-primary text-lg font-semibold text-primary-foreground"
      >
        <img src='/logo.svg' alt="RVAP" />
        <span className="sr-only">Home</span>
      </Link>

      <MobileNavItem href="/" label="Catalog">
        <SquareLibrary className="h-5 w-5" />
      </MobileNavItem>

      <MobileNavItem href="/my-checkouts" label="My Checkouts">
        <BookMarked className="h-5 w-5" />
      </MobileNavItem>

      <AdminNavItem variant="mobile" />

      <User />
    </nav>
  );
}

export function DashboardBreadcrumb() {
  return (
    <Breadcrumb className="hidden md:flex">
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
          </BreadcrumbLink>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
