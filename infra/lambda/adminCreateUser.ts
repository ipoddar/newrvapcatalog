import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { randomBytes } from 'crypto';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { requireAdmin, HttpError } from './lib/auth';
import { handle, json } from './lib/http';
import { sendEmail } from './lib/email';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;
const SITE_URL = process.env.SITE_URL!;

interface CreateUserBody {
  email: string;
  firstName: string;
  lastName: string;
  isAdmin?: boolean;
}

// Cognito's temporary-password policy mirrors the pool's password policy
// (min length 6, no character-class requirements — see cognito-stack.ts),
// but a longer random value is used here regardless since it's never
// typed by a human, only pasted from the welcome email.
function generateTemporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}

function buildWelcomeEmail(name: string, email: string, tempPassword: string): string {
  return `Hi ${name},

An administrator has created a library catalog account for you at the Ramakrishna Vedanta Ashrama of Pittsburgh.

Sign in here: ${SITE_URL}/login
Email: ${email}
Temporary password: ${tempPassword}

You'll be asked to choose your own password the first time you sign in.

About the catalog: it holds books on Sri Ramakrishna, Holy Mother, and Swami Vivekananda's lives and teachings, Vedanta philosophy, sacred texts, devotional music and prayers, and more — spanning English, Sanskrit, Hindi, Bengali, and Tamil.

Checking out and returning books:
- Find a book and click the checkout icon on its row to borrow it.
- Click the same icon again (it becomes a return icon) when you're ready to return it.
- A row highlighted in yellow means it's already checked out.

Please note: the library sends automated email reminders if a book you've checked out hasn't been returned after a while. By confirming this account and signing in, you're agreeing to receive these reminder emails.

— Ramakrishna Vedanta Ashrama of Pittsburgh`;
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
    if (!body.email?.trim()) {
      throw new HttpError(400, 'Email is required');
    }
    if (!body.firstName?.trim() || !body.lastName?.trim()) {
      throw new HttpError(400, 'First and last name are required');
    }

    const email = body.email.trim();
    const name = `${body.firstName.trim()} ${body.lastName.trim()}`;
    const tempPassword = generateTemporaryPassword();

    try {
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: email,
          MessageAction: 'SUPPRESS',
          TemporaryPassword: tempPassword,
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

    await sendEmail(
      email,
      'Welcome to the RVAP Library Catalog',
      buildWelcomeEmail(name, email, tempPassword)
    );

    return json(201, { success: true, data: { email, name } });
  });
}
