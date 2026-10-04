import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ulid } from 'ulid';
import { UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CATALOG_TABLE, COUNTER_ID } from './lib/dynamo';
import { requireAdmin, HttpError } from './lib/auth';
import { handle, json } from './lib/http';

interface CreateItemBody {
  title: string;
  category: string;
  language: string[];
  pubyear?: number | null;
  firstname?: string;
  lastname?: string;
  editedTranslated?: string[] | null;
  sheetId?: string | null;
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  return handle(async () => {
    requireAdmin(event);

    if (!event.body) {
      throw new HttpError(400, 'Request body is required');
    }
    const body = JSON.parse(event.body) as CreateItemBody;
    if (!body.title?.trim() || !body.category?.trim()) {
      throw new HttpError(400, 'Title and category are required');
    }

    const counter = await ddb.send(
      new UpdateCommand({
        TableName: CATALOG_TABLE,
        Key: { id: COUNTER_ID },
        UpdateExpression: 'ADD #number :inc',
        ExpressionAttributeNames: { '#number': 'number' },
        ExpressionAttributeValues: { ':inc': 1 },
        ReturnValues: 'UPDATED_NEW',
      })
    );

    const item = {
      id: ulid(),
      number: counter.Attributes?.number,
      title: body.title.trim(),
      category: body.category.trim(),
      language: body.language ?? [],
      pubyear: body.pubyear ?? null,
      firstname: body.firstname?.trim() ?? '',
      lastname: body.lastname?.trim() ?? '',
      editedTranslated: body.editedTranslated ?? null,
      sheetId: body.sheetId?.trim() || null,
    };

    await ddb.send(new PutCommand({ TableName: CATALOG_TABLE, Item: item }));

    return json(201, { success: true, data: item });
  });
}
