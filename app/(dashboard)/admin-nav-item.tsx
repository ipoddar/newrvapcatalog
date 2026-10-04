'use client';

import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { checkUserAdmin } from '@/lib/auth-utils';
import { NavItem } from './nav-item';
import { MobileNavItem } from './mobile-nav-item';

// Top-level nav icon to the admin users page — rendered as null until the
// admin check resolves, so non-admins never see so much as a layout flash.
export function AdminNavItem({ variant }: { variant: 'desktop' | 'mobile' }) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkUserAdmin().then(setIsAdmin);
  }, []);

  if (!isAdmin) return null;

  const ItemComponent = variant === 'desktop' ? NavItem : MobileNavItem;

  return (
    <ItemComponent href="/admin/users" label="Manage Users">
      <Shield className="h-5 w-5" />
    </ItemComponent>
  );
}
