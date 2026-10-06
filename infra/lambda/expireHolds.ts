import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CATALOG_TABLE } from './lib/dynamo';
import { promoteNextRequester } from './lib/bookRequests';
import { recordHistoryEvent } from './lib/history';

async function scanExpiredHolds() {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    // holdExpiresAt is sparse (only set while a hold is active), so a
    // targeted FilterExpression keeps this cheap even as the catalog
    // grows — most items never match attribute_exists at all.
    const page = await ddb.send(
      new ScanCommand({
        TableName: CATALOG_TABLE,
        FilterExpression: 'attribute_exists(holdExpiresAt) AND holdExpiresAt < :now',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
        ExclusiveStartKey,
      })
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// Daily sweep (same EventBridge schedule as sendOverdueReminders.ts): a
// hold nobody claimed within 48h is released, promoting whoever's next
// in that book's request queue (or clearing the hold if the queue is
// now empty) — see lib/bookRequests.ts for the shared logic also used
// by returnBook.ts's happy path.
export async function handler(): Promise<void> {
  const expired = await scanExpiredHolds();

  for (const book of expired) {
    const bookId = String(book.id);
    const title = (book.title as string) ?? 'this book';
    await recordHistoryEvent({
      bookId,
      eventType: 'hold_expired',
      userId: book.holdForUserId as string | undefined,
      userName: (book.holdForUserName as string) ?? '',
      userEmail: (book.holdForUserEmail as string) ?? '',
    });
    await promoteNextRequester(bookId, title);
  }
}
