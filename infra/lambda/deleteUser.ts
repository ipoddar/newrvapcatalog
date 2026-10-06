import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminDeleteUserCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { ddb, CHECKOUTS_TABLE, BOOK_REQUESTS_TABLE } from './lib/dynamo';
import { requireAdmin, HttpError } from './lib/auth';
import { handle, json } from './lib/http';

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

// Same hardcoded floor as setUserEnabled.ts.
const PROTECTED_EMAIL = 'ipoddar@hotmail.com';

async function deletePendingRequestsFor(requesterUserId: string) {
  // No GSI on requesterUserId, so this scans — acceptable at this table's
  // size (same tradeoff as the full-catalog scans elsewhere in this app).
  const result = await ddb.send(
    new ScanCommand({
      TableName: BOOK_REQUESTS_TABLE,
      FilterExpression: 'requesterUserId = :uid',
      ExpressionAttributeValues: { ':uid': requesterUserId },
    })
  );
  await Promise.all(
    (result.Items ?? []).map((item) =>
      ddb.send(
        new DeleteCommand({
          TableName: BOOK_REQUESTS_TABLE,
          Key: { bookId: item.bookId, requesterUserId: item.requesterUserId },
        })
      )
    )
  );
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  return handle(async () => {
    requireAdmin(event);

    const email = event.pathParameters?.email ? decodeURIComponent(event.pathParameters.email) : undefined;
    if (!email) {
      throw new HttpError(400, 'Email is required');
    }

    if (email.toLowerCase() === PROTECTED_EMAIL) {
      throw new HttpError(403, 'This account cannot be deleted');
    }

    let sub: string | undefined;
    let isAdmin = false;
    try {
      const user = await cognito.send(
        new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: email })
      );
      sub = user.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
      isAdmin = user.UserAttributes?.find((a) => a.Name === 'custom:admin')?.Value === 'true';
    } catch (err) {
      if (err instanceof UserNotFoundException) {
        throw new HttpError(404, 'User not found');
      }
      throw err;
    }

    if (isAdmin) {
      throw new HttpError(403, 'Admin accounts cannot be deleted');
    }

    if (sub) {
      const checkouts = await ddb.send(
        new ScanCommand({
          TableName: CHECKOUTS_TABLE,
          FilterExpression: 'userId = :uid',
          ExpressionAttributeValues: { ':uid': sub },
          Select: 'COUNT',
        })
      );
      if ((checkouts.Count ?? 0) > 0) {
        throw new HttpError(409, 'This user still has checked-out books — return them before deleting the account');
      }

      await deletePendingRequestsFor(sub);
    }

    await cognito.send(
      new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: email })
    );

    return json(200, { success: true });
  });
}
