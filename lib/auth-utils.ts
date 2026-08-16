import { getSession } from '@/utils/cognito/client';

export async function checkUserAdmin(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;

  const claims = session.getIdToken().payload as Record<string, unknown>;
  return claims['custom:admin'] === 'true';
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;

  const claims = session.getIdToken().payload as Record<string, unknown>;
  return {
    sub: claims.sub as string,
    email: claims.email as string | undefined,
    name: claims.name as string | undefined,
    phoneNumber: claims.phone_number as string | undefined,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
  };
}
