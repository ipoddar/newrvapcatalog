import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ddb, CATALOG_TABLE, CHECKOUTS_TABLE, BOOK_REQUESTS_TABLE } from './lib/dynamo';
import { requireAuth, HttpError } from './lib/auth';
import { isWarmerPing } from './lib/warmer';
import { handle, json, warm } from './lib/http';
import { recordHistoryEvent } from './lib/history';

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  if (isWarmerPing(event)) {
    return warm();
  }

  return handle(async () => {
    const { sub, claims } = requireAuth(event);
    const bookId = event.pathParameters?.id;
    if (!bookId) {
      throw new HttpError(400, 'Book ID is required');
    }

    const checkout = await ddb.send(
      new GetCommand({ TableName: CHECKOUTS_TABLE, Key: { bookId } })
    );
    if (!checkout.Item) {
      throw new HttpError(409, 'This book is not currently checked out');
    }
    if (checkout.Item.userId === sub) {
      throw new HttpError(409, 'You already have this book checked out');
    }

    const book = await ddb.send(
      new GetCommand({ TableName: CATALOG_TABLE, Key: { id: bookId } })
    );
    const title = (book.Item?.title as string) ?? 'this book';

    try {
      await ddb.send(
        new PutCommand({
          TableName: BOOK_REQUESTS_TABLE,
          Item: {
            bookId,
            requesterUserId: sub,
            requesterName: (claims.name as string) ?? '',
            requesterEmail: (claims.email as string) ?? '',
            requestedAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(bookId)',
        })
      );
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        throw new HttpError(409, 'You have already requested this book');
      }
      throw err;
    }

    await recordHistoryEvent({
      bookId,
      eventType: 'requested',
      userId: sub,
      userName: (claims.name as string) ?? '',
      userEmail: (claims.email as string) ?? '',
    });

    return json(201, { success: true, data: { title } });
  });
}
