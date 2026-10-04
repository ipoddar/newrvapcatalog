import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { requireAdmin, HttpError } from './lib/auth';
import { handle, json } from './lib/http';
import { sendEmail } from './lib/email';
import { buildCredentialsEmail } from './lib/welcomeEmail';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface SetPasswordBody {
  password: string;
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  return handle(async () => {
    requireAdmin(event);

    // Path param is the user's email, which is also their Cognito
    // Username (signInAliases: { email: true }) — no sub-to-username
    // lookup needed, unlike the on-behalf-of-checkout flow.
    const email = event.pathParameters?.email ? decodeURIComponent(event.pathParameters.email) : undefined;
    if (!email) {
      throw new HttpError(400, 'Email is required');
    }
    if (!event.body) {
      throw new HttpError(400, 'Request body is required');
    }
    const body = JSON.parse(event.body) as SetPasswordBody;
    if (!body.password || body.password.length < 6) {
      throw new HttpError(400, 'Password must be at least 6 characters');
    }

    let name = email;
    try {
      const user = await cognito.send(
        new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email })
      );
      name = user.UserAttributes?.find((a) => a.Name === 'name')?.Value ?? email;
    } catch (err) {
      if (err instanceof UserNotFoundException) {
        throw new HttpError(404, 'User not found');
      }
      throw err;
    }

    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        Password: body.password,
        Permanent: true,
      })
    );

    await sendEmail(
      email,
      'Your password was reset — RVAP Library Catalog',
      buildCredentialsEmail({ name, email, password: body.password, isNewAccount: false })
    );

    return json(200, { success: true });
  });
}
