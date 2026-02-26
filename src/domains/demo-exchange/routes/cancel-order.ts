import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';

/**
 * Order cancellation endpoint. Since all demo market orders fill
 * immediately, there are no pending orders to cancel. Returns 501
 * until limit orders are supported.
 *
 * @param event - API Gateway event with `orderId` path param and `sub` query param.
 * @returns JSON response indicating the operation is not supported.
 */
export async function cancelOrder(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.queryStringParameters?.sub;
  const orderId = event.pathParameters?.orderId;

  if (!sub) {
    return jsonResponse(400, { error: 'Missing required query parameter: sub' });
  }
  if (!orderId) {
    return jsonResponse(400, { error: 'Missing required path parameter: orderId' });
  }

  return jsonResponse(501, { error: 'Order cancellation is not supported — all demo orders fill immediately' });
}
