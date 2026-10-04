import { QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CATALOG_TABLE, BOOK_REQUESTS_TABLE } from './dynamo';
import { sendEmail } from './email';

const HOLD_DURATION_MS = 48 * 60 * 60 * 1000;

// Called right after a book becomes available (return, or an expired hold
// with no one claiming it) — pops the earliest-queued requester, if any,
// places a 48-hour hold for them on the Catalog item, removes their
// request row (they've been served), and emails them. No-ops if the
// queue is empty, clearing any stale hold fields instead.
export async function promoteNextRequester(bookId: string, title: string): Promise<void> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: BOOK_REQUESTS_TABLE,
      KeyConditionExpression: 'bookId = :bookId',
      ExpressionAttributeValues: { ':bookId': bookId },
    })
  );
  const requests = (result.Items ?? []) as Array<{
    requesterUserId: string;
    requesterName: string;
    requesterEmail: string;
    requestedAt: string;
  }>;

  if (requests.length === 0) {
    await ddb.send(
      new UpdateCommand({
        TableName: CATALOG_TABLE,
        Key: { id: bookId },
        UpdateExpression: 'REMOVE holdForUserId, holdForUserName, holdForUserEmail, holdExpiresAt',
      })
    );
    return;
  }

  const next = requests.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[0];
  const holdExpiresAt = new Date(Date.now() + HOLD_DURATION_MS).toISOString();

  await Promise.all([
    ddb.send(
      new UpdateCommand({
        TableName: CATALOG_TABLE,
        Key: { id: bookId },
        UpdateExpression:
          'SET holdForUserId = :uid, holdForUserName = :name, holdForUserEmail = :email, holdExpiresAt = :expires',
        ExpressionAttributeValues: {
          ':uid': next.requesterUserId,
          ':name': next.requesterName,
          ':email': next.requesterEmail,
          ':expires': holdExpiresAt,
        },
      })
    ),
    ddb.send(
      new DeleteCommand({
        TableName: BOOK_REQUESTS_TABLE,
        Key: { bookId, requesterUserId: next.requesterUserId },
      })
    ),
  ]);

  await sendEmail(
    next.requesterEmail,
    `"${title}" is available — RVAP Library Catalog`,
    `Hi ${next.requesterName || 'there'},\n\nGood news — "${title}" has been returned and is now reserved for you.\n\nPlease check it out within 48 hours, or the hold will expire and the book will become available to others.\n\n— Ramakrishna Vedanta Ashrama of Pittsburgh`
  );
}
