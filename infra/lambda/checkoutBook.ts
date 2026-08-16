import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ddb, CHECKOUTS_TABLE } from './lib/dynamo';
import { requireAuth, HttpError } from './lib/auth';
import { isWarmerPing } from './lib/warmer';
import { handle, json, warm } from './lib/http';

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

    try {
      await ddb.send(
        new PutCommand({
          TableName: CHECKOUTS_TABLE,
          Item: {
            bookId,
            userId: sub,
            userName: (claims.name as string) ?? '',
            userEmail: (claims.email as string) ?? '',
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

    return json(200, { success: true });
  });
}
