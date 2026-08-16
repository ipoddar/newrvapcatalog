jest.mock('../lambda/lib/dynamo', () => ({
  ddb: { send: jest.fn(() => Promise.reject(new Error('DynamoDB should not be called on a warmer ping'))) },
  CATALOG_TABLE: 'test-catalog',
  CHECKOUTS_TABLE: 'test-checkouts',
  COUNTER_ID: 'COUNTER#catalog',
}));

import { handler as getCatalogHandler } from '../lambda/getCatalog';
import { handler as checkoutBookHandler } from '../lambda/checkoutBook';
import { handler as returnBookHandler } from '../lambda/returnBook';
import { ddb } from '../lambda/lib/dynamo';

const warmerEvent = { warmerPing: true } as any;

// A real invocation would carry requestContext.authorizer.jwt.claims; a
// warmer ping never does, so the early-return must fire before any auth
// check would throw on this missing shape.
const noAuthorizerContext = {};

describe('warm-pool early return', () => {
  beforeEach(() => {
    (ddb.send as jest.Mock).mockClear();
  });

  it('getCatalog returns immediately on a warmer ping without touching DynamoDB', async () => {
    const result = await getCatalogHandler({
      ...warmerEvent,
      requestContext: noAuthorizerContext,
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('warm');
    expect(ddb.send).not.toHaveBeenCalled();
  });

  it('checkoutBook returns immediately on a warmer ping without checking out a book', async () => {
    const result = await checkoutBookHandler({
      ...warmerEvent,
      requestContext: noAuthorizerContext,
      pathParameters: { id: 'some-book-id' },
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('warm');
    expect(ddb.send).not.toHaveBeenCalled();
  });

  it('returnBook returns immediately on a warmer ping without returning a book', async () => {
    const result = await returnBookHandler({
      ...warmerEvent,
      requestContext: noAuthorizerContext,
      pathParameters: { id: 'some-book-id' },
    });
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('warm');
    expect(ddb.send).not.toHaveBeenCalled();
  });
});
