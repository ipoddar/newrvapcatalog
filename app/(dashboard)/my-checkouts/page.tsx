'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { BookOpen } from 'lucide-react';
import { apiUrl, authedRequestInit } from '@/utils/api-client';
import type { CatalogItem } from '../page';

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));
}

function formatDaysAgo(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export default function MyCheckoutsPage() {
  const [checkouts, setCheckouts] = useState<CatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const init = await authedRequestInit();
        const response = await fetch(apiUrl('/catalog'), init);
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body?.error ?? 'Failed to load your checkouts');
        }
        if (!isMounted) return;
        const catalog = (body.data ?? []) as CatalogItem[];
        setCheckouts(catalog.filter((item) => item.checkedOutByCurrentUser));
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load your checkouts');
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
          <p className="mt-4 text-gray-600">Loading your checkouts...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-24 text-red-600">
        Failed to load your checkouts: {error}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto w-full">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">My Checkouts</h1>
      <p className="text-sm text-gray-600 mb-6">Books you currently have checked out.</p>

      {checkouts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            <BookOpen className="h-8 w-8 mx-auto mb-2 text-gray-400" />
            You don't have any books checked out right now.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {checkouts.map((item) => {
            const iso = item.checkoutDetails?.checkedOutAtIso;
            return (
              <Card key={item.id}>
                <CardContent className="p-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold text-gray-900">{item.title}</div>
                    <div className="text-sm text-gray-500">
                      {item.category} · {Array.isArray(item.language) ? item.language.join(', ') : item.language}
                    </div>
                  </div>
                  <div className="text-sm text-gray-600 whitespace-nowrap">
                    {iso ? `Checked out ${formatDaysAgo(daysAgo(iso))}` : '—'}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
