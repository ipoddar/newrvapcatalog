import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

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

// For routes with no JWT authorizer attached (public browsing) —
// event.requestContext.authorizer is undefined there, so getClaims()
// would throw a raw TypeError. Returns an empty identity instead of
// throwing, letting callers personalize for a signed-in caller while
// still working for an anonymous one.
export function optionalAuth(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const authorizer = event.requestContext.authorizer as { jwt?: { claims: Record<string, unknown> } } | undefined;
  const claims = authorizer?.jwt?.claims ?? {};
  const sub = claims.sub as string | undefined;
  return { sub, claims };
}

export function requireAdmin(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const auth = requireAuth(event);
  if (auth.claims['custom:admin'] !== 'true') {
    throw new HttpError(403, 'Forbidden: admin only');
  }
  return auth;
}
