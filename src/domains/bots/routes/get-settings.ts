import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import type { TradingSettingsRecord, TradingSettingsResponse } from '../../shared/types';
import { DEFAULT_EXCHANGE, EXCHANGE_BASE_CURRENCIES } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Returns the authenticated user's trading settings (exchange, base currency, masked API key).
 *
 * If the user has no settings record, returns the demo defaults (demo exchange with
 * the first available demo base currency). Demo users never have API credentials.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response containing the trading settings (secrets stripped).
 */
export async function getSettings(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const result = await ddbDoc.send(new GetCommand({
    TableName: process.env.SETTINGS_TABLE_NAME!,
    Key: { sub },
  }));

  const item = result.Item as TradingSettingsRecord | undefined;

  // No settings configured — return demo defaults
  if (!item) {
    const response: TradingSettingsResponse = {
      exchange: DEFAULT_EXCHANGE,
      baseCurrency: EXCHANGE_BASE_CURRENCIES[DEFAULT_EXCHANGE][0],
      updatedAt: new Date().toISOString(),
    };
    return jsonResponse(200, response);
  }

  const response: TradingSettingsResponse = {
    exchange: item.exchange,
    baseCurrency: item.baseCurrency,
    maskedApiKey: item.maskedApiKey,
    updatedAt: item.updatedAt,
  };

  return jsonResponse(200, response);
}
