'use client';

import { signOut } from '@/utils/cognito/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      signOut();
      router.push('/login');
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
    >
      {isSigningOut ? 'Signing out...' : 'Sign Out'}
    </button>
  );
}
