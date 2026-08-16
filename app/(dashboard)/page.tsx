'use client';

import { useEffect, useState } from 'react';
import ProductsPageClient from './products-page-client';
import { checkUserAdmin } from '@/lib/auth-utils';
import { apiUrl, authedRequestInit } from '@/utils/api-client';

export interface CatalogItem {
  id: string;
  number: number;
  title: string;
  category: string;
  language: string[];
  pubyear: number | null;
  firstname: string;
  lastname: string;
  editedTranslated: string[] | null;
  isCheckedOut: boolean;
  checkedOutByCurrentUser: boolean;
  checkoutDetails: {
    userDisplay: string;
    userEmail: string;
    userPhone: string;
    checkedOutDate: string;
  } | null;
}

export default function ProductsPage() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const [init, admin] = await Promise.all([
          authedRequestInit(),
          checkUserAdmin(),
        ]);
        const response = await fetch(apiUrl('/catalog'), init);
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body?.error ?? 'Failed to load catalog');
        }
        if (!isMounted) return;
        setCatalog(body.data ?? []);
        setIsAdmin(admin);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load catalog');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading catalog...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-24 text-red-600">
        Failed to load catalog: {error}
      </div>
    );
  }

  return <ProductsPageClient catalog={catalog} isAdmin={isAdmin} />;
}
