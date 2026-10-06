import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { requireAdmin, HttpError } from './lib/auth';
import { handle, json } from './lib/http';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

// A hardcoded floor beneath the normal admin-managed permissions — this
// account must stay reachable even if every other admin is disabled by
// mistake, so it's protected independent of its custom:admin attribute.
const PROTECTED_EMAIL = 'ipoddar@hotmail.com';

interface SetEnabledBody {
  enabled: boolean;
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  return handle(async () => {
    requireAdmin(event);

    const email = event.pathParameters?.email ? decodeURIComponent(event.pathParameters.email) : undefined;
    if (!email) {
      throw new HttpError(400, 'Email is required');
    }
    if (!event.body) {
      throw new HttpError(400, 'Request body is required');
    }
    const body = JSON.parse(event.body) as SetEnabledBody;
    if (typeof body.enabled !== 'boolean') {
      throw new HttpError(400, 'enabled must be a boolean');
    }

    if (!body.enabled && email.toLowerCase() === PROTECTED_EMAIL) {
      throw new HttpError(403, 'This account cannot be disabled');
    }

    try {
      await cognito.send(
        new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email })
      );
    } catch (err) {
      if (err instanceof UserNotFoundException) {
        throw new HttpError(404, 'User not found');
      }
      throw err;
    }

    await cognito.send(
      body.enabled
        ? new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: email })
        : new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: email })
    );

    return json(200, { success: true });
  });
}
