import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';
import { DEMO_PAIRS } from '../types';

/**
 * Returns the list of trading pairs available on the demo exchange.
 *
 * @param _event - API Gateway event (unused).
 * @returns JSON response containing available demo pairs.
 */
export async function getPairs(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return jsonResponse(200, {
    pairs: DEMO_PAIRS,
  });
}
