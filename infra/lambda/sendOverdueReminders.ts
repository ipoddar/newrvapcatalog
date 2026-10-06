import { ScanCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CATALOG_TABLE, CHECKOUTS_TABLE } from './lib/dynamo';
import { sendEmail } from './lib/email';
import { recordEmailSent } from './lib/history';

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

async function scanAllCheckouts() {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({ TableName: CHECKOUTS_TABLE, ExclusiveStartKey })
    );
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export async function handler(): Promise<void> {
  const now = Date.now();
  const checkouts = await scanAllCheckouts();

  for (const checkout of checkouts) {
    const bookId = String(checkout.bookId);
    const checkedOutAt = Date.parse(String(checkout.checkedOutAt));
    if (Number.isNaN(checkedOutAt)) continue;

    const lastReminderSentAt = checkout.lastReminderSentAt
      ? Date.parse(String(checkout.lastReminderSentAt))
      : null;

    // First reminder fires once the checkout has been out for 3 months;
    // each subsequent reminder waits another 6 months from the last one,
    // repeating until the book is returned (its Checkouts row is deleted).
    const dueSinceMs = lastReminderSentAt === null
      ? now - checkedOutAt - THREE_MONTHS_MS
      : now - lastReminderSentAt - SIX_MONTHS_MS;

    if (dueSinceMs < 0) continue;

    const userEmail = String(checkout.userEmail ?? '');
    if (!userEmail) continue;

    const book = await ddb.send(
      new GetCommand({ TableName: CATALOG_TABLE, Key: { id: bookId } })
    );
    const title = (book.Item?.title as string) ?? 'this book';
    const checkedOutDate = new Date(checkedOutAt).toLocaleDateString();
    const userName = String(checkout.userName ?? '');
    const subject = 'Reminder: overdue book — RVAP Library Catalog';

    await Promise.all([
      sendEmail(
        userEmail,
        subject,
        `This is a reminder that you checked out "${title}" on ${checkedOutDate} and it has not yet been returned.\n\nPlease return it at your earliest convenience so others can borrow it.\n\n— Ramakrishna Vedanta Ashrama of Pittsburgh`
      ),
      recordEmailSent(bookId, userEmail, userName, subject),
    ]);

    await ddb.send(
      new UpdateCommand({
        TableName: CHECKOUTS_TABLE,
        Key: { bookId },
        UpdateExpression: 'SET lastReminderSentAt = :now',
        ExpressionAttributeValues: { ':now': new Date(now).toISOString() },
      })
    );
  }
}
