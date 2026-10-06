import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ddb, HISTORY_TABLE } from './dynamo';

export type HistoryEventType =
  | 'checked_out'
  | 'returned'
  | 'requested'
  | 'hold_granted'
  | 'hold_expired'
  | 'email_sent';

interface RecordHistoryEventInput {
  bookId: string;
  eventType: HistoryEventType;
  userId?: string;
  userName?: string;
  userEmail?: string;
  emailSubject?: string;
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
  emailSubject,
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
          emailSubject: emailSubject ?? null,
        },
      })
    );
  } catch (err) {
    console.error('Failed to record history event', err);
  }
}

// Wraps sendEmail with a history write so the book's "Emails sent" log
// stays accurate without every call site having to remember both calls —
// recipient is logged as userEmail/userName so it renders the same way as
// every other history event.
export async function recordEmailSent(
  bookId: string,
  recipientEmail: string,
  recipientName: string,
  subject: string
): Promise<void> {
  await recordHistoryEvent({
    bookId,
    eventType: 'email_sent',
    userEmail: recipientEmail,
    userName: recipientName,
    emailSubject: subject,
  });
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
