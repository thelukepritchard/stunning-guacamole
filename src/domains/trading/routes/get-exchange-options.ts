import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../utils';
import type { ExchangeOption, ExchangeId } from '../types';
import { EXCHANGES, EXCHANGE_BASE_CURRENCIES, SUPPORTED_EXCHANGES } from '../types';

/**
 * Returns all configurable exchanges and their valid base currencies.
 *
 * Only returns real exchanges — demo mode is not listed as it is the implicit
 * default state before the user configures an exchange. Used by the frontend
 * to dynamically render the exchange and base currency selectors.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response containing all exchange options.
 */
export async function getExchangeOptions(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const options: ExchangeOption[] = SUPPORTED_EXCHANGES.map((id: ExchangeId) => ({
    exchangeId: id,
    name: EXCHANGES[id].name,
    description: EXCHANGES[id].description,
    baseCurrencies: EXCHANGE_BASE_CURRENCIES[id],
    phase: EXCHANGES[id].phase as 1 | 2,
  }));

  return jsonResponse(200, { exchanges: options });
}
