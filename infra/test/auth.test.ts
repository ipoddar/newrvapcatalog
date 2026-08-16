jest.mock('../lambda/lib/dynamo', () => ({
  ddb: { send: jest.fn(() => Promise.reject(new Error('DynamoDB should not be called for a rejected admin request'))) },
  CATALOG_TABLE: 'test-catalog',
  CHECKOUTS_TABLE: 'test-checkouts',
  COUNTER_ID: 'COUNTER#catalog',
}));

import { handler as createItemHandler } from '../lambda/createItem';
import { handler as deleteItemHandler } from '../lambda/deleteItem';
import { ddb } from '../lambda/lib/dynamo';

function eventWithClaims(claims: Record<string, string>) {
  return {
    requestContext: { authorizer: { jwt: { claims } } },
    pathParameters: { id: 'some-id' },
    body: JSON.stringify({ title: 'A Book', category: 'GIT', language: ['E'] }),
  } as any;
}

describe('admin auth guard', () => {
  beforeEach(() => {
    (ddb.send as jest.Mock).mockClear();
  });

  it('createItem rejects a non-admin caller with 403 and never touches DynamoDB', async () => {
    const result = await createItemHandler(
      eventWithClaims({ sub: 'user-1', 'custom:admin': 'false' })
    );
    expect(result.statusCode).toBe(403);
    expect(ddb.send).not.toHaveBeenCalled();
  });

  it('deleteItem rejects an unauthenticated caller with 401', async () => {
    const result = await deleteItemHandler(eventWithClaims({}));
    expect(result.statusCode).toBe(401);
    expect(ddb.send).not.toHaveBeenCalled();
  });
});
