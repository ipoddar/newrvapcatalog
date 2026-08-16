import { getSession } from '@/utils/cognito/client';

function getApiUrl() {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_API_URL environment variable');
  }
  return url;
}

export async function authedRequestInit(init: RequestInit = {}): Promise<RequestInit> {
  const session = await getSession();
  const idToken = session?.getIdToken().getJwtToken();

  return {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...init.headers,
    },
  };
}

export function apiUrl(path: string) {
  return `${getApiUrl()}${path}`;
}
