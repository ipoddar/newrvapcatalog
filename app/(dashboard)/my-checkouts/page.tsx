'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { BookOpen } from 'lucide-react';
import { apiUrl, authedRequestInit } from '@/utils/api-client';
import { ReturnIcon } from '@/components/icons';
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
  const [returningId, setReturningId] = useState<string | null>(null);

  const loadCheckouts = useCallback(async () => {
    const init = await authedRequestInit();
    const response = await fetch(apiUrl('/catalog'), init);
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.error ?? 'Failed to load your checkouts');
    }
    const catalog = (body.data ?? []) as CatalogItem[];
    setCheckouts(catalog.filter((item) => item.checkedOutByCurrentUser));
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        await loadCheckouts();
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
  }, [loadCheckouts]);

  const handleReturn = async (bookId: string) => {
    setReturningId(bookId);
    try {
      const init = await authedRequestInit({ method: 'POST' });
      const response = await fetch(apiUrl(`/catalog/${encodeURIComponent(bookId)}/return`), init);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to return book');
      }
      await loadCheckouts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to return book');
    } finally {
      setReturningId(null);
    }
  };

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
            const details = item.checkoutDetails;
            const iso = details?.checkedOutAtIso;
            return (
              <Card key={item.id}>
                <CardContent className="p-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold text-gray-900">{item.title}</div>
                    <div className="text-sm text-gray-500">
                      {item.category} · {Array.isArray(item.language) ? item.language.join(', ') : item.language}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {iso ? `Checked out ${formatDaysAgo(daysAgo(iso))}` : '—'}
                      {details?.lastReminderSentAt && (
                        <> · last reminder {new Date(details.lastReminderSentAt).toLocaleDateString()}</>
                      )}
                    </div>
                  </div>
                  <div
                    title="Return this book"
                    onClick={() => !returningId && handleReturn(item.id)}
                    className={`p-2 border-[#6b7280] border rounded flex justify-center items-center transition duration-300 cursor-pointer shrink-0 ${
                      returningId === item.id ? 'opacity-50' : 'hover:bg-blue-500'
                    }`}
                  >
                    <ReturnIcon height={16} color="#6b7280" />
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
