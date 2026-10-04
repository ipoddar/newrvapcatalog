import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CATALOG_TABLE, CHECKOUTS_TABLE, BOOK_REQUESTS_TABLE } from './lib/dynamo';
import { requireAdmin, HttpError } from './lib/auth';
import { handle, json } from './lib/http';

async function deletePendingRequests(bookId: string) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: BOOK_REQUESTS_TABLE,
      KeyConditionExpression: 'bookId = :bookId',
      ExpressionAttributeValues: { ':bookId': bookId },
    })
  );
  await Promise.all(
    (result.Items ?? []).map((item) =>
      ddb.send(
        new DeleteCommand({
          TableName: BOOK_REQUESTS_TABLE,
          Key: { bookId, requesterUserId: item.requesterUserId },
        })
      )
    )
  );
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  return handle(async () => {
    requireAdmin(event);

    const id = event.pathParameters?.id;
    if (!id) {
      throw new HttpError(400, 'Product ID is required');
    }

    await Promise.all([
      ddb.send(new DeleteCommand({ TableName: CATALOG_TABLE, Key: { id } })),
      ddb.send(
        new DeleteCommand({ TableName: CHECKOUTS_TABLE, Key: { bookId: id } })
      ),
      deletePendingRequests(id),
    ]);

    return json(200, { success: true });
  });
}
