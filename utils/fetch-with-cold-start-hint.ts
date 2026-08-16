// A cold Lambda invocation can't be detected before the response arrives,
// so this uses the standard heuristic: if the request is still pending
// after SLOW_THRESHOLD_MS, assume it might be a cold start and let the
// caller flip its UI to a "still working" message. The `X-Lambda-Warm`
// response header (set by infra/lambda/lib/warmer.ts) confirms after the
// fact whether it really was one, for callers that want to log/report it.
const SLOW_THRESHOLD_MS = 400;

export interface ColdStartFetchResult<T> {
  data: T;
  wasCold: boolean;
}

export function fetchWithColdStartHint<T>(
  url: string,
  init: RequestInit,
  onSlow: () => void
): Promise<ColdStartFetchResult<T>> {
  const timer = setTimeout(onSlow, SLOW_THRESHOLD_MS);

  return fetch(url, init)
    .then(async (response) => {
      clearTimeout(timer);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error ?? `Request failed with ${response.status}`);
      }
      return {
        data: body as T,
        wasCold: response.headers.get('X-Lambda-Warm') === 'false',
      };
    })
    .catch((err) => {
      clearTimeout(timer);
      throw err;
    });
}
