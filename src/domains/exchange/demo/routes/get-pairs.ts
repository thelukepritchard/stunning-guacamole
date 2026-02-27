import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';
import { DEMO_COINS } from '../../../shared/types';

/**
 * Returns the list of coins available on the demo exchange.
 *
 * @param _event - API Gateway event (unused).
 * @returns JSON response containing available demo coins.
 */
export async function getPairs(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return jsonResponse(200, {
    coins: DEMO_COINS,
  });
}
