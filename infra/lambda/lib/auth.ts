import type { APIGatewayProxyEventV2, APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

function getClaims(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  return event.requestContext.authorizer.jwt.claims;
}

export function requireAuth(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) {
    throw new HttpError(401, 'Unauthorized');
  }
  return { sub, claims };
}

// GET /catalog has no API Gateway authorizer attached at all (that's what
// makes it public) — event.requestContext.authorizer is always undefined
// here, regardless of whether the caller sent a valid bearer token. So
// personalizing the response for a signed-in caller means verifying the
// token by hand instead of trusting an authorizer context that API Gateway
// never populates for this route.
const idTokenVerifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID!,
  tokenUse: 'id',
  clientId: process.env.USER_POOL_CLIENT_ID!,
});

export async function optionalAuth(event: APIGatewayProxyEventV2) {
  const header = event.headers?.authorization ?? event.headers?.Authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) {
    return { sub: undefined, claims: {} as Record<string, unknown> };
  }

  try {
    const claims = await idTokenVerifier.verify(token);
    return { sub: claims.sub, claims: claims as unknown as Record<string, unknown> };
  } catch {
    // An expired/invalid token on a public route degrades to anonymous
    // rather than failing the request — the caller still gets the catalog.
    return { sub: undefined, claims: {} as Record<string, unknown> };
  }
}

export function requireAdmin(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const auth = requireAuth(event);
  if (auth.claims['custom:admin'] !== 'true') {
    throw new HttpError(403, 'Forbidden: admin only');
  }
  return auth;
}
