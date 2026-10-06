import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, CATALOG_TABLE, CHECKOUTS_TABLE } from './lib/dynamo';
import { requireAdmin, HttpError } from './lib/auth';
import { handle, json } from './lib/http';
import { sendEmail } from './lib/email';
import { recordEmailSent } from './lib/history';

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  return handle(async () => {
    requireAdmin(event);

    const bookId = event.pathParameters?.id;
    if (!bookId) {
      throw new HttpError(400, 'Book ID is required');
    }

    const [checkout, book] = await Promise.all([
      ddb.send(new GetCommand({ TableName: CHECKOUTS_TABLE, Key: { bookId } })),
      ddb.send(new GetCommand({ TableName: CATALOG_TABLE, Key: { id: bookId } })),
    ]);

    if (!checkout.Item) {
      throw new HttpError(404, 'This book is not currently checked out');
    }

    const holderEmail = (checkout.Item.userEmail as string) ?? '';
    const holderName = (checkout.Item.userName as string) ?? '';
    const title = (book.Item?.title as string) ?? 'this book';
    const subject = 'Another member is waiting for a book you have — RVAP Library Catalog';

    // Deliberately doesn't name the requester — nudges the holder without
    // exposing who's waiting, matching the admin-mediated-forward design
    // (requester identity stays visible to admins only).
    await Promise.all([
      sendEmail(
        holderEmail,
        subject,
        `Hi,\n\nAnother library member has asked about "${title}", which you currently have checked out.\n\nIf you're finished with it, please return it when you can so they can borrow it.\n\n— Ramakrishna Vedanta Ashrama of Pittsburgh`
      ),
      recordEmailSent(bookId, holderEmail, holderName, subject),
    ]);

    return json(200, { success: true });
  });
}
