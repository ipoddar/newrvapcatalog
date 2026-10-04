import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Module scope: reused across invocations on a warm execution environment.
const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client);

export const CATALOG_TABLE = process.env.CATALOG_TABLE_NAME!;
export const CHECKOUTS_TABLE = process.env.CHECKOUTS_TABLE_NAME!;
export const BOOK_REQUESTS_TABLE = process.env.BOOK_REQUESTS_TABLE_NAME!;
export const COUNTER_ID = 'COUNTER#catalog';
