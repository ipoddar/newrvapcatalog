import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CATALOG_TABLE } from './lib/dynamo';
import { requireAdmin, HttpError } from './lib/auth';
import { handle, json } from './lib/http';

interface UpdateItemBody {
  title?: string;
  category?: string;
  language?: string[];
  pubyear?: number | null;
  firstname?: string;
  lastname?: string;
  editedTranslated?: string[] | null;
}

const FIELDS: Array<keyof UpdateItemBody> = [
  'title',
  'category',
  'language',
  'pubyear',
  'firstname',
  'lastname',
  'editedTranslated',
];

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  return handle(async () => {
    requireAdmin(event);

    const id = event.pathParameters?.id;
    if (!id) {
      throw new HttpError(400, 'Product ID is required');
    }
    if (!event.body) {
      throw new HttpError(400, 'Request body is required');
    }
    const body = JSON.parse(event.body) as UpdateItemBody;

    const updates = FIELDS.filter((field) => body[field] !== undefined);
    if (updates.length === 0) {
      throw new HttpError(400, 'No fields to update');
    }

    await ddb.send(
      new UpdateCommand({
        TableName: CATALOG_TABLE,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        UpdateExpression: `SET ${updates.map((f, i) => `#f${i} = :v${i}`).join(', ')}`,
        ExpressionAttributeNames: Object.fromEntries(
          updates.map((f, i) => [`#f${i}`, f])
        ),
        ExpressionAttributeValues: Object.fromEntries(
          updates.map((f, i) => [`:v${i}`, body[f]])
        ),
      })
    );

    return json(200, { success: true });
  });
}
