import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ddb, CATALOG_TABLE, CHECKOUTS_TABLE } from './lib/dynamo';
import { requireAuth, HttpError } from './lib/auth';
import { isWarmerPing } from './lib/warmer';
import { handle, json, warm } from './lib/http';
import { sendEmail } from './lib/email';

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

    const userEmail = (claims.email as string) ?? '';

    try {
      await ddb.send(
        new PutCommand({
          TableName: CHECKOUTS_TABLE,
          Item: {
            bookId,
            userId: sub,
            userName: (claims.name as string) ?? '',
            userEmail,
            userPhone: (claims.phone_number as string) ?? '',
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

    const book = await ddb.send(
      new GetCommand({ TableName: CATALOG_TABLE, Key: { id: bookId } })
    );
    const title = (book.Item?.title as string) ?? 'this book';

    await sendEmail(
      userEmail,
      'Checkout confirmation — RVAP Library Catalog',
      `You have checked out "${title}".\n\nPlease return it when you are done so others can borrow it.\n\n— Ramakrishna Vedanta Ashrama of Pittsburgh`
    );

    return json(200, { success: true });
  });
}
