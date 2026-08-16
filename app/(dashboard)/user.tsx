'use client';

import { Button } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/auth-utils';
import { checkUserAdmin } from '@/lib/auth-utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useEffect, useState } from 'react';
import SignOutButton from '@/components/sign-out-button';

interface CurrentUser {
  email?: string;
  phoneNumber?: string;
}

export function User() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => setUser(u));
    checkUserAdmin().then(setIsAdmin);
  }, []);

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={`overflow-hidden rounded-full relative ${isAdmin ? 'ring-2 ring-green-500' : ''}`}
        >
          <div className="w-9 h-9 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">
            {user.email?.charAt(0).toUpperCase() || 'U'}
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">My Account</p>
            <p className="text-xs leading-none text-muted-foreground">
              {user.email}
            </p>
            {user.phoneNumber && (
              <p className="text-xs leading-none text-muted-foreground">
                {user.phoneNumber}
              </p>
            )}
            <div className="flex items-center gap-1 mt-1">
              {isAdmin ? (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                  Admin
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                  User
                </span>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <SignOutButton />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
