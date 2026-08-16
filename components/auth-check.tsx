'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSession } from '@/utils/cognito/client';

const AUTH_PAGES = ['/login', '/signup', '/verify-email'];

export default function AuthCheck({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAllowed, setIsAllowed] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let isMounted = true;

    const checkAuth = async () => {
      const isAuthPage = AUTH_PAGES.includes(pathname);

      try {
        const session = await getSession();
        const isAuthenticated = Boolean(session?.isValid());
        const emailVerified =
          session?.getIdToken().payload.email_verified === true ||
          session?.getIdToken().payload.email_verified === 'true';

        if (!isMounted) return;

        if (!isAuthenticated && !isAuthPage) {
          router.push('/login');
          setIsAllowed(false);
        } else if (isAuthenticated && !emailVerified && pathname !== '/verify-email') {
          router.push('/verify-email');
          setIsAllowed(false);
        } else if (isAuthenticated && emailVerified && (pathname === '/login' || pathname === '/signup')) {
          router.push('/');
          setIsAllowed(false);
        } else {
          setIsAllowed(true);
        }
      } catch (error) {
        console.error('Auth check error:', error);
        if (!isMounted) return;
        if (!isAuthPage) {
          router.push('/login');
          setIsAllowed(false);
        } else {
          setIsAllowed(true);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    checkAuth();
    return () => {
      isMounted = false;
    };
  }, [router, pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (!isAllowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600">Redirecting...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
