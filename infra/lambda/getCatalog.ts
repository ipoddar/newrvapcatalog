import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CATALOG_TABLE, CHECKOUTS_TABLE, COUNTER_ID } from './lib/dynamo';
import { requireAuth } from './lib/auth';
import { isWarmerPing } from './lib/warmer';
import { handle, json, warm } from './lib/http';

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
    const { sub } = requireAuth(event);

    const [catalogItems, checkoutItems] = await Promise.all([
      scanAll(CATALOG_TABLE),
      scanAll(CHECKOUTS_TABLE),
    ]);

    const catalog = catalogItems.filter((item) => item.id !== COUNTER_ID);
    const checkoutsByBookId = new Map(
      checkoutItems.map((checkout) => [checkout.bookId, checkout])
    );

    // categorycount/categoryindex/titlecount are display-only fields derived
    // at read time from the full scan (see AWS_MIGRATION_PLAN.md's Data
    // Model section) rather than stored/maintained counters, to avoid the
    // race-prone MAX()/COUNT() pattern the old Postgres schema had.
    const byCategory = new Map<string, Record<string, unknown>[]>();
    for (const book of catalog) {
      const category = String(book.category ?? '');
      const group = byCategory.get(category) ?? [];
      group.push(book);
      byCategory.set(category, group);
    }

    const derivedById = new Map<
      string,
      { categorycount: number; categoryindex: number; titlecount: number }
    >();

    for (const group of byCategory.values()) {
      const sorted = [...group].sort(
        (a, b) => Number(a.number ?? 0) - Number(b.number ?? 0)
      );

      const titleIndexByTitle = new Map<string, number>();
      const titleCountByTitle = new Map<string, number>();

      sorted.forEach((book, i) => {
        const title = String(book.title ?? '');
        if (!titleIndexByTitle.has(title)) {
          titleIndexByTitle.set(title, titleIndexByTitle.size + 1);
        }
        const titlecount = (titleCountByTitle.get(title) ?? 0) + 1;
        titleCountByTitle.set(title, titlecount);

        derivedById.set(String(book.id), {
          categorycount: i + 1,
          categoryindex: titleIndexByTitle.get(title)!,
          titlecount,
        });
      });
    }

    const data = catalog.map((book) => {
      const checkout = checkoutsByBookId.get(book.id) as
        | {
            userId: string;
            userName: string;
            userEmail: string;
            userPhone: string;
            checkedOutAt: string;
          }
        | undefined;
      const derived = derivedById.get(String(book.id));

      return {
        ...book,
        ...derived,
        isCheckedOut: Boolean(checkout),
        checkedOutByCurrentUser: checkout?.userId === sub,
        checkoutDetails: checkout
          ? {
              userDisplay: checkout.userName,
              userEmail: checkout.userEmail,
              userPhone: checkout.userPhone,
              checkedOutDate: new Date(checkout.checkedOutAt).toLocaleDateString(),
            }
          : null,
      };
    });

    return json(200, { data });
  });
}
