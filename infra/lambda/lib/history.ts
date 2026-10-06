import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ddb, HISTORY_TABLE } from './dynamo';

export type HistoryEventType =
  | 'checked_out'
  | 'returned'
  | 'requested'
  | 'hold_granted'
  | 'hold_expired';

interface RecordHistoryEventInput {
  bookId: string;
  eventType: HistoryEventType;
  userId?: string;
  userName?: string;
  userEmail?: string;
}

// Best-effort, non-throwing — same philosophy as lib/email.ts: a
// checkout/return/request must never fail because the audit log write
// did. eventAt doubles as the sort key and a ulid suffix keeps two
// events in the same millisecond from colliding.
export async function recordHistoryEvent({
  bookId,
  eventType,
  userId,
  userName,
  userEmail,
}: RecordHistoryEventInput): Promise<void> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: HISTORY_TABLE,
        Item: {
          bookId,
          eventAt: `${new Date().toISOString()}#${ulid()}`,
          eventType,
          userId: userId ?? null,
          userName: userName ?? '',
          userEmail: userEmail ?? '',
        },
      })
    );
  } catch (err) {
    console.error('Failed to record history event', err);
  }
}

export async function getBookHistory(bookId: string) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: HISTORY_TABLE,
      KeyConditionExpression: 'bookId = :bookId',
      ExpressionAttributeValues: { ':bookId': bookId },
      ScanIndexForward: false,
    })
  );
  return result.Items ?? [];
}
