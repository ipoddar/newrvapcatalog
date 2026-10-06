'use client';

import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import { isLoggedIn } from '@/utils/cognito/client';
import { NavItem } from './nav-item';
import { MobileNavItem } from './mobile-nav-item';

// Top-level nav icon linking to /login — shown only while browsing
// anonymously, since the catalog itself is public now and User() renders
// nothing until a session exists. Defaults to hidden until the check
// resolves, so a signed-in visitor never sees it flash.
export function SignInNavItem({ variant }: { variant: 'desktop' | 'mobile' }) {
  const [loggedIn, setLoggedIn] = useState(true);

  useEffect(() => {
    isLoggedIn().then(setLoggedIn);
  }, []);

  if (loggedIn) return null;

  const ItemComponent = variant === 'desktop' ? NavItem : MobileNavItem;

  return (
    <ItemComponent href="/login" label="Sign in">
      <LogIn className="h-5 w-5" />
    </ItemComponent>
  );
}
