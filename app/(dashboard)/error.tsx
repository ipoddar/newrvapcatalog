'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="p-4 md:p-6">
      <div className="mb-8 space-y-4">
        <h1 className="font-semibold text-lg md:text-2xl">
          Something went wrong
        </h1>
        <p className="text-gray-600">
          {error.message || 'An unexpected error occurred while loading the catalog.'}
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
