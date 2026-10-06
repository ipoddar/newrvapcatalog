import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { ddb, CATALOG_TABLE, CHECKOUTS_TABLE } from './lib/dynamo';
import { requireAuth, HttpError } from './lib/auth';
import { isWarmerPing } from './lib/warmer';
import { handle, json, warm } from './lib/http';
import { sendEmail } from './lib/email';
import { recordHistoryEvent } from './lib/history';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

// Cognito's AdminGetUser only accepts the pool's username (here, email) or
// an existing alias — sub isn't one, so a checkout-on-behalf-of request
// (which only has the target's `sub` from getUsers.ts) needs a ListUsers
// filter to resolve it to email/name/phone instead.
async function findUserBySub(sub: string) {
  const result = await cognito.send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `sub = "${sub}"`,
      Limit: 1,
    })
  );
  const user = result.Users?.[0];
  if (!user) {
    throw new HttpError(404, 'User not found');
  }
  return Object.fromEntries(
    (user.Attributes ?? []).map((a) => [a.Name, a.Value ?? ''])
  );
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  // Must be checked before auth/DynamoDB so a warm-pool ping never touches
  // a real checkout record.
  if (isWarmerPing(event)) {
    return warm();
  }

  return handle(async () => {
    const { sub, claims } = requireAuth(event);
    const bookId = event.pathParameters?.id;
    if (!bookId) {
      throw new HttpError(400, 'Book ID is required');
    }

    const isAdmin = claims['custom:admin'] === 'true';
    const body = event.body ? (JSON.parse(event.body) as { onBehalfOfUserId?: string }) : {};
    const onBehalfOfUserId = isAdmin ? body.onBehalfOfUserId : undefined;

    let checkoutUserId = sub;
    let userName = (claims.name as string) ?? '';
    let userEmail = (claims.email as string) ?? '';
    let userPhone = (claims.phone_number as string) ?? '';

    if (onBehalfOfUserId && onBehalfOfUserId !== sub) {
      const targetAttrs = await findUserBySub(onBehalfOfUserId);
      checkoutUserId = onBehalfOfUserId;
      userName = targetAttrs.name ?? '';
      userEmail = targetAttrs.email ?? '';
      userPhone = targetAttrs.phone_number ?? '';
    }

    // A book returned to a requester's queue carries a 48h hold (see
    // lib/bookRequests.ts) — only the hold-holder (or an admin checking
    // out on their behalf) may claim it while the hold is active and
    // unexpired; everyone else is blocked until it expires.
    const existingBook = await ddb.send(
      new GetCommand({ TableName: CATALOG_TABLE, Key: { id: bookId } })
    );
    const holdForUserId = existingBook.Item?.holdForUserId as string | undefined;
    const holdExpiresAt = existingBook.Item?.holdExpiresAt as string | undefined;
    const holdActive = Boolean(holdForUserId && holdExpiresAt && Date.parse(holdExpiresAt) > Date.now());
    if (holdActive && holdForUserId !== checkoutUserId) {
      throw new HttpError(409, 'This book is reserved for another member right now');
    }

    try {
      await ddb.send(
        new PutCommand({
          TableName: CHECKOUTS_TABLE,
          Item: {
            bookId,
            userId: checkoutUserId,
            userName,
            userEmail,
            userPhone,
            checkedOutAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(bookId)',
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new HttpError(409, 'This book is already checked out');
      }
      throw err;
    }

    const title = (existingBook.Item?.title as string) ?? 'this book';

    if (holdForUserId) {
      await ddb.send(
        new UpdateCommand({
          TableName: CATALOG_TABLE,
          Key: { id: bookId },
          UpdateExpression: 'REMOVE holdForUserId, holdForUserName, holdForUserEmail, holdExpiresAt',
        })
      );
    }

    await Promise.all([
      sendEmail(
        userEmail,
        'Checkout confirmation — RVAP Library Catalog',
        `You have checked out "${title}".\n\nPlease return it when you are done so others can borrow it.\n\n— Ramakrishna Vedanta Ashrama of Pittsburgh`
      ),
      recordHistoryEvent({
        bookId,
        eventType: 'checked_out',
        userId: checkoutUserId,
        userName,
        userEmail,
      }),
    ]);

    return json(200, { success: true });
  });
}
