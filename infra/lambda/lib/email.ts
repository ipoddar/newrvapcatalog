import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';

const ses = new SESv2Client({});
const cognito = new CognitoIdentityProviderClient({});
const FROM_ADDRESS = process.env.SES_FROM_ADDRESS!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

// A disabled (or since-deleted) account must never receive mail — checked
// here, centrally, so every call site (checkout/return/request/reminder/
// nudge/credentials emails) gets this for free instead of each one
// re-implementing the same Cognito lookup. Fails open on any lookup error
// other than "not found" — an SES/Cognito hiccup must not silently start
// swallowing legitimate emails.
async function isSendableRecipient(to: string): Promise<boolean> {
  try {
    const user = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: to })
    );
    return user.Enabled !== false;
  } catch (err) {
    if (err instanceof UserNotFoundException) {
      return false;
    }
    return true;
  }
}

export async function sendEmail(to: string, subject: string, bodyText: string): Promise<void> {
  if (!to) return;

  try {
    if (!(await isSendableRecipient(to))) {
      console.log('Skipping email to disabled/deleted user', to);
      return;
    }

    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM_ADDRESS,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: { Text: { Data: bodyText } },
          },
        },
      })
    );
  } catch (err) {
    // Email delivery is best-effort — a checkout/return/signup must not
    // fail because of an SES error (e.g. sandbox mode, unverified
    // recipient, throttling).
    console.error('Failed to send email', err);
  }
}
