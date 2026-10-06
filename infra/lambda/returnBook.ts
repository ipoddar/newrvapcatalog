import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ddb, CATALOG_TABLE, CHECKOUTS_TABLE } from './lib/dynamo';
import { requireAuth, HttpError } from './lib/auth';
import { isWarmerPing } from './lib/warmer';
import { handle, json, warm } from './lib/http';
import { sendEmail } from './lib/email';
import { promoteNextRequester } from './lib/bookRequests';
import { recordHistoryEvent } from './lib/history';

async function sendReturnConfirmation(bookId: string, userEmail: string): Promise<string> {
  const book = await ddb.send(
    new GetCommand({ TableName: CATALOG_TABLE, Key: { id: bookId } })
  );
  const title = (book.Item?.title as string) ?? 'this book';

  await sendEmail(
    userEmail,
    'Return confirmation — RVAP Library Catalog',
    `You have returned "${title}". Thank you!\n\n— Ramakrishna Vedanta Ashrama of Pittsburgh`
  );

  return title;
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  // Must be checked before auth/DynamoDB so a warm-pool ping never returns
  // someone's real checkout.
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

    if (isAdmin) {
      const existing = await ddb.send(
        new GetCommand({ TableName: CHECKOUTS_TABLE, Key: { bookId } })
      );
      if (!existing.Item) {
        throw new HttpError(404, 'This book is not checked out');
      }
      await ddb.send(
        new DeleteCommand({ TableName: CHECKOUTS_TABLE, Key: { bookId } })
      );
      const returnedUserId = (existing.Item.userId as string) ?? '';
      const returnedUserName = (existing.Item.userName as string) ?? '';
      const userEmail = (existing.Item.userEmail as string) ?? '';
      const title = await sendReturnConfirmation(bookId, userEmail);
      await Promise.all([
        promoteNextRequester(bookId, title),
        recordHistoryEvent({
          bookId,
          eventType: 'returned',
          userId: returnedUserId,
          userName: returnedUserName,
          userEmail,
        }),
      ]);
      return json(200, { success: true });
    }

    try {
      await ddb.send(
        new DeleteCommand({
          TableName: CHECKOUTS_TABLE,
          Key: { bookId },
          ConditionExpression: 'userId = :sub',
          ExpressionAttributeValues: { ':sub': sub },
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new HttpError(403, 'You did not check out this book');
      }
      throw err;
    }

    const userEmail = (claims.email as string) ?? '';
    const title = await sendReturnConfirmation(bookId, userEmail);
    await Promise.all([
      promoteNextRequester(bookId, title),
      recordHistoryEvent({
        bookId,
        eventType: 'returned',
        userId: sub,
        userName: (claims.name as string) ?? '',
        userEmail,
      }),
    ]);

    return json(200, { success: true });
  });
}
