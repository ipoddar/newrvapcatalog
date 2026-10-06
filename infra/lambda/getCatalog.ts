import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CATALOG_TABLE, CHECKOUTS_TABLE, BOOK_REQUESTS_TABLE, COUNTER_ID } from './lib/dynamo';
import { optionalAuth } from './lib/auth';
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
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  if (isWarmerPing(event)) {
    return warm();
  }

  return handle(async () => {
    const { sub, claims } = await optionalAuth(event);
    const isAdmin = claims['custom:admin'] === 'true';

    const [catalogItems, checkoutItems, requestItems] = await Promise.all([
      scanAll(CATALOG_TABLE),
      scanAll(CHECKOUTS_TABLE),
      scanAll(BOOK_REQUESTS_TABLE),
    ]);

    const catalog = catalogItems.filter((item) => item.id !== COUNTER_ID);
    const checkoutsByBookId = new Map(
      checkoutItems.map((checkout) => [checkout.bookId, checkout])
    );
    const requestedBookIdsByUser = new Set(
      requestItems
        .filter((r) => r.requesterUserId === sub)
        .map((r) => String(r.bookId))
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
            lastReminderSentAt?: string;
          }
        | undefined;
      const derived = derivedById.get(String(book.id));

      const holdForUserId = book.holdForUserId as string | undefined;
      const holdExpiresAt = book.holdExpiresAt as string | undefined;
      const holdActive = Boolean(holdForUserId && holdExpiresAt && Date.parse(holdExpiresAt) > Date.now());

      const checkedOutByCurrentUser = Boolean(sub) && checkout?.userId === sub;
      // Who has a book is private: only an admin coordinating a return, or
      // the holder looking at their own checkout, gets the name/email/phone.
      // Everyone else — other members or anonymous visitors — only learns
      // that it's unavailable, never from whom.
      const canSeeHolderIdentity = isAdmin || checkedOutByCurrentUser;

      return {
        ...book,
        ...derived,
        isCheckedOut: Boolean(checkout),
        checkedOutByCurrentUser,
        requestedByCurrentUser: requestedBookIdsByUser.has(String(book.id)),
        heldForCurrentUser: holdActive && holdForUserId === sub,
        isOnHoldForOther: holdActive && holdForUserId !== sub,
        checkoutDetails: checkout && canSeeHolderIdentity
          ? {
              userDisplay: checkout.userName,
              userEmail: isAdmin ? checkout.userEmail : '',
              userPhone: isAdmin ? checkout.userPhone : '',
              checkedOutDate: new Date(checkout.checkedOutAt).toLocaleDateString(),
              checkedOutAtIso: checkout.checkedOutAt,
              lastReminderSentAt: checkout.lastReminderSentAt ?? null,
            }
          : null,
      };
    });

    return json(200, { data });
  });
}
