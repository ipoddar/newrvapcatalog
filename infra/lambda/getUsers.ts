import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { ddb, CATALOG_TABLE, CHECKOUTS_TABLE, BOOK_REQUESTS_TABLE } from './lib/dynamo';
import { requireAdmin } from './lib/auth';
import { isWarmerPing } from './lib/warmer';
import { handle, json, warm } from './lib/http';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

interface CognitoUserSummary {
  userId: string;
  email: string;
  name: string;
  isAdmin: string;
  status: string;
  enabled: boolean;
  createdAt: string;
}

async function listAllUsers() {
  const users: CognitoUserSummary[] = [];
  let PaginationToken: string | undefined;
  do {
    const page = await cognito.send(
      new ListUsersCommand({ UserPoolId: USER_POOL_ID, PaginationToken })
    );
    for (const user of page.Users ?? []) {
      const attrs = Object.fromEntries(
        (user.Attributes ?? []).map((a) => [a.Name, a.Value ?? ''])
      );
      users.push({
        userId: attrs.sub ?? '',
        email: attrs.email ?? '',
        name: attrs.name ?? '',
        isAdmin: attrs['custom:admin'] === 'true' ? 'true' : 'false',
        status: user.UserStatus ?? '',
        enabled: user.Enabled !== false,
        createdAt: user.UserCreateDate ? new Date(user.UserCreateDate).toISOString() : '',
      });
    }
    PaginationToken = page.PaginationToken;
  } while (PaginationToken);
  return users;
}

async function scanAll(tableName: string) {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey })
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  if (isWarmerPing(event)) {
    return warm();
  }

  return handle(async () => {
    requireAdmin(event);

    const [users, checkouts, catalogItems, requests] = await Promise.all([
      listAllUsers(),
      scanAll(CHECKOUTS_TABLE),
      scanAll(CATALOG_TABLE),
      scanAll(BOOK_REQUESTS_TABLE),
    ]);

    const catalogById = new Map(catalogItems.map((item) => [item.id, item]));
    const checkoutsByUserId = new Map<string, Record<string, unknown>[]>();
    for (const checkout of checkouts) {
      const userId = String(checkout.userId ?? '');
      const group = checkoutsByUserId.get(userId) ?? [];
      group.push(checkout);
      checkoutsByUserId.set(userId, group);
    }

    const requestsByBookId = new Map<string, Record<string, unknown>[]>();
    for (const request of requests) {
      const bookId = String(request.bookId ?? '');
      const group = requestsByBookId.get(bookId) ?? [];
      group.push(request);
      requestsByBookId.set(bookId, group);
    }

    const data = users.map((user) => {
      const userCheckouts = checkoutsByUserId.get(user.userId) ?? [];
      return {
        ...user,
        checkedOutBooks: userCheckouts.map((checkout) => {
          const book = catalogById.get(checkout.bookId);
          const pendingRequests = requestsByBookId.get(String(checkout.bookId)) ?? [];
          return {
            bookId: checkout.bookId,
            title: (book?.title as string) ?? 'Unknown title',
            category: (book?.category as string) ?? '',
            checkedOutAt: checkout.checkedOutAt,
            lastReminderSentAt: checkout.lastReminderSentAt ?? null,
            pendingRequestCount: pendingRequests.length,
          };
        }),
      };
    });

    return json(200, { data });
  });
}
