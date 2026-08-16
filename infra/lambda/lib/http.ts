import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { warmHeader } from './warmer';
import { HttpError } from './auth';

export function json(
  statusCode: number,
  body: unknown
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...warmHeader() },
    body: JSON.stringify(body),
  };
}

export function warm(): APIGatewayProxyStructuredResultV2 {
  return { statusCode: 200, headers: { 'X-Lambda-Warm': 'true' }, body: 'warm' };
}

export async function handle(
  fn: () => Promise<APIGatewayProxyStructuredResultV2>
): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return json(err.statusCode, { success: false, error: err.message });
    }
    console.error(err);
    return json(500, {
      success: false,
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
