import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { requireAdmin, HttpError } from './lib/auth';
import { handle, json } from './lib/http';
import { sendEmail } from './lib/email';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface CreateUserBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  isAdmin?: boolean;
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  return handle(async () => {
    requireAdmin(event);

    if (!event.body) {
      throw new HttpError(400, 'Request body is required');
    }
    const body = JSON.parse(event.body) as CreateUserBody;
    if (!body.email?.trim() || !body.password) {
      throw new HttpError(400, 'Email and password are required');
    }
    if (!body.firstName?.trim() || !body.lastName?.trim()) {
      throw new HttpError(400, 'First and last name are required');
    }

    const email = body.email.trim();
    const name = `${body.firstName.trim()} ${body.lastName.trim()}`;

    try {
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: name },
            { Name: 'custom:admin', Value: body.isAdmin ? 'true' : 'false' },
          ],
        })
      );
    } catch (err) {
      if (err instanceof UsernameExistsException) {
        throw new HttpError(409, 'A user with this email already exists');
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
      'Welcome to the RVAP Library Catalog',
      `Hi ${name},\n\nAn account has been created for you by an administrator. You can sign in with the email and password you were given, browse the catalog, and check out books.\n\n— Ramakrishna Vedanta Ashrama of Pittsburgh`
    );

    return json(201, { success: true, data: { email, name } });
  });
}
