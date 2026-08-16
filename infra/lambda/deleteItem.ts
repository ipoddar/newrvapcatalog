import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CATALOG_TABLE, CHECKOUTS_TABLE } from './lib/dynamo';
import { requireAdmin, HttpError } from './lib/auth';
import { handle, json } from './lib/http';

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
    ]);

    return json(200, { success: true });
  });
}
